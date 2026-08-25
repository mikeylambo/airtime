/**
 * Aerodynamics — why the parts steer the air (§5.1, pillar 5).
 *
 * Every deployed panel is treated as a flat plate: drag normal to its face
 * scales with the square of the normal component of its own velocity, applied
 * at the plate's centre. Because the panels are real rigid bodies on real
 * hinges, that force reaches the chassis through the joint — a door catching
 * air genuinely levers the car. Nothing here special-cases "this is the roll
 * input"; roll falls out of one door having more drag than the other.
 *
 * Pillar 1 is enforced structurally, not hoped for: the summed upward aero
 * force is clamped to a fraction of the car's weight every single step, so no
 * combination of parts and tuning can ever hold the car up. Gravity wins.
 */

import TUNING from '../TUNING.js';
import { v3, add, sub, scale, dot, len, qRot, qInvRot } from './mathx.js';

/** Index of the smallest half-extent — a flat plate's normal axis. */
function normalAxis(size) {
  if (size.x <= size.y && size.x <= size.z) return 0;
  if (size.y <= size.z) return 1;
  return 2;
}

/** Face area of the plate, and its side (skin) area. */
export function plateAreas(size) {
  const ax = normalAxis(size);
  const d = [size.x * 2, size.y * 2, size.z * 2];
  const face = ax === 0 ? d[1] * d[2] : ax === 1 ? d[0] * d[2] : d[0] * d[1];
  const skin = 2 * (d[0] * d[1] + d[1] * d[2] + d[0] * d[2]) - 2 * face;
  return { axis: ax, face, skin };
}

const AXIS_VEC = [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)];

/**
 * Accumulates aero forces for one step, then applies them with the lift clamp.
 * Usage: begin() → addPlate(...) per surface → apply(dt).
 */
export class AeroAccumulator {
  constructor() { this.entries = []; this.applied = []; this.upward = 0; }

  begin() { this.entries.length = 0; this.upward = 0; }

  /**
   * @param body   Rapier rigid body the force acts on
   * @param point  world-space application point
   * @param force  world-space force in newtons
   */
  push(body, point, force) {
    const A = TUNING.AERO;
    const m = len(force);
    if (m > A.MAX_PANEL_FORCE) force = scale(force, A.MAX_PANEL_FORCE / m);
    if (force.y > 0) this.upward += force.y;
    this.entries.push({ body, point, force });
  }

  /**
   * Flat-plate drag for one surface.
   * @param body  the body the plate belongs to (its velocity is sampled)
   * @param rot   the plate's world rotation quaternion
   * @param pos   the plate's world centre
   * @param size  half-extents in the plate's local frame
   * @param cd    plate drag coefficient
   * @param gain  extra multiplier (TUNING.AERO.PANEL_SCALE etc.)
   * @param applyTo  body that actually receives the force
   */
  addPlate(body, rot, pos, size, cd, gain, applyTo = body) {
    const A = TUNING.AERO;
    const { axis, face, skin } = plateAreas(size);
    const n = qRot(rot, AXIS_VEC[axis]);

    // Velocity of this plate's centre, including the body's spin about it.
    const lv = body.linvel();
    const av = body.angvel();
    const com = body.worldCom();
    const r = sub(pos, com);
    const v = add(lv, {
      x: av.y * r.z - av.z * r.y,
      y: av.z * r.x - av.x * r.z,
      z: av.x * r.y - av.y * r.x,
    });

    const vn = dot(v, n);
    const q = 0.5 * A.AIR_DENSITY * gain;
    // |vn| * vn keeps the sign: drag always opposes the normal motion.
    const fNormal = scale(n, -q * face * cd * Math.abs(vn) * vn);

    const vt = sub(v, scale(n, vn));
    const vtm = len(vt);
    // Quadratic skin drag along the plate, opposing the tangential motion.
    const fSkin = vtm > 1e-4 ? scale(vt, -q * skin * A.PANEL_SKIN_DRAG * vtm) : v3();

    this.push(applyTo, pos, add(fNormal, fSkin));
  }

  /**
   * Chassis drag: the box treated as three plates, one per local axis, all
   * acting at its centre. Decomposing it this way is what makes a car that is
   * tumbling sideways drag far more than one flying nose-first, which is most
   * of why a bad attitude costs you distance.
   */
  addBoxPlates(body, rot, origin, half, cd, gain, cops_ = null) {
    const d = [half.x * 2, half.y * 2, half.z * 2];
    const areas = [d[1] * d[2], d[0] * d[2], d[0] * d[1]];
    const A = TUNING.AERO;
    // Each plate acts at its own centre of pressure (see TUNING.AERO): the
    // side force behind the CoM to weathercock in yaw, the vertical force
    // almost at it so pitch stays free.
    const cops = cops_
      ? [cops_.side, cops_.lift, cops_.axial]
      : [A.COP_SIDE, A.COP_LIFT, A.COP_AXIAL];
    const lv = body.linvel();
    const av = body.angvel();
    const com = body.worldCom();

    for (let i = 0; i < 3; i++) {
      const pos = add(origin, qRot(rot, cops[i]));
      const r = sub(pos, com);
      const v = add(lv, {
        x: av.y * r.z - av.z * r.y,
        y: av.z * r.x - av.x * r.z,
        z: av.x * r.y - av.y * r.x,
      });
      const n = qRot(rot, AXIS_VEC[i]);
      const vn = dot(v, n);
      if (Math.abs(vn) < 1e-4) continue;
      const f = scale(n, -0.5 * A.AIR_DENSITY * gain * areas[i] * cd * Math.abs(vn) * vn);
      this.push(body, pos, f);
    }
  }

  /** Apply everything, clamping net lift so gravity always wins (pillar 1). */
  apply(dt, carMass, gravity) {
    const A = TUNING.AERO;
    const maxLift = A.MAX_LIFT_FRACTION_OF_WEIGHT * carMass * Math.abs(gravity);
    const liftScale = this.upward > maxLift && this.upward > 0 ? maxLift / this.upward : 1;

    this.applied.length = 0;
    for (const e of this.entries) {
      const f = liftScale === 1 || e.force.y <= 0
        ? e.force
        : { x: e.force.x, y: e.force.y * liftScale, z: e.force.z };
      e.body.applyImpulseAtPoint(scale(f, dt), e.point, true);
      this.applied.push({ body: e.body, point: e.point, force: f });
    }
    this.liftScale = liftScale;
    return liftScale;
  }
}

/** Rotational air drag on the chassis — the reason a tumble decays. */
/**
 * Rotational air drag, per axis, in the *car's* frame.
 *
 * A single scalar damps the axis you want free as hard as the one you want
 * damped. Yaw wants damping — a car weathervaning about its own vertical axis
 * mid-flight reads as broken. Pitch and roll do not: those are the trick axes.
 */
/**
 * Body lift: a flat car flying nose-first is a wing at a small angle of
 * attack, and some of the roster leans on that much harder than the rest.
 *
 * Without this the flight is purely ballistic and "glide" is not a property a
 * car can have — every arc is the same parabola and the only thing that moves
 * range is how you left the lip. Lift acts at the lift centre of pressure, so
 * a car that generates a lot of it also trims its own pitch, which is exactly
 * the trade a long glider should be making.
 */
export function addBodyLift(acc, body, rot, origin, half, cl, cop) {
  if (cl <= 0) return;
  const v = body.linvel();
  const speed = Math.hypot(v.x, v.y, v.z);
  if (speed < 4) return;
  const up = qRot(rot, { x: 0, y: 1, z: 0 });
  const fwd = qRot(rot, { x: 0, y: 0, z: -1 });
  // Angle of attack, signed: positive when the nose is above the flight path.
  const alpha = -(dot(v, up) / speed);
  const along = dot(v, fwd) / speed;
  if (along <= 0) return;                       // flying backwards produces nothing
  const area = half.x * 2 * half.z * 2;
  const q = 0.5 * TUNING.AERO.AIR_DENSITY * speed * speed * area;
  // Linear in alpha and capped, so it behaves like a wing rather than a rocket.
  const lift = q * cl * Math.max(-0.5, Math.min(0.5, alpha + 0.06)) * along;
  acc.push(body, add(origin, qRot(rot, cop)), scale(up, lift));
}

export function applyAngularDrag(body, dt, scale_ = 1, perAxis = null) {
  const D = perAxis || TUNING.AERO.ANG_DRAG;
  const rot = body.rotation();
  const w = qInvRot(rot, body.angvel());
  w.x *= Math.exp(-D.pitch * scale_ * dt);
  w.y *= Math.exp(-D.yaw * scale_ * dt);
  w.z *= Math.exp(-D.roll * scale_ * dt);
  body.setAngvel(qRot(rot, w), true);
}
