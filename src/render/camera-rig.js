/**
 * The dynamic airtime camera (§6) — the delta, part B, and the Gate A test.
 *
 * Three authored behaviours, chosen by launch context, plus the Classic fixed
 * chase from Options. The two rules that matter are structural, not stylistic:
 *
 *   never cut, always ease — a behaviour change crossfades between the two
 *   behaviours' shots, and the crossfaded result is then smoothed again on the
 *   way out, so there is no path through this file that teleports the camera.
 *
 *   the sim is never consulted for anything but state — the camera reads the
 *   car and the launch prediction and writes nothing back.
 */

import * as THREE from 'three';
import TUNING from '../TUNING.js';

export const BEHAVIOR = {
  SHOWCASE: 'showcase',
  PREVIEW: 'preview',
  CHASE: 'chase-pullback',
  ORBIT: 'orbit',
  TARGET: 'landing-target-lock',
  CLASSIC: 'classic',
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
/** Frame-rate independent exponential approach toward a target. */
const approach = (cur, tgt, tau, dt) => (tau <= 0 ? tgt : lerp(cur, tgt, 1 - Math.exp(-dt / tau)));

function vlerp(out, a, b, t) { out.copy(a).lerp(b, t); return out; }

class Shot {
  constructor() {
    this.position = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.fov = TUNING.CAMERA.FOV_BASE;
  }
  copy(o) { this.position.copy(o.position); this.target.copy(o.target); this.fov = o.fov; return this; }
  lerpTo(o, t) {
    this.position.lerp(o.position, t);
    this.target.lerp(o.target, t);
    this.fov = lerp(this.fov, o.fov, t);
    return this;
  }
}

export class CameraDirector {
  /**
   * @param camera        THREE.PerspectiveCamera
   * @param park          the arena description (for tagged landing targets)
   * @param probeGround   (x, z) => surface height, for keeping the lens out of the deck
   */
  constructor(camera, park, probeGround) {
    this.camera = camera;
    this.park = park;
    this.probeGround = probeGround || (() => 0);

    this.behavior = BEHAVIOR.CHASE;
    this.override = null;          // capture + replay theater force a behaviour

    this.shotA = new Shot();       // outgoing behaviour
    this.shotB = new Shot();       // incoming behaviour
    this.blendT = 1;
    this.blendDur = TUNING.CAMERA.BLEND_TO_GROUND;

    this.out = new Shot();         // smoothed result actually applied
    this.primed = false;

    this.heading = 0;              // lazily-followed travel direction
    this.pullback = 0;             // 0 = ground framing, 1 = air framing
    this.launch = null;
    this.lockTarget = null;
    this.orbitPhase = 0;
    this.orbitDir = 1;
    this.airT = 0;
    this.shakeT = 0;

    this._tmp = new THREE.Vector3();
    this._offset = new THREE.Vector3();
    this._scratch = new Shot();
  }

  setOverride(behavior) { this.override = behavior || null; }
  get activeBehavior() { return this.override || this.behavior; }

  /** Snap on the first frame of a run only — never during one. */
  reset(state) {
    this.primed = false;
    this.behavior = BEHAVIOR.CHASE;
    this.pullback = 0;
    this.launch = null;
    this.lockTarget = null;
    this.blendT = 1;
    this.heading = Math.atan2(state.forward.x, state.forward.z);
  }

  // ── Behaviour selection (§6 "selected by launch context") ────────────────
  onLaunch(launch, state) {
    this.launch = launch;
    this.airT = 0;
    this.orbitPhase = 0;
    if (!launch.armed) return;

    const C = TUNING.CAMERA;
    // Always resolve the target, even when a behaviour is being forced — the
    // capture rig and the replay theater override the choice, not the framing.
    this.lockTarget = this._targetInCone(state, launch);

    if (this.override) return this._switch(this.override, C.BLEND_TO_AIR);
    if (C.STYLE === 'classic') return this._switch(BEHAVIOR.CLASSIC, C.BLEND_TO_AIR);
    if (this.lockTarget) return this._switch(BEHAVIOR.TARGET, C.BLEND_TO_AIR);

    if (launch.predictedAirtime >= C.ORBIT.MIN_PREDICTED_AIRTIME) {
      // Orbit away from the direction the car is already yawing, so the move
      // reads as a deliberate camera choice rather than fighting the car.
      this.orbitDir = (state.angvel.y >= 0 ? -1 : 1) * C.ORBIT.DIRECTION;
      return this._switch(BEHAVIOR.ORBIT, C.BLEND_TO_AIR);
    }
    this._switch(BEHAVIOR.CHASE, C.BLEND_TO_AIR);
  }

  onTouchdown() {
    this.lockTarget = null;
    this.launch = null;
    const C = TUNING.CAMERA;
    if (this.override) return;
    this._switch(C.STYLE === 'classic' ? BEHAVIOR.CLASSIC : BEHAVIOR.CHASE, C.BLEND_TO_GROUND);
  }

  _switch(next, dur) {
    if (next === this.behavior && this.blendT >= 1) return;
    // Freeze whatever is on screen right now as the outgoing shot, so the
    // crossfade always starts from the current framing. This is the mechanism
    // that makes a cut impossible.
    this.shotA.copy(this.out);
    this.behavior = next;
    this.blendT = 0;
    this.blendDur = Math.max(0.001, dur);
  }

  /** §6 "if a tagged landing target is in the forward cone". */
  _targetInCone(state, launch) {
    const T = TUNING.CAMERA.TARGET_LOCK;
    const px = launch.position.x, py = launch.position.y, pz = launch.position.z;
    const vx = launch.velocity.x, vz = launch.velocity.z;
    const vl = Math.hypot(vx, vz) || 1;
    const fx = vx / vl, fz = vz / vl;

    let best = null, bestScore = Infinity;
    for (const t of this.park.targets) {
      const dx = t.aim.x - px, dz = t.aim.z - pz;
      const dist = Math.hypot(dx, dz);
      if (dist < 12 || dist > T.MAX_RANGE) continue;
      const ang = Math.acos(clamp((dx * fx + dz * fz) / dist, -1, 1));
      if (ang > T.FORWARD_CONE) continue;
      // Prefer the target closest to where the car is actually going to land.
      const lz = launch.predictedLanding ? launch.predictedLanding.z : pz;
      const lx = launch.predictedLanding ? launch.predictedLanding.x : px;
      const score = Math.hypot(t.aim.x - lx, t.aim.z - lz) + ang * 40;
      if (score < bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  // ── Per-frame ────────────────────────────────────────────────────────────
  update(dt, state) {
    const C = TUNING.CAMERA;

    if (state.airborne) this.airT += dt;
    else this.airT = 0;

    // Pullback eases toward the air framing while up, and back on landing.
    const wantPull = state.airborne ? 1 : 0;
    const pullTau = C.CHASE.PULLBACK_TIME / 3;
    this.pullback = approach(this.pullback, wantPull, pullTau, dt);

    // Travel heading, followed lazily — a camera that snaps to yaw is unusable
    // the moment the car starts spinning.
    const v = state.linvel;
    if (Math.hypot(v.x, v.z) > 2.5) {
      const want = Math.atan2(v.x, v.z);
      let d = want - this.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.heading += d * (1 - Math.exp(-dt / C.CHASE.HEADING_SMOOTH));
    }

    // Orbit hands back to chase on the descent (§6 "resumes chase on descent").
    if (this.behavior === BEHAVIOR.ORBIT && !this.override && this._orbitDone(state)) {
      this._switch(BEHAVIOR.CHASE, C.BLEND_BEHAVIOUR);
    }

    this._compose(this.shotB, this.activeBehavior, state, dt);

    if (this.blendT < 1) this.blendT = Math.min(1, this.blendT + dt / this.blendDur);
    const t = ease(this.blendT);
    const blended = this._scratch.copy(this.shotA).lerpTo(this.shotB, t);

    if (!this.primed) { this.out.copy(blended); this.primed = true; }
    else {
      this.out.position.lerp(blended.position, 1 - Math.exp(-dt / C.POS_SMOOTH));
      this.out.target.lerp(blended.target, 1 - Math.exp(-dt / C.LOOK_SMOOTH));
      this.out.fov = approach(this.out.fov, blended.fov, C.FOV_SMOOTH, dt);
    }

    this._apply(dt, state);
  }

  _orbitDone(state) {
    const C = TUNING.CAMERA.ORBIT;
    const hang = Math.max(0.8, this.launch ? this.launch.predictedAirtime : 2);
    return !state.airborne || this.airT >= hang * C.END_PHASE;
  }

  _compose(shot, behavior, state, dt) {
    switch (behavior) {
      case BEHAVIOR.SHOWCASE: return this._showcase(shot, state, dt);
      case BEHAVIOR.PREVIEW: return this._preview(shot, state);
      case BEHAVIOR.ORBIT: return this._orbit(shot, state);
      case BEHAVIOR.TARGET: return this._targetLock(shot, state);
      case BEHAVIOR.CLASSIC: return this._chase(shot, state, true);
      default: return this._chase(shot, state, false);
    }
  }

  /**
   * Showcase — the menu camera (§2.1: "car sits centre-stage, live 3D").
   * A slow orbit, biased to the right of frame so the menu list sits in the
   * empty half rather than on top of the car.
   */
  _showcase(shot, state, dt) {
    const C = TUNING.CAMERA;
    const K = C.SHOWCASE;
    this.showcaseA = (this.showcaseA || 0) + dt * K.SPEED;
    const p = state.position;
    shot.position.set(
      p.x + Math.sin(this.showcaseA) * K.RADIUS + K.BIAS_X,
      p.y + K.HEIGHT,
      p.z + Math.cos(this.showcaseA) * K.RADIUS
    );
    shot.target.set(p.x + K.BIAS_X * 0.35, p.y + 0.5, p.z);
    shot.fov = K.FOV;
    this._liftAboveDeck(shot);
    return shot;
  }

  /** The garage's fixed cinematic angle (§2.1). Deliberately unmoving. */
  _preview(shot, state) {
    const K = TUNING.CAMERA.PREVIEW;
    shot.position.set(K.EYE.x, K.EYE.y, K.EYE.z);
    shot.target.set(K.LOOK.x, K.LOOK.y, K.LOOK.z);
    shot.fov = K.FOV;
    return shot;
  }

  /** Chase-pullback (§6 default): eases back and up, wider FOV, car centred. */
  _chase(shot, state, classic) {
    const C = TUNING.CAMERA;
    const K = C.CHASE;
    const p = state.position;
    const pull = classic ? 0 : this.pullback;

    const ox = lerp(K.GROUND_OFFSET.x, K.AIR_OFFSET.x, pull);
    const oy = lerp(K.GROUND_OFFSET.y, K.AIR_OFFSET.y, pull);
    const oz = lerp(K.GROUND_OFFSET.z, K.AIR_OFFSET.z, pull);

    // Heading space: `dir` is the way the car is travelling, `right` is its
    // starboard side. The camera sits *behind* along dir and looks *ahead*
    // along it.
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    const dirX = s, dirZ = c;
    const rightX = c, rightZ = -s;
    shot.position.set(
      p.x - dirX * oz + rightX * ox,
      p.y + oy,
      p.z - dirZ * oz + rightZ * ox
    );

    const look = lerp(K.GROUND_LOOK_AHEAD, K.AIR_LOOK_AHEAD, pull);
    shot.target.set(p.x + dirX * look, p.y + C.LOOK_HEIGHT, p.z + dirZ * look);

    const speedT = clamp(state.speed / TUNING.DRIVE.TOP_SPEED, 0, 1.2);
    const base = classic ? C.FOV_BASE : lerp(C.FOV_BASE, K.FOV_AIR, pull);
    shot.fov = base + speedT * C.FOV_SPEED_KICK + (state.boosting ? C.FOV_BOOST_KICK : 0);

    this._liftAboveDeck(shot);
    return shot;
  }

  /** Orbit (§6): one revolution around the car on big airtime, GTA trailer style. */
  _orbit(shot, state) {
    const C = TUNING.CAMERA;
    const K = C.ORBIT;
    const p = state.position;
    const hang = Math.max(0.8, this.launch ? this.launch.predictedAirtime : 2);
    const span = Math.max(0.2, (K.END_PHASE - K.START_PHASE) * hang);
    const u = clamp((this.airT - K.START_PHASE * hang) / span, 0, 1);

    // Start behind the car — where the chase camera already is — so the
    // revolution begins exactly where the previous shot left off and reads as
    // one continuous move rather than a jump to the far side.
    const a = this.heading + Math.PI + this.orbitDir * u * Math.PI * 2 * K.REVOLUTIONS;
    shot.position.set(p.x + Math.sin(a) * K.RADIUS, p.y + K.HEIGHT, p.z + Math.cos(a) * K.RADIUS);
    shot.target.set(p.x, p.y + TUNING.CAMERA.LOOK_HEIGHT * 0.4, p.z);
    shot.fov = K.FOV;
    this._liftAboveDeck(shot);
    return shot;
  }

  /** Landing-target lock (§6): car and target in one shot, dolly-zoom on approach. */
  _targetLock(shot, state) {
    const C = TUNING.CAMERA;
    const K = C.TARGET_LOCK;
    const t = this.lockTarget;
    if (!t) return this._chase(shot, state, false);

    const p = state.position;
    const ax = t.aim.x - p.x, az = t.aim.z - p.z;
    const d = Math.hypot(ax, az) || 1;
    const fx = ax / d, fz = az / d;
    const sx = -fz, sz = fx;                       // left of the car→target axis

    // Frame a point between the car and the target rather than either one.
    const mx = lerp(p.x, t.aim.x, K.FRAME_BIAS);
    const my = lerp(p.y, t.aim.y, K.FRAME_BIAS);
    const mz = lerp(p.z, t.aim.z, K.FRAME_BIAS);

    // Dolly-zoom: as the gap closes the lens narrows and the camera backs off
    // by the reciprocal, so the car holds its size while the world compresses.
    const close = clamp(d / K.DOLLY_RANGE, 0, 1);
    const fov = K.DOLLY_ZOOM ? lerp(K.DOLLY_FOV_NEAR, K.DOLLY_FOV_FAR, close) : C.FOV_BASE;
    const dollyGain = K.DOLLY_ZOOM
      ? Math.tan((K.DOLLY_FOV_FAR * Math.PI) / 360) / Math.tan((fov * Math.PI) / 360)
      : 1;

    const stand = K.SIDE_OFFSET * dollyGain + d * K.RANGE_STANDOFF;
    shot.position.set(mx + sx * stand, my + K.HEIGHT + d * K.RANGE_HEIGHT, mz + sz * stand);
    shot.target.set(mx, my, mz);
    shot.fov = fov;
    this._liftAboveDeck(shot);
    return shot;
  }

  _liftAboveDeck(shot) {
    const min = this.probeGround(shot.position.x, shot.position.z) + TUNING.CAMERA.CHASE.MIN_GROUND_HEIGHT;
    if (shot.position.y < min) shot.position.y = min;
  }

  /** Push the smoothed shot onto the real camera, plus speed-sense shake (§4). */
  _apply(dt, state) {
    const C = TUNING.CAMERA;
    const cam = this.camera;

    cam.position.copy(this.out.position);

    const over = state.speed - C.SHAKE_START_SPEED;
    if (over > 0 && !state.airborne) {
      this.shakeT += dt * C.SHAKE_FREQ;
      const amp = Math.min(C.SHAKE_MAX, (over / TUNING.DRIVE.TOP_SPEED) * C.SHAKE_MAX * 2);
      cam.position.x += Math.sin(this.shakeT * 1.7) * amp;
      cam.position.y += Math.sin(this.shakeT * 2.3) * amp * 0.7;
      cam.position.z += Math.cos(this.shakeT * 1.3) * amp;
    }

    cam.lookAt(this.out.target);
    if (Math.abs(cam.fov - this.out.fov) > 0.01) {
      cam.fov = this.out.fov;
      cam.updateProjectionMatrix();
    }
  }
}

export default CameraDirector;
