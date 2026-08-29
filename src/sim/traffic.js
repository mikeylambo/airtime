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
        rearm: 0, seen: new Set(),
        len: Math.hypot(lane.to.x - lane.from.x, lane.to.z - lane.from.z),
      });
    }
  }

  get mode() { return TUNING.TRAFFIC.MODE; }

  /**
   * Reroll for a new round. With a seed the reroll is *reproducible* — §R:
   * a replayed clip has to see the same traffic the recording saw, and
   * continuing the sequence (the old behaviour, still the fallback) can only
   * ever say "different traffic every restart".
   */
  reset(seed) {
    this.nearMisses = 0;
    if (seed !== undefined) this.rng = makeRng((seed >>> 0) ^ 0x7a1c);
    for (const c of this.cars) { c.t = this.rng(); c.swerve = 0; c.panic = 0; c.rearm = 0; c.seen = new Set(); }
  }

  /** Lane direction as a unit vector. */
  static dir(lane) {
    const dx = lane.to.x - lane.from.x, dz = lane.to.z - lane.from.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  }

  /**
   * @param players one or more Players sharing this road (§9 split-screen)
   * @returns {{nearMiss:number[], oncoming:boolean[], honk:boolean}}
   */
  update(dt, players) {
    const T = TUNING.TRAFFIC;
    const list = Array.isArray(players) ? players : [players];
    const nearMiss = list.map(() => 0);
    const oncoming = list.map(() => false);
    let honk = false;
    if (!this.cars.length) return { nearMiss, oncoming, honk };

    for (const c of this.cars) {
      const d = Traffic.dir(c.lane);
      const nx = -d.z, nz = d.x;                 // lane normal

      c.t += (c.speed * (1 - c.panic * T.BRAKE) * dt) / c.len;
      if (c.t > 1) c.t -= 1;

      const bx = c.lane.from.x + (c.lane.to.x - c.lane.from.x) * c.t;
      const bz = c.lane.from.z + (c.lane.to.z - c.lane.from.z) * c.t;

      // React to whoever is closest — a car does not get to panic four ways.
      let near = null, nearDist = Infinity, nearIdx = -1;
      for (let i = 0; i < list.length; i++) {
        const p = list[i].car.position;
        const dist = Math.hypot(p.x - bx, p.y - T.HALF.y, p.z - bz);
        if (dist < nearDist) { nearDist = dist; near = list[i]; nearIdx = i; }
      }
      const rp = near.car.position;
      const rx = rp.x - bx, rz = rp.z - bz;
      const along = rx * d.x + rz * d.z;
      const lateral = rx * nx + rz * nz;

      if (this.mode === 'reactive') {
        const threat = nearDist < T.REACT_RADIUS && along > -6 ? 1 : 0;
        c.panic += (threat - c.panic) * (1 - Math.exp(-dt * 3.2));
        if (threat && Math.abs(c.swerveTarget) < 0.01) {
          c.swerveTarget = (lateral >= 0 ? -1 : 1) * T.SWERVE;
        }
        if (!threat) c.swerveTarget = 0;
        c.swerve += clamp(c.swerveTarget - c.swerve, -T.SWERVE_RATE * dt, T.SWERVE_RATE * dt);
        // Latch the honk to the approach, not the frame.
        if (threat && nearDist < T.HONK_RADIUS && !c.honked) { honk = true; c.honked = true; }
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

      // ── Near miss and oncoming, per player (§4) ─────────────────────────
      if (c.rearm > 0) c.rearm -= dt;
      c.seen = c.seen || new Set();
      for (let i = 0; i < list.length; i++) {
        const pl = list[i];
        const p = pl.car.position;
        // To where the car actually *is*, not to its lane centre: a reactive
        // car swerves up to 1.8 m out of lane, which was enough for a clean
        // pass at speed to measure as a miss and pay nothing.
        const dist = Math.hypot(p.x - x, p.y - T.HALF.y, p.z - z);
        const close = dist < T.NEAR_MISS_RADIUS;
        const key = i;
        if (close && !c.seen.has(key) && c.rearm <= 0 && pl.car.groundSpeed > T.NEAR_MISS_MIN_SPEED) {
          c.seen.add(key);
          c.rearm = T.NEAR_MISS_REARM;
          nearMiss[i]++;
        }
        if (!close) c.seen.delete(key);

        if (c.lane.oncoming && pl.car.groundSpeed > 8) {
          const lat = (p.x - x) * nx + (p.z - z) * nz;
          if (Math.abs(lat) < T.ONCOMING_LANE_HALF) {
            const f = pl.car.forward;
            if (f.x * d.x + f.z * d.z < T.ONCOMING_DOT) oncoming[i] = true;
          }
        }
      }
    }

    for (let i = 0; i < list.length; i++) {
      if (!nearMiss[i]) continue;
      this.nearMisses += nearMiss[i];
      list[i].boost.creditNearMiss(nearMiss[i]);
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
