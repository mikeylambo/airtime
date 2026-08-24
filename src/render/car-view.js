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
  const W = TUNING.WHEEL;
  const root = new THREE.Group();
  root.name = `car${index}`;
  scene.add(root);

  // Chassis. Gate A calls for "a box with four hinged panels" — this is that
  // box, with a cabin on top so its facing reads at a glance.
  const body = new THREE.Mesh(new THREE.BoxGeometry(C.HALF.x * 2, C.HALF.y * 2, C.HALF.z * 2));
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(art.register(body, 'body'));

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(C.HALF.x * 1.62, 0.46, C.HALF.z * 0.92));
  cabin.position.set(0, C.HALF.y + 0.22, 0.16);
  cabin.castShadow = true;
  root.add(art.register(cabin, 'glass'));

  // A nose wedge, so which way the car is pointing is never ambiguous in the air.
  const nose = new THREE.Mesh(new THREE.BoxGeometry(C.HALF.x * 1.75, 0.20, 0.5));
  nose.position.set(0, -C.HALF.y + 0.12, -C.HALF.z - 0.16);
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
  for (const slot of SLOTS) {
    const cfg = TUNING.PANELS[slot];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(cfg.size.x * 2, cfg.size.y * 2, cfg.size.z * 2));
    mesh.castShadow = true;
    mesh.name = `${slot}_${index}`;
    scene.add(art.register(mesh, 'panel'));
    panels[slot] = mesh;
  }

  return {
    root, body, wheels, panels, index,

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
