/**
 * The ghost, drawn (R9).
 *
 * A ghost is "a replay we do not draw the HUD for", and AFTERGLOW extends
 * that: we do not draw its *bodywork* either. No wheels, no aero surfaces, no
 * fill — the hull's edges alone, in WHITE-HOT at low opacity. A car made of
 * nothing but its own cut-lines reads as a memory of a car rather than a
 * second competitor sharing the road, which is exactly what it is: it is not
 * in your world, it cannot touch you, and drawing it as solid as you would be
 * a lie about the physics.
 *
 * It is also almost free, which matters on a machine with no dedicated GPU:
 * one wireframe, one transform a frame, and no simulation at all — the
 * trajectory was baked once when the ghost was chosen (game/ghosts.js).
 */

import * as THREE from 'three';
import TUNING from '../TUNING.js';
import { buildWedgeBody } from './wedge.js';
import { THEME } from './theme.js';

/** Far enough away and it is a distraction; close enough and it is the race. */
const FADE_NEAR = 6;
const FADE_FAR = 26;
const BASE_OPACITY = 0.42;

export function buildGhostView(scene) {
  const root = new THREE.Group();
  root.name = 'ghost';
  root.visible = false;
  scene.add(root);

  const mat = new THREE.LineBasicMaterial({
    color: THEME.WHITE_HOT, transparent: true, opacity: BASE_OPACITY,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });

  let lines = null;
  let owned = [];

  const shape = (half, wheel) => {
    for (const g of owned) g.dispose();
    owned = [];
    if (lines) { root.remove(lines); lines = null; }
    const w = buildWedgeBody(half || TUNING.CAR.HALF, wheel);
    // One wireframe over the hull and the canopy together: the ghost is a
    // silhouette, so the parts it is made of should not be separable by eye.
    const merged = new THREE.BufferGeometry();
    const src = [w.body, w.canopy];
    const positions = [];
    for (const geo of src) {
      const e = new THREE.EdgesGeometry(geo, 26);
      const arr = e.getAttribute('position').array;
      for (let i = 0; i < arr.length; i++) positions.push(arr[i]);
      e.dispose();
    }
    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    owned.push(merged, w.body, w.canopy, w.cover, ...w.blades);
    lines = new THREE.LineSegments(merged, mat);
    lines.frustumCulled = false;
    root.add(lines);
  };

  shape(TUNING.CAR.HALF, null);

  return {
    root,

    /** Re-shape for whichever car set the ghost. */
    setChassis(half, wheel) { shape(half, wheel); },

    /**
     * Place it. `pose` is what Ghost.at() produced: interpolated position,
     * nearest-sample rotation.
     */
    sync(pose, camPos) {
      if (!pose) { root.visible = false; return; }
      root.visible = true;
      root.position.set(pose.x, pose.y, pose.z);
      root.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
      // Dissolve at the lens, like the trails and the target markers: a
      // wireframe car crossed at arm's length fills the screen with white
      // lines, and probe:dark counts every one of them.
      if (camPos) {
        const d = Math.hypot(pose.x - camPos.x, pose.y - camPos.y, pose.z - camPos.z);
        const k = Math.min(1, Math.max(0, (d - FADE_NEAR) / (FADE_FAR - FADE_NEAR)));
        mat.opacity = BASE_OPACITY * k;
      }
    },

    hide() { root.visible = false; },

    dispose() {
      scene.remove(root);
      for (const g of owned) g.dispose();
      mat.dispose();
      owned = [];
    },
  };
}
