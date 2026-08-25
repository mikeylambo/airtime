/**
 * Car meshes — chassis, four wheels, and the five hinged body panels.
 *
 * Every panel is drawn from its own rigid body's world transform, so what you
 * see swinging is literally the thing the air is pushing on. Nothing here is
 * animated; it is all read back from the simulation.
 */

import * as THREE from 'three';
import TUNING from '../TUNING.js';
import { SLOTS } from '../sim/panels.js';

export function buildCarView(scene, art, index = 0) {
  const C = TUNING.CAR;
  const H = C.HALF;          // geometry is built at the baseline box...
  const W = TUNING.WHEEL;
  const root = new THREE.Group();
  root.name = `car${index}`;
  scene.add(root);

  // Chassis. Gate A calls for "a box with four hinged panels" — this is that
  // box, with a cabin on top so its facing reads at a glance.
  const body = new THREE.Mesh(new THREE.BoxGeometry(H.x * 2, H.y * 2, H.z * 2));
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(art.register(body, 'body'));

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(H.x * 1.62, 0.46, H.z * 0.92));
  cabin.position.set(0, H.y + 0.22, 0.16);
  cabin.castShadow = true;
  root.add(art.register(cabin, 'glass'));

  // A nose wedge, so which way the car is pointing is never ambiguous in the air.
  const nose = new THREE.Mesh(new THREE.BoxGeometry(H.x * 1.75, 0.20, 0.5));
  nose.position.set(0, -H.y + 0.12, -H.z - 0.16);
  nose.castShadow = true;
  root.add(art.register(nose, 'body'));

  // ── Wheels ──────────────────────────────────────────────────────────────
  const wheelGeo = new THREE.CylinderGeometry(W.RADIUS, W.RADIUS, 0.34, 18);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();          // steering
    const spin = new THREE.Group();           // rolling
    const mesh = new THREE.Mesh(wheelGeo);
    mesh.castShadow = true;
    spin.add(art.register(mesh, 'wheel'));
    pivot.add(spin);
    root.add(pivot);
    wheels.push({ pivot, spin });
  }

  // ── Body panels: separate world-space objects, not children of the car ───
  const panels = {};
  const panelBase = {};
  for (const slot of SLOTS) {
    const cfg = TUNING.PANELS[slot];
    panelBase[slot] = cfg.size;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(cfg.size.x * 2, cfg.size.y * 2, cfg.size.z * 2));
    mesh.castShadow = true;
    mesh.name = `${slot}_${index}`;
    scene.add(art.register(mesh, 'panel'));
    panels[slot] = mesh;
  }

  // ...and scaled to the car actually being driven. Wheels need no help: their
  // local positions come straight out of the vehicle controller, so a change of
  // wheelbase moves them on its own.
  const chassisParts = [
    { mesh: body, base: { x: 1, y: 1, z: 1 }, pos: null },
    { mesh: cabin, base: { x: 1, y: 1, z: 1 }, pos: { x: 0, y: H.y + 0.22, z: 0.16 } },
    { mesh: nose, base: { x: 1, y: 1, z: 1 }, pos: { x: 0, y: -H.y + 0.12, z: -H.z - 0.16 } },
  ];

  return {
    root, body, wheels, panels, index,

    /**
     * Re-shape the chassis mesh for a given car. Called when a run starts; a
     * NEEDLE has to look a metre longer than a STUB or the physics is lying.
     */
    setChassis(half) {
      const h = half || H;
      const s = { x: h.x / H.x, y: h.y / H.y, z: h.z / H.z };
      for (const slot of SLOTS) panels[slot].scale.set(s.x, s.y, s.z);
      for (const part of chassisParts) {
        part.mesh.scale.set(s.x, s.y, s.z);
        if (part.pos) part.mesh.position.set(part.pos.x, part.pos.y * s.y, part.pos.z * s.z);
      }
      // The nose hangs off the front face, so its offset tracks the new length.
      nose.position.z = -h.z - 0.16 * s.z;
      cabin.position.y = h.y + 0.22;
    },

    /** Remove every mesh this view owns — used when the player count drops. */
    dispose() {
      scene.remove(root);
      for (const slot of SLOTS) scene.remove(panels[slot]);
      art.unregisterUnder(root);
      for (const slot of SLOTS) art.unregisterUnder(panels[slot]);
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
