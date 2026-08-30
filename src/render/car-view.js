/**
 * Car meshes — a wedge body, four wheels, and five aero surfaces.
 *
 * Every panel is drawn from its own rigid body's world transform, so what you
 * see swinging is literally the thing the air is pushing on. Nothing here is
 * animated; it is all read back from the simulation.
 *
 * The body itself is generated (render/wedge.js) from the same half-extents,
 * wheelbase and track the physics uses, so a change of car is a change of
 * silhouette rather than a stretched box — and the silhouette is *true*, not
 * decorated.
 */

import * as THREE from 'three';
import TUNING from '../TUNING.js';
import { SLOTS } from '../sim/panels.js';
import { buildWedgeBody, buildAeroPlate, PANEL_KIND } from './wedge.js';
import { playerColor, trimFor } from './theme.js';

/**
 * AFTERGLOW's velocity stretch: the trim's vertex shader elongates the
 * trailing side of the silhouette along velocity — fake blur that reads
 * better than real blur, and costs a dot product (integrated-GPU rule).
 * Patched onto the edge line's material, which the art director rebuilds
 * whenever the hull changes, so the caller re-checks every frame.
 */
function stretchUniforms(mat) {
  if (mat.userData.uVel) return mat.userData;
  const uVel = { value: new THREE.Vector3() };
  const uStretch = { value: 0 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uVel = uVel;
    shader.uniforms.uStretch = uStretch;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\nuniform vec3 uVel;\nuniform float uStretch;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float sw = max(0.0, -dot(uVel, normalize(transformed + vec3(0.0, 0.0, 1e-5))));
        transformed -= uVel * uStretch * sw;`);
  };
  mat.needsUpdate = true;
  mat.userData.uVel = uVel;
  mat.userData.uStretch = uStretch;
  return mat.userData;
}

/**
 * R7 scuffing, on the GPU.
 *
 * AFTERGLOW draws the car as its own light, so "damaged" has to read as *the
 * light going out where you hit things* — a dent nobody can see at night is
 * not a damage model, it is a texture nobody looks at. Six numbers (one per
 * face of the chassis) darken the trim, blended by the direction each vertex
 * of the wireframe points, so a scuffed nose fades into clean flanks instead
 * of ending at a hard line across the middle of the car.
 *
 * Patched onto the same edge material the velocity stretch patches, for the
 * same reason: it costs a dot product and no draw calls.
 */
function scuffUniforms(mat) {
  if (mat.userData.uScuffPos) return mat.userData;
  const uScuffPos = { value: new THREE.Vector3() };   // +x right, +y roof, +z tail
  const uScuffNeg = { value: new THREE.Vector3() };   // -x left,  -y floor, -z nose
  const uScuffDark = { value: 0 };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.uniforms.uScuffPos = uScuffPos;
    shader.uniforms.uScuffNeg = uScuffNeg;
    shader.uniforms.uScuffDark = uScuffDark;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uScuffPos;
        uniform vec3 uScuffNeg;
        uniform float uScuffDark;
        varying float vScuff;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 sd = normalize(position + vec3(0.0, 0.0, 1e-5));
        vec3 sw = sd * sd;
        float sAmt =
            (sd.x > 0.0 ? uScuffPos.x : uScuffNeg.x) * sw.x
          + (sd.y > 0.0 ? uScuffPos.y : uScuffNeg.y) * sw.y
          + (sd.z > 0.0 ? uScuffPos.z : uScuffNeg.z) * sw.z;
        vScuff = 1.0 - sAmt * uScuffDark;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vScuff;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vScuff;');
  };
  mat.needsUpdate = true;
  mat.userData.uScuffPos = uScuffPos;
  mat.userData.uScuffNeg = uScuffNeg;
  mat.userData.uScuffDark = uScuffDark;
  return mat.userData;
}

const _invQ = new THREE.Quaternion();      // scratch — sync runs every frame

export function buildCarView(scene, art, index = 0) {
  const C = TUNING.CAR;
  const H = C.HALF;
  const W = TUNING.WHEEL;
  const root = new THREE.Group();
  root.name = `car${index}`;
  scene.add(root);

  const baseWheel = { halfTrack: W.HALF_TRACK, frontZ: W.AXLE_FRONT_Z, rearZ: W.AXLE_REAR_Z };

  // ── Chassis: one generated hull, plus glass and sill blades ──────────────
  const body = new THREE.Mesh();
  const canopy = new THREE.Mesh();
  const cover = new THREE.Mesh();
  const blades = [new THREE.Mesh(), new THREE.Mesh()];

  /**
   * Rebuild the hull for a given car, rather than scaling one box.
   *
   * Scaling would stretch the glasshouse and the rake along with everything
   * else, and the proportions are the entire point — the long car is supposed
   * to look like an arrow, not like a short car pulled out. This runs once when
   * a run starts, so building fresh geometry is free.
   */
  let owned = [];
  function shape(half, wheel, restyle = true) {
    for (const g of owned) g.dispose();
    const w = buildWedgeBody(half || H, wheel || baseWheel);
    body.geometry = w.body;
    canopy.geometry = w.canopy;
    cover.geometry = w.cover;
    blades[0].geometry = w.blades[0];
    blades[1].geometry = w.blades[1];
    owned = [w.body, w.canopy, w.cover, ...w.blades];
    // The neon pass caches a wireframe per mesh, so a replaced hull needs its
    // edges rebuilt or the old silhouette keeps being drawn over the new one.
    // Skipped on the first call, when the meshes are not registered yet.
    if (restyle) art.restyle([body, canopy, cover, blades[0], blades[1]]);
  }
  // Geometry first, registration second.
  //
  // art.register() builds the neon pass's edge geometry immediately, and an
  // unassigned THREE.Mesh carries an empty BufferGeometry with no position
  // attribute — so registering before shaping throws. Player one never hit it
  // because it is built at boot before a style is live; player two is built
  // mid-session with neon already active, which is why this only ever failed
  // in split-screen.
  shape(H, baseWheel, false);

  // Each player owns one accent colour end-to-end (AFTERGLOW): the trim is
  // drawn in it, and the archetype decides which creases light and how the
  // light splits between body and glasshouse. The colour is read at use time,
  // never cached — the colourblind option swaps the whole palette live.
  const pc = () => playerColor(index);
  let trim = trimFor('vector');
  const trimmed = [
    [body, 'body', () => trim.body], [canopy, 'glass', () => trim.glass],
    [cover, 'glass', () => trim.glass], [blades[0], 'body', () => trim.body],
    [blades[1], 'body', () => trim.body],
  ];
  for (const [mesh, role, opacity] of trimmed) {
    mesh.castShadow = true;
    mesh.receiveShadow = role === 'body';
    root.add(art.register(mesh, role, { edge: pc(), threshold: trim.threshold, opacity: opacity() }));
  }

  // ── Wheels ──────────────────────────────────────────────────────────────
  // Drawn narrower than the physics tyre. The radius has to stay honest — it
  // is where the car meets the ground — but the width is free, and at the real
  // 0.34 m the wheels read as off-road balloons under a supercar.
  const wheelGeo = new THREE.CylinderGeometry(W.RADIUS, W.RADIUS, 0.24, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  // A rim disc inboard of the tyre: without it a wheel reads as a black
  // cylinder and the car looks like it is rolling on drums.
  const rimGeo = new THREE.CylinderGeometry(W.RADIUS * 0.70, W.RADIUS * 0.70, 0.26, 10);
  rimGeo.rotateZ(Math.PI / 2);

  // R7 brake glow. Its own additive disc rather than a tint on the rim: the
  // rim's material is shared across every mesh registered under the `body`
  // role, so heating it would set the whole car on fire. One material for all
  // four discs, because all four brakes are the same temperature.
  const discGeo = new THREE.CircleGeometry(W.RADIUS * 0.62, 14);
  discGeo.rotateY(Math.PI / 2);
  const discMat = new THREE.MeshBasicMaterial({
    color: 0xff2200, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });

  const wheels = [];
  const rims = [];
  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();          // steering
    const spin = new THREE.Group();           // rolling
    const tyre = new THREE.Mesh(wheelGeo);
    const rim = new THREE.Mesh(rimGeo);
    tyre.castShadow = true;
    spin.add(art.register(tyre, 'wheel'));
    // The rim's edge circles are the "wheel rings" of the brief — the tyre
    // stays dark, the rim traces two rings of player colour.
    spin.add(art.register(rim, 'body', { edge: pc(), opacity: 0.8 }));
    rims.push(rim);
    // Inboard of the tyre, so the glow reads through the wheel rather than
    // over it — which is where a disc actually is.
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.position.x = (i % 2 === 0 ? 1 : -1) * 0.14;
    pivot.add(disc);
    pivot.add(spin);
    root.add(pivot);
    wheels.push({ pivot, spin, disc });
  }

  // ── Aero surfaces: separate world-space objects, not children of the car ──
  const panels = {};
  const panelGeo = {};
  for (const slot of SLOTS) {
    const cfg = TUNING.PANELS[slot];
    const geo = buildAeroPlate(cfg.size, PANEL_KIND[slot]);
    panelGeo[slot] = geo;
    const mesh = new THREE.Mesh(geo);
    mesh.castShadow = true;
    mesh.name = `${slot}_${index}`;
    // Player-coloured, dim at rest: deployment brightens it (see sync) —
    // steering the air literally lights up.
    scene.add(art.register(mesh, 'panel', { edge: pc(), opacity: 0.3 }));
    panels[slot] = mesh;
  }

  /** Reapply every player-coloured edge — a palette or archetype change. */
  function retrim() {
    for (const [mesh, , opacity] of trimmed) {
      art.setEdgeOpts(mesh, { edge: pc(), threshold: trim.threshold, opacity: opacity() });
    }
    for (const rim of rims) art.setEdgeOpts(rim, { edge: pc(), opacity: 0.8 });
    for (const slot of SLOTS) art.setEdgeOpts(panels[slot], { edge: pc(), opacity: 0.3 });
  }

  return {
    root, body, wheels, panels, index, retrim,

    /**
     * Re-shape for a given car. Wheels need no help: their local positions come
     * straight out of the vehicle controller, so a change of wheelbase or track
     * moves them on its own. The trim archetype travels with the car id — a
     * different instrument is a different drawing, not just a different box.
     */
    setChassis(half, wheel, carId) {
      trim = trimFor(carId);
      retrim();
      const h = half || H;
      shape(h, wheel || baseWheel);
      // The aero surfaces ride the chassis box, so they scale with it.
      const s = { x: h.x / H.x, y: h.y / H.y, z: h.z / H.z };
      for (const slot of SLOTS) panels[slot].scale.set(s.x, s.y, s.z);
    },

    /** Remove every mesh this view owns — used when the player count drops. */
    dispose() {
      scene.remove(root);
      for (const slot of SLOTS) scene.remove(panels[slot]);
      art.unregisterUnder(root);
      for (const slot of SLOTS) art.unregisterUnder(panels[slot]);
      for (const g of owned) g.dispose();
      for (const slot of SLOTS) panelGeo[slot].dispose();
      wheelGeo.dispose(); rimGeo.dispose(); discGeo.dispose(); discMat.dispose();
    },

    /**
     * R7 brake glow, and R7 scuffing. Both are read off models the simulation
     * owns (sim/brakes.js, sim/wear.js) rather than decided here — the same
     * rule the particles were held to.
     */
    setWear(wear, brakes) {
      const edge = body.userData.__edge;
      if (edge && wear) {
        const u = scuffUniforms(edge.material);
        u.uScuffPos.value.set(wear.scuffAt('right'), wear.scuffAt('roof'), wear.scuffAt('tail'));
        u.uScuffNeg.value.set(wear.scuffAt('left'), wear.scuffAt('floor'), wear.scuffAt('nose'));
        u.uScuffDark.value = TUNING.WEAR.SCUFF_DARKEN;
      }
      if (brakes) {
        const g = brakes.glow;
        const c = brakes.color;
        discMat.opacity = g * 0.9;
        discMat.color.setRGB(c.r, c.g, c.b);
      }
    },

    /** Pull every transform straight from the physics bodies. */
    sync(car, panelBodies) {
      const p = car.position, q = car.rotation;
      root.position.set(p.x, p.y, p.z);
      root.quaternion.set(q.x, q.y, q.z, q.w);

      // Velocity stretch on the trim (AFTERGLOW). The edge line is rebuilt on
      // hull or style changes, so the patch is idempotent and re-checked here.
      const edge = body.userData.__edge;
      if (edge) {
        const u = stretchUniforms(edge.material);
        const T = TUNING.TRAILS;
        const v = car.linvel;
        const speed = Math.hypot(v.x, v.y, v.z);
        const k = Math.min(1, Math.max(0, (speed - T.STRETCH_FROM) / (T.STRETCH_FULL - T.STRETCH_FROM)));
        u.uStretch.value = k * T.STRETCH_MAX;
        if (speed > 1) {
          // World velocity direction into the trim's local space.
          u.uVel.value.set(v.x / speed, v.y / speed, v.z / speed)
            .applyQuaternion(_invQ.copy(root.quaternion).invert());
        } else u.uStretch.value = 0;
      }

      for (let i = 0; i < 4; i++) {
        const w = car.wheelState(i);
        const { pivot, spin } = wheels[i];
        pivot.position.set(w.localPos.x, w.localPos.y, w.localPos.z);
        pivot.rotation.y = w.steer;
        spin.rotation.x = w.spin;
      }

      for (const slot of SLOTS) {
        const part = panelBodies.parts[slot];
        const mesh = panels[slot];
        mesh.visible = true;
        const t = part.body.translation();
        const r = part.body.rotation();
        mesh.position.set(t.x, t.y, t.z);
        mesh.quaternion.set(r.x, r.y, r.z, r.w);
        // Deployment brightens the trim: the air being steered is drawn in
        // light, in the player's colour.
        const pe = mesh.userData.__edge;
        if (pe) pe.material.opacity = 0.3 + 0.7 * part.deploy;
      }
    },
  };
}
