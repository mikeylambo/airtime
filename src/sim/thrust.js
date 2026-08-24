/**
 * Tease-thrust (§5) — the delta, part A. A car that flies badly on purpose.
 *
 * A ~0.6s burst, air only, paid for out of the same bar as ground boost. The
 * stick direction at the moment of the press picks which of the three things
 * it does. The design constraint is enforced in code rather than by tuning
 * discipline: the EXTEND push has its upward component hard-clamped, so no
 * amount of thrust can ever hold the car up.
 */

import TUNING from '../TUNING.js';
import {
  v3, add, sub, scale, dot, len, norm, cross, clamp, qRot,
  LOCAL_FORWARD, WORLD_UP,
} from './mathx.js';

export const THRUST_MODE = { EXTEND: 'extend', CORRECT: 'correct', DIVE: 'dive' };

/** Pick a mode from the stick position at the instant of the press (§5). */
export function modeFromStick(stickX, stickY) {
  const T = TUNING.THRUST;
  const mag = Math.hypot(stickX, stickY);
  if (mag < T.STICK_DEADZONE) return THRUST_MODE.CORRECT;
  const ang = Math.atan2(stickX, stickY);          // 0 = straight up
  if (Math.abs(ang) <= T.FORWARD_CONE) return THRUST_MODE.EXTEND;
  if (Math.abs(ang) >= Math.PI - T.BACK_CONE) return THRUST_MODE.DIVE;
  return THRUST_MODE.CORRECT;                       // sideways = level me out
}

export class TeaseThrust {
  constructor(car, boost, setup = null) {
    this.car = car;
    this.boost = boost;
    this.setup = setup;
    this.active = false;
    this.mode = null;
    this.timeLeft = 0;
    this.cooldown = 0;
    this.burstsThisJump = 0;
    this.lastMode = null;
  }

  reset() {
    this.active = false; this.mode = null;
    this.timeLeft = 0; this.cooldown = 0; this.burstsThisJump = 0;
  }

  onLaunch() { this.burstsThisJump = 0; }

  update(dt, { actions, airborne, pressedThrust }) {
    const T = TUNING.THRUST;
    if (this.cooldown > 0) this.cooldown -= dt;

    const allowed = airborne || !T.AIR_ONLY;
    if (pressedThrust && allowed && !this.active && this.cooldown <= 0 && this.boost.canAffordThrust()) {
      if (this.boost.spendThrust()) {
        this.active = true;
        this.mode = modeFromStick(actions.stickX, actions.stickY);
        this.lastMode = this.mode;
        this.timeLeft = T.BURST_TIME;
        this.burstsThisJump++;
      }
    }

    if (!this.active) return null;

    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.active = false;
      this.cooldown = T.COOLDOWN;
      const done = this.mode;
      this.mode = null;
      return done;
    }

    if (this.mode === THRUST_MODE.EXTEND) this._extend(dt);
    else if (this.mode === THRUST_MODE.CORRECT) this._correct(dt);
    else if (this.mode === THRUST_MODE.DIVE) this._dive(dt);
    return this.mode;
  }

  /** EXTEND — forward push. §5: "adds ~20% airtime". */
  _extend(dt) {
    const T = TUNING.THRUST;
    const body = this.car.body;
    const v = body.linvel();

    const fwd = this.car.forward;
    const vh = v3(v.x, 0, v.z);
    const velDir = len(vh) > 1.0 ? norm(vh) : norm(v3(fwd.x, 0, fwd.z));

    let dir = norm(add(scale(fwd, 1 - T.EXTEND_VELOCITY_ALIGN),
                       scale(velDir, T.EXTEND_VELOCITY_ALIGN)));

    // Pillar 1, made structural. You may aim the push with the nose, but you
    // may never aim it far enough up to fly.
    if (dir.y > T.EXTEND_MAX_UP_COMPONENT) {
      dir = norm(v3(dir.x, T.EXTEND_MAX_UP_COMPONENT, dir.z));
    }

    const accel = this.setup ? this.setup.thrustAccel : T.EXTEND_ACCEL;
    body.applyImpulse(scale(dir, accel * body.mass() * dt), true);
  }

  /** CORRECT — kills angular velocity, saves a tumble. */
  _correct(dt) {
    const T = TUNING.THRUST;
    const body = this.car.body;

    const av = body.angvel();
    const k = Math.exp(-T.CORRECT_ANGVEL_KILL * dt);
    body.setAngvel({ x: av.x * k, y: av.y * k, z: av.z * k }, true);

    // A nudge toward wheels-down, rate limited so it assists and never lands
    // the car for you.
    const up = this.car.up;
    const axis = cross(up, WORLD_UP);
    const sin = len(axis);
    if (sin > 1e-3) {
      const now = body.angvel();
      const rate = Math.hypot(now.x, now.y, now.z);
      if (rate < T.CORRECT_LEVEL_MAX_RATE) {
        const t = scale(norm(axis), T.CORRECT_LEVEL_TORQUE * sin * body.mass() * dt * 0.01);
        body.applyTorqueImpulse(t, true);
      }
    }
  }

  /** DIVE — downward push, commit to a landing early. */
  _dive(dt) {
    const T = TUNING.THRUST;
    const body = this.car.body;
    const dive = this.setup ? this.setup.thrustDive : T.DIVE_ACCEL;
    body.applyImpulse(v3(0, -dive * body.mass() * dt, 0), true);

    if (T.DIVE_FORWARD_BLEED > 0) {
      const v = body.linvel();
      const k = Math.exp(-T.DIVE_FORWARD_BLEED * dt);
      body.setLinvel({ x: v.x * k, y: v.y, z: v.z * k }, true);
    }
  }
}

export default TeaseThrust;
