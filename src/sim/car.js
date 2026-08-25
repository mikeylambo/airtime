/**
 * Car — chassis rigid body + Rapier raycast vehicle (§1 "Rapier for all car
 * physics; no fake flight").
 *
 * On the ground this is a DynamicRayCastVehicleController: real suspension,
 * real tyre friction, deliberately loose sideways grip so it drifts like a
 * Burnout car (§4). The instant the wheels leave the ramp nothing changes —
 * the same rigid body is simply in free flight with no suspension forces, so
 * the tumble is whatever the launch actually imparted. There is no airborne
 * mode, no scripted rotation, no flight model. That is the point.
 */

import TUNING from '../TUNING.js';
import { RAPIER, GROUP_CAR, WHEEL_RAY_GROUPS } from './physics.js';
import {
  clamp, v3, add, sub, scale, dot, norm, qRot, qInvRot, qAxisAngle,
  LOCAL_FORWARD, LOCAL_UP, LOCAL_RIGHT, WORLD_UP, approach,
} from './mathx.js';

// Rapier's raycast vehicle drives along its forward axis index; our chassis
// faces local -Z, so engine force and steering both need the flip. Verified by
// tools/gate-a.mjs, which fails loudly if a throttle input moves the car the
// wrong way.
export const ENGINE_SIGN = -1;
export const STEER_SIGN = -1;

const FRONT = [0, 1];
const REAR = [2, 3];

export class Car {
  /** @param setup resolved garage setup (src/sim/cars.js); null = baseline. */
  constructor(world, setup = null) {
    this.world = world;
    this.setup = setup;
    const C = TUNING.CAR;
    const W = TUNING.WHEEL;
    const mass = setup ? setup.mass : C.MASS;
    const inertia = setup ? setup.inertiaScale : C.INERTIA_SCALE;

    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 5, 0)
      .setLinearDamping(C.LINEAR_DAMPING)
      .setAngularDamping(C.ANGULAR_DAMPING)
      .setCanSleep(false);
    if (C.CCD) desc.setCcdEnabled(true);
    this.body = world.createRigidBody(desc);

    const half = setup ? setup.half : C.HALF;
    const wheelPos = setup ? setup.wheel
      : { halfTrack: W.HALF_TRACK, frontZ: W.AXLE_FRONT_Z, rearZ: W.AXLE_REAR_Z };
    const col = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setFriction(C.FRICTION)
      .setRestitution(C.RESTITUTION)
      .setCollisionGroups(GROUP_CAR);
    // Box inertia about the centre, then scaled per axis: pitch/roll/yaw
    // response is a feel number, not a consequence of the collider shape.
    const m = mass;
    const I = {
      x: (m / 3) * (half.y ** 2 + half.z ** 2) * inertia.x,
      y: (m / 3) * (half.x ** 2 + half.z ** 2) * inertia.y,
      z: (m / 3) * (half.x ** 2 + half.y ** 2) * inertia.z,
    };
    col.setMassProperties(m, C.COM, I, { x: 0, y: 0, z: 0, w: 1 });
    this.collider = world.createCollider(col, this.body);
    this.sideFriction = setup ? setup.sideFriction : W.SIDE_FRICTION;
    // A car that is loose *everywhere* does not drift, it understeers in a
    // straight line — the chassis never rotates away from its own velocity.
    // Slip needs a front that bites and a rear that does not, so grip is per
    // axle. DRIFTER is the only car that leans on it hard.
    this.sideFrictionRear = setup ? setup.sideFrictionRear : W.SIDE_FRICTION;

    // ── Raycast vehicle ───────────────────────────────────────────────────
    this.vehicle = world.createVehicleController(this.body);
    this.vehicle.indexUpAxis = 1;
    this.vehicle.setIndexForwardAxis = 2;

    const dir = v3(0, -1, 0);
    const axle = v3(-1, 0, 0);
    const pts = [
      v3(-wheelPos.halfTrack, W.CONNECT_Y, wheelPos.frontZ),
      v3(wheelPos.halfTrack, W.CONNECT_Y, wheelPos.frontZ),
      v3(-wheelPos.halfTrack, W.CONNECT_Y, wheelPos.rearZ),
      v3(wheelPos.halfTrack, W.CONNECT_Y, wheelPos.rearZ),
    ];
    for (const p of pts) this.vehicle.addWheel(p, dir, axle, W.SUSPENSION_REST, W.RADIUS);
    for (let i = 0; i < 4; i++) {
      this.vehicle.setWheelSuspensionStiffness(i, setup ? setup.suspensionStiffness : W.SUSPENSION_STIFFNESS);
      this.vehicle.setWheelSuspensionCompression(i, W.SUSPENSION_COMPRESSION);
      this.vehicle.setWheelSuspensionRelaxation(i, W.SUSPENSION_RELAXATION);
      this.vehicle.setWheelMaxSuspensionTravel(i, W.MAX_SUSPENSION_TRAVEL);
      this.vehicle.setWheelMaxSuspensionForce(i, setup ? setup.maxSuspensionForce : W.MAX_SUSPENSION_FORCE);
      this.vehicle.setWheelFrictionSlip(i, W.FRICTION_SLIP);
      this.vehicle.setWheelSideFrictionStiffness(i, i < 2 ? this.sideFriction : this.sideFrictionRear);
    }

    this.steer = 0;          // current steering column angle, radians
    this.driftTime = 0;
    this.slipAngle = 0;
    this.wheelsInContact = 0;
    this.wheelContact = [false, false, false, false];
    this.contactNormal = { ...WORLD_UP };
  }

  reset(pos = TUNING.ARENA.SPAWN, heading = TUNING.ARENA.SPAWN_HEADING) {
    const q = qAxisAngle(WORLD_UP, heading);
    this.body.setTranslation(pos, true);
    this.body.setRotation(q, true);
    this.body.setLinvel(v3(), true);
    this.body.setAngvel(v3(), true);
    this.steer = 0;
    this.driftTime = 0;
    for (let i = 0; i < 4; i++) {
      this.vehicle.setWheelEngineForce(i, 0);
      this.vehicle.setWheelBrake(i, 0);
      this.vehicle.setWheelSteering(i, 0);
    }
  }

  // ── Frame accessors ──────────────────────────────────────────────────────
  get position() { return this.body.translation(); }
  get rotation() { return this.body.rotation(); }
  get linvel() { return this.body.linvel(); }
  get angvel() { return this.body.angvel(); }
  get forward() { return qRot(this.rotation, LOCAL_FORWARD); }
  get up() { return qRot(this.rotation, LOCAL_UP); }
  get right() { return qRot(this.rotation, LOCAL_RIGHT); }
  get speed() { return Math.hypot(this.linvel.x, this.linvel.y, this.linvel.z); }
  get groundSpeed() { const v = this.linvel; return Math.hypot(v.x, v.z); }
  /** Signed speed along the car's own forward axis. */
  get forwardSpeed() { return dot(this.linvel, this.forward); }

  /** Angle between the car's up and world up, radians. 0 = level. */
  get tiltAngle() { return Math.acos(clamp(dot(this.up, WORLD_UP), -1, 1)); }

  /** Angle between the car's up and the surface it is touching. */
  get landingAngle() { return Math.acos(clamp(dot(this.up, this.contactNormal), -1, 1)); }

  /**
   * Ground handling (§4). Only meaningful while wheels are in contact; when
   * airborne the vehicle controller finds no ground and applies nothing.
   */
  update(dt, actions, boosting) {
    const D = TUNING.DRIVE;
    const W = TUNING.WHEEL;
    const speed = this.groundSpeed;

    // ── Steering: full lock at a crawl, tightened at speed ─────────────────
    const t = clamp(speed / D.STEER_SPEED_FALLOFF, 0, 1);
    const maxSteer = D.STEER_MAX + (D.STEER_MIN - D.STEER_MAX) * t;
    const wantSteer = actions.steer * maxSteer * STEER_SIGN;
    const rate = Math.abs(wantSteer) > Math.abs(this.steer) ? D.STEER_RATE : D.STEER_RETURN_RATE;
    this.steer += clamp(wantSteer - this.steer, -rate * dt, rate * dt);
    for (const i of FRONT) this.vehicle.setWheelSteering(i, this.steer);

    // ── Engine ─────────────────────────────────────────────────────────────
    const cap = boosting ? D.TOP_SPEED_BOOST : D.TOP_SPEED;
    const overrun = clamp((speed - (cap - D.SPEED_CAP_FALLOFF)) / D.SPEED_CAP_FALLOFF, 0, 1);
    const capFade = 1 - overrun;
    const peak = boosting
      ? (this.setup ? this.setup.engineForceBoost : D.ENGINE_FORCE_BOOST)
      : (this.setup ? this.setup.engineForce : D.ENGINE_FORCE);

    let engine = 0;
    if (actions.throttle > 0) engine = actions.throttle * peak * capFade;
    else if (boosting) engine = peak * capFade;   // boost implies throttle

    // Brake pedal reverses once we have basically stopped, Burnout style.
    let brake = 0;
    if (actions.brake > 0) {
      if (this.forwardSpeed * ENGINE_SIGN > -1.0) brake = actions.brake * D.BRAKE_FORCE;
      else engine = -actions.brake * D.REVERSE_FORCE;
    }

    const driven = D.DRIVEN_WHEELS === 'front' ? FRONT : D.DRIVEN_WHEELS === 'all' ? [0, 1, 2, 3] : REAR;
    for (let i = 0; i < 4; i++) {
      this.vehicle.setWheelEngineForce(i, driven.includes(i) ? engine * ENGINE_SIGN : 0);
      this.vehicle.setWheelBrake(i, brake);
    }

    // ── Handbrake: drop the rear grip, that's the whole drift (§4) ──────────
    if (actions.handbrake) {
      for (const i of REAR) {
        this.vehicle.setWheelSideFrictionStiffness(i, this.sideFrictionRear * D.HANDBRAKE_SIDE_FRICTION);
        this.vehicle.setWheelBrake(i, D.HANDBRAKE_FORCE);
      }
    } else {
      for (const i of REAR) this.vehicle.setWheelSideFrictionStiffness(i, this.sideFrictionRear);
    }

    this.vehicle.updateVehicle(dt, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC, WHEEL_RAY_GROUPS);

    // ── Contact bookkeeping for airtime + landing quality ──────────────────
    let n = 0;
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < 4; i++) {
      const down = this.vehicle.wheelIsInContact(i);
      this.wheelContact[i] = down;
      if (!down) continue;
      n++;
      const cn = this.vehicle.wheelContactNormal(i);
      if (cn) { nx += cn.x; ny += cn.y; nz += cn.z; }
    }
    this.wheelsInContact = n;
    this.contactNormal = n > 0 ? norm(v3(nx, ny, nz)) : { ...WORLD_UP };

    // ── Drift measure: angle between where we point and where we go (§4) ────
    const v = this.linvel;
    const horiz = v3(v.x, 0, v.z);
    if (speed > D.DRIFT_MIN_SPEED && n >= 2) {
      const f = this.forward;
      const fh = norm(v3(f.x, 0, f.z));
      const vh = norm(horiz);
      this.slipAngle = Math.acos(clamp(Math.abs(dot(fh, vh)), -1, 1));
      this.driftTime = this.slipAngle > D.DRIFT_MIN_SLIP_ANGLE ? this.driftTime + dt : 0;
    } else {
      this.slipAngle = 0;
      this.driftTime = 0;
    }
  }

  // Wheel order is [FL, FR, RL, RR] — see the connection points above.
  get frontDown() { return this.wheelContact[0] && this.wheelContact[1]; }
  get rearDown() { return this.wheelContact[2] && this.wheelContact[3]; }
  get leftDown() { return this.wheelContact[0] && this.wheelContact[2]; }
  get rightDown() { return this.wheelContact[1] && this.wheelContact[3]; }

  /** Signed nose pitch above horizontal, radians. */
  get pitchAngle() { return Math.asin(clamp(this.forward.y, -1, 1)); }

  /** Wheel transforms for the renderer. */
  wheelState(i) {
    const W = TUNING.WHEEL;
    const conn = this.vehicle.wheelChassisConnectionPointCs(i) || v3();
    const susp = this.vehicle.wheelSuspensionLength(i);
    const drop = (susp == null ? W.SUSPENSION_REST : susp);
    return {
      localPos: v3(conn.x, conn.y - drop, conn.z),
      steer: this.vehicle.wheelSteering(i) || 0,
      spin: this.vehicle.wheelRotation(i) || 0,
      contact: this.vehicle.wheelIsInContact(i),
    };
  }
}

export default Car;
