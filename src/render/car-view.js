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

  // Sill blades are body-coloured, not panel-coloured. The deployable surfaces
  // are the things that need to shout, and giving the sills the same accent
  // colour just added to the orange mass the car was already drowning in.
  for (const [mesh, role] of [[body, 'body'], [canopy, 'glass'], [cover, 'glass'],
                              [blades[0], 'body'], [blades[1], 'body']]) {
    mesh.castShadow = true;
    mesh.receiveShadow = role === 'body';
    root.add(art.register(mesh, role));
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

  const wheels = [];
  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();          // steering
    const spin = new THREE.Group();           // rolling
    const tyre = new THREE.Mesh(wheelGeo);
    const rim = new THREE.Mesh(rimGeo);
    tyre.castShadow = true;
    spin.add(art.register(tyre, 'wheel'));
    // Body-coloured, not panel-coloured: orange means *deployable* on this car,
    // and orange wheels muddle the one piece of colour language it has.
    spin.add(art.register(rim, 'body'));
    pivot.add(spin);
    root.add(pivot);
    wheels.push({ pivot, spin });
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
    scene.add(art.register(mesh, 'panel'));
    panels[slot] = mesh;
  }

  return {
    root, body, wheels, panels, index,

    /**
     * Re-shape for a given car. Wheels need no help: their local positions come
     * straight out of the vehicle controller, so a change of wheelbase or track
     * moves them on its own.
     */
    setChassis(half, wheel) {
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
      wheelGeo.dispose(); rimGeo.dispose();
    },

    /** Pull every transform straight from the physics bodies. */
    sync(car, panelBodies) {
      const p = car.position, q = car.rotation;
      root.position.set(p.x, p.y, p.z);
      root.quaternion.set(q.x, q.y, q.z, q.w);

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
      }
    },
  };
}
