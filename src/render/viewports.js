/**
 * Split-screen viewports (§9).
 *
 * §6's split-screen rule: "per-viewport cameras run chase-pullback only (no
 * orbit, no dolly — the cinematic camera doesn't survive a quartered screen).
 * The full cinematic camera returns in the post-round highlight reel."
 *
 * So each viewport gets its own camera and its own director, and every one of
 * them is pinned to chase-pullback. That restraint is the point, not a
 * shortcut: an orbit in a quarter-screen box is unreadable.
 */

import * as THREE from 'three';
import TUNING from '../TUNING.js';
import { CameraDirector, BEHAVIOR } from './camera-rig.js';

/** Screen-space rects (x, y, w, h) in 0..1, y up, for n players. */
export function layout(n) {
  if (n <= 1) return [[0, 0, 1, 1]];
  if (n === 2) {
    // Stacked, because a jump is a vertical event and letterboxing it hurts
    // more than losing width.
    return [[0, 0.5, 1, 0.5], [0, 0, 1, 0.5]];
  }
  if (n === 3) return [[0, 0.5, 1, 0.5], [0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5]];
  return [[0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5], [0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5]];
}

export class Viewports {
  constructor(renderer, park, probeGround) {
    this.renderer = renderer;
    this.park = park;
    this.probeGround = probeGround;
    this.views = [];
    this.count = 0;
  }

  /** Rebuild for `n` players. Directors are cheap; cameras cheaper. */
  setCount(n, arenaPark) {
    if (arenaPark) this.park = arenaPark;
    n = Math.max(1, Math.min(n, TUNING.MODES.PARTY.MAX_PLAYERS));
    while (this.views.length < n) {
      const camera = new THREE.PerspectiveCamera(
        TUNING.CAMERA.FOV_BASE, 16 / 9, TUNING.CAMERA.NEAR, TUNING.CAMERA.FAR
      );
      this.views.push({
        camera,
        director: new CameraDirector(camera, this.park, this.probeGround),
      });
    }
    for (const v of this.views) v.director.park = this.park;
    this.count = n;
    this.rects = layout(n);
    return this.views.slice(0, n);
  }

  get active() { return this.views.slice(0, this.count); }

  reset(states) {
    this.active.forEach((v, i) => v.director.reset(states[i] || states[0]));
  }

  resize(w, h) {
    this.active.forEach((v, i) => {
      const r = this.rects[i];
      v.camera.aspect = (w * r[2]) / (h * r[3]);
      v.camera.updateProjectionMatrix();
    });
  }

  /**
   * Render one frame across every viewport.
   * @param split when true, every director is pinned to chase-pullback (§6)
   */
  render(scene, dt, states, split) {
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    r.setScissorTest(this.count > 1);

    this.active.forEach((v, i) => {
      const s = states[i] || states[0];
      v.director.setOverride(split ? BEHAVIOR.CHASE : null);
      v.director.update(dt, s);

      const rect = this.rects[i];
      const x = Math.floor(rect[0] * size.x);
      const y = Math.floor(rect[1] * size.y);
      const w = Math.floor(rect[2] * size.x);
      const h = Math.floor(rect[3] * size.y);
      r.setViewport(x, y, w, h);
      r.setScissor(x, y, w, h);
      r.render(scene, v.camera);
    });

    r.setScissorTest(false);
    r.setViewport(0, 0, size.x, size.y);
  }
}

export default Viewports;
