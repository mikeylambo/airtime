/**
 * Body-as-trick — the four hinged part slots (§5.1, pillar 5).
 *
 * Each panel is a genuine Rapier rigid body on a revolute joint with hinge
 * limits and a position motor. Deploying a part drives the motor; the air then
 * does whatever it does. Nothing about "doors slow the spin" or "hood pitches
 * back" is coded as a rule — those are consequences of where the plate sits
 * and which way it faces, measured by tools/probe-aero.mjs.
 *
 * Slots (§5.1): doors (split L/R so one door is a roll input), hood, trunk,
 * spoiler. Panels are air-only, and a hard enough landing tears them off.
 */

import TUNING from '../TUNING.js';
import { RAPIER, GROUP_PANEL } from './physics.js';
import {
  v3, add, sub, scale, dot, len, norm, qRot, qAxisAngle, clamp,
} from './mathx.js';

export const SLOTS = ['DOOR_L', 'DOOR_R', 'HOOD', 'TRUNK', 'SPOILER'];

/** Which action drives which slot. */
const SLOT_ACTION = {
  DOOR_L: 'doorL', DOOR_R: 'doorR', HOOD: 'hood', TRUNK: 'trunk', SPOILER: 'spoiler',
};

export class Panels {
  constructor(world, car, setup = null) {
    this.world = world;
    this.car = car;
    this.setup = setup;
    this.parts = {};

    const P = TUNING.PANELS;
    const chassisPos = car.position;
    const chassisRot = car.rotation;

    for (const slot of SLOTS) {
      // A part variant is a different piece of bodywork, not a stat: it changes
      // how far the hinge opens, and the aero then does what it does (§7).
      const tuned = setup && setup.panels[slot];
      // The hinge point rides the chassis box, so a longer car's doors sit
      // further out and swing on a longer moment arm — which is part of why a
      // NEEDLE and a STUB do not fly alike.
      const cfg = tuned
        ? { ...P[slot], open: tuned.open, hinge: tuned.hinge,
            centerOffset: tuned.centerOffset, size: tuned.size }
        : P[slot];
      const panelMass = tuned ? tuned.mass : P.MASS;
      const axis = norm(cfg.axis);

      // Panel spawns stowed: hinge point plus the offset to its centre, both
      // carried out of chassis-local space into the world.
      const localCentre = add(cfg.hinge, cfg.centerOffset);
      const worldCentre = add(chassisPos, qRot(chassisRot, localCentre));

      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(worldCentre.x, worldCentre.y, worldCentre.z)
          .setRotation(chassisRot)
          .setCanSleep(false)
          .setAngularDamping(0.4)
      );
      const col = RAPIER.ColliderDesc.cuboid(cfg.size.x, cfg.size.y, cfg.size.z)
        .setMass(panelMass)
        .setFriction(0.5)
        .setRestitution(0.05)
        .setCollisionGroups(GROUP_PANEL);
      const collider = world.createCollider(col, body);

      // anchor1 in chassis-local, anchor2 in panel-local (centre → hinge).
      const anchor2 = scale(cfg.centerOffset, -1);
      const jd = RAPIER.JointData.revolute(cfg.hinge, anchor2, axis);
      const joint = world.createImpulseJoint(jd, car.body, body, true);
      joint.setContactsEnabled(false);   // the door must not fight the chassis
      joint.setLimits(cfg.limitMin, cfg.limitMax);
      joint.configureMotorModel(RAPIER.MotorModel.AccelerationBased);
      joint.setMotorMaxForce(P.MOTOR_MAX_FORCE);
      joint.configureMotorPosition(0, P.STOW_STIFFNESS, P.STOW_DAMPING);

      this.parts[slot] = {
        slot, cfg, axis, body, collider, joint,
        deploy: 0,          // 0..1 commanded
        angle: 0,           // 0..1 achieved (approximated from the motor target)
        attached: true,
        poseTime: 0,        // seconds held open — feeds held-pose scoring (item 5)
      };
    }
  }

  get list() { return SLOTS.map((s) => this.parts[s]).filter((p) => p.attached); }

  /** Deployment state for the HUD / trick ticker. */
  snapshot() {
    const out = {};
    for (const s of SLOTS) {
      const p = this.parts[s];
      out[s] = { deploy: p.deploy, attached: p.attached, poseTime: p.poseTime };
    }
    return out;
  }

  reset() {
    const P = TUNING.PANELS;
    for (const p of this.list) {
      p.deploy = 0;
      p.poseTime = 0;
      p.joint.configureMotorPosition(0, P.STOW_STIFFNESS, P.STOW_DAMPING);
    }
    this.syncToChassis();
  }

  /** Teleport panels back onto the chassis — used after a reset. */
  syncToChassis() {
    const pos = this.car.position;
    const rot = this.car.rotation;
    for (const p of this.list) {
      const localCentre = add(p.cfg.hinge, p.cfg.centerOffset);
      const world = add(pos, qRot(rot, localCentre));
      p.body.setTranslation(world, true);
      p.body.setRotation(rot, true);
      p.body.setLinvel(v3(), true);
      p.body.setAngvel(v3(), true);
    }
  }

  /**
   * Drive the motors from input. Panels are air-only (§5.1), so on the ground
   * every target snaps home with the stiffer stow gains.
   */
  update(dt, actions, airborne) {
    const P = TUNING.PANELS;
    const allowed = airborne || !P.AIR_ONLY;

    for (const p of this.list) {
      const want = allowed ? clamp(actions[SLOT_ACTION[p.slot]] || 0, 0, 1) : 0;
      p.deploy = want;
      p.poseTime = want > 0.5 ? p.poseTime + dt : 0;

      const target = p.cfg.open * want;
      if (want > 0.01) p.joint.configureMotorPosition(target, P.MOTOR_STIFFNESS, P.MOTOR_DAMPING);
      else p.joint.configureMotorPosition(0, P.STOW_STIFFNESS, P.STOW_DAMPING);
    }
  }

  /**
   * Extra spoiler behaviour (§5.1 "stability; some variants add micro-lift").
   * The spoiler's plate drag is handled by the shared aero pass like every
   * other panel; this is only the stabiliser, applied as angular damping on
   * the chassis rather than as a torque so it can never rotate the car itself.
   */
  applySpoiler(dt) {
    const sp = this.parts.SPOILER;
    if (!sp.attached || sp.deploy < 0.05) return;
    const cfg = TUNING.PANELS.SPOILER;
    const lift = this.setup ? this.setup.panels.SPOILER.lift : 1;
    const av = this.car.body.angvel();
    const k = Math.exp(-cfg.YAW_STABILISE * lift * sp.deploy * dt);
    // Damp yaw and pitch, leave roll alone: a spoiler steadies the car, it
    // does not stop you spinning on the axis you are actually tricking on.
    this.car.body.setAngvel({ x: av.x * k, y: av.y * k, z: av.z }, true);
  }

  /**
   * Tear-off (§5.1) — spectacle, no penalty beyond losing that verb. Detected
   * from how hard the panel is being dragged away from where the hinge says it
   * should be, which is what a bad landing on a deployed door looks like.
   */
  checkTearOff() {
    const P = TUNING.PANELS;
    if (!P.TEAROFF_ENABLED) return [];
    const torn = [];
    const pos = this.car.position;
    const rot = this.car.rotation;
    const carVel = this.car.body.linvel();

    for (const p of this.list) {
      if (P.TEAROFF_ONLY_WHEN_DEPLOYED && p.deploy < 0.5) continue;
      const pv = p.body.linvel();
      const rel = Math.hypot(pv.x - carVel.x, pv.y - carVel.y, pv.z - carVel.z);
      if (rel < P.TEAROFF_IMPACT_SPEED) continue;

      this.world.removeImpulseJoint(p.joint, true);
      p.attached = false;
      p.deploy = 0;
      torn.push(p.slot);
    }
    return torn;
  }

  /** Reattach everything (fresh run). */
  restoreAll() {
    const P = TUNING.PANELS;
    for (const slot of SLOTS) {
      const p = this.parts[slot];
      if (p.attached) continue;
      const anchor2 = scale(p.cfg.centerOffset, -1);
      const jd = RAPIER.JointData.revolute(p.cfg.hinge, anchor2, p.axis);
      p.joint = this.world.createImpulseJoint(jd, this.car.body, p.body, true);
      p.joint.setContactsEnabled(false);
      p.joint.setLimits(p.cfg.limitMin, p.cfg.limitMax);
      p.joint.configureMotorModel(RAPIER.MotorModel.AccelerationBased);
      p.joint.setMotorMaxForce(P.MOTOR_MAX_FORCE);
      p.joint.configureMotorPosition(0, P.STOW_STIFFNESS, P.STOW_DAMPING);
      p.attached = true;
    }
    this.syncToChassis();
  }
}

export default Panels;
