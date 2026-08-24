/**
 * Traffic (§4) — both behaviours ship, tunable per arena.
 *
 *   Ambient  — fixed lanes, predictable. Near-miss fodder and stable landing
 *              targets. The accessibility / party toggle.
 *   Reactive — swerves, brakes, honks. Burnout's texture and the funnier
 *              default.
 *
 * Vehicles are kinematic bodies: they drive their lanes regardless of what
 * hits them, so the car can land *on* one for a Moving-vehicle-tier stick
 * without shoving it off the road. Being clipped by one mid-air is a crash.
 */

import TUNING from '../TUNING.js';
import { RAPIER, groups, LAYER } from './physics.js';
import { makeRng, clamp } from './mathx.js';

export const GROUP_TRAFFIC = groups(LAYER.TRIGGER, LAYER.CAR | LAYER.PANEL);

export class Traffic {
  constructor(world, park, seed = TUNING.SIM.SEED) {
    this.world = world;
    this.lanes = park.lanes || [];
    this.rng = makeRng(seed ^ 0x7a1c);
    this.cars = [];
    this.nearMisses = 0;
    this.honking = 0;
    if (!this.lanes.length) return;

    const T = TUNING.TRAFFIC;
    for (let i = 0; i < T.COUNT; i++) {
      const lane = this.lanes[i % this.lanes.length];
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, 0)
      );
      const col = world.createCollider(
        RAPIER.ColliderDesc.cuboid(T.HALF.x, T.HALF.y, T.HALF.z)
          .setFriction(0.9).setRestitution(0.0)
          .setCollisionGroups(GROUP_TRAFFIC),
        body
      );
      this.cars.push({
        id: i, lane, body, collider: col,
        t: this.rng(),
        speed: T.SPEED[0] + this.rng() * (T.SPEED[1] - T.SPEED[0]),
        swerve: 0, swerveTarget: 0, panic: 0,
        rearm: 0, missed: false,
        len: Math.hypot(lane.to.x - lane.from.x, lane.to.z - lane.from.z),
      });
    }
  }

  get mode() { return TUNING.TRAFFIC.MODE; }

  reset() {
    this.nearMisses = 0;
    for (const c of this.cars) { c.t = this.rng(); c.swerve = 0; c.panic = 0; c.rearm = 0; }
  }

  /** Lane direction as a unit vector. */
  static dir(lane) {
    const dx = lane.to.x - lane.from.x, dz = lane.to.z - lane.from.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  }

  /**
   * @returns {{nearMiss:number, oncoming:boolean, honk:boolean}}
   */
  update(dt, car, boost) {
    const T = TUNING.TRAFFIC;
    if (!this.cars.length) return { nearMiss: 0, oncoming: false, honk: false };

    const p = car.position;
    const speed = car.groundSpeed;
    let nearMiss = 0;
    let honk = false;
    let oncoming = false;

    for (const c of this.cars) {
      const d = Traffic.dir(c.lane);
      const nx = -d.z, nz = d.x;                 // lane normal

      c.t += (c.speed * (1 - c.panic * T.BRAKE) * dt) / c.len;
      if (c.t > 1) c.t -= 1;

      const bx = c.lane.from.x + (c.lane.to.x - c.lane.from.x) * c.t;
      const bz = c.lane.from.z + (c.lane.to.z - c.lane.from.z) * c.t;

      // Distance to the player, in the lane's own frame.
      const rx = p.x - bx, rz = p.z - bz;
      const along = rx * d.x + rz * d.z;
      const lateral = rx * nx + rz * nz;
      const dist = Math.hypot(rx, p.y - T.HALF.y, rz);

      if (this.mode === 'reactive') {
        // Panic when the player is close and in front. Swerve *away* laterally.
        const threat = dist < T.REACT_RADIUS && along > -6 ? 1 : 0;
        c.panic += (threat - c.panic) * (1 - Math.exp(-dt * 3.2));
        if (threat && Math.abs(c.swerveTarget) < 0.01) {
          c.swerveTarget = (lateral >= 0 ? -1 : 1) * T.SWERVE;
        }
        if (!threat) c.swerveTarget = 0;
        c.swerve += clamp(c.swerveTarget - c.swerve, -T.SWERVE_RATE * dt, T.SWERVE_RATE * dt);
        // Latch the honk to the approach, not the frame — otherwise 44 cars
        // lean on the horn continuously for the whole run.
        if (threat && dist < T.HONK_RADIUS && !c.honked) { honk = true; c.honked = true; }
        if (!threat) c.honked = false;
      } else {
        c.panic = 0; c.swerve = 0; c.swerveTarget = 0; c.honked = false;
      }

      const x = bx + nx * c.swerve;
      const z = bz + nz * c.swerve;
      c.body.setNextKinematicTranslation({ x, y: T.HALF.y, z });
      const yaw = Math.atan2(d.x, d.z);
      c.body.setNextKinematicRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
      c.x = x; c.z = z; c.yaw = yaw;

      // ── Near miss (§4) ──────────────────────────────────────────────────
      if (c.rearm > 0) c.rearm -= dt;
      const close = dist < T.NEAR_MISS_RADIUS;
      if (close && !c.missed && c.rearm <= 0 && speed > T.NEAR_MISS_MIN_SPEED) {
        c.missed = true;
        c.rearm = T.NEAR_MISS_REARM;
        nearMiss++;
      }
      if (!close) c.missed = false;

      // ── Oncoming lane (§4) ──────────────────────────────────────────────
      if (c.lane.oncoming && Math.abs(lateral) < T.ONCOMING_LANE_HALF && speed > 8) {
        const f = car.forward;
        if (f.x * d.x + f.z * d.z < T.ONCOMING_DOT) oncoming = true;
      }
    }

    if (nearMiss) {
      this.nearMisses += nearMiss;
      boost.creditNearMiss(nearMiss);
    }
    this.honking = honk ? 0.4 : Math.max(0, this.honking - dt);
    return { nearMiss, oncoming, honk };
  }

  /**
   * Is this point on the roof of a traffic car? §4: landing there is a
   * Moving-vehicle-tier stick.
   */
  roofAt(p) {
    const T = TUNING.TRAFFIC;
    for (const c of this.cars) {
      if (Math.abs(p.x - c.x) > T.HALF.x + 1.2) continue;
      if (Math.abs(p.z - c.z) > T.HALF.z + 1.2) continue;
      const roof = T.HALF.y * 2;
      if (p.y > roof - 0.6 && p.y < roof + T.ROOF_TOLERANCE + 1.2) return c;
    }
    return null;
  }

  /** Every traffic collider, so contacts against them can be identified. */
  isTrafficCollider(collider) {
    return this.cars.some((c) => c.collider.handle === collider.handle);
  }

  snapshot() {
    return this.cars.map((c) => ({ id: c.id, x: c.x || 0, z: c.z || 0, yaw: c.yaw || 0, panic: c.panic }));
  }
}

export default Traffic;
