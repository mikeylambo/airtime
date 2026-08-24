/**
 * Moving landing targets (§6.2) — train, helicopter, rotating billboard.
 *
 * "Each is a landing target with a moving tier multiplier, an authored route,
 * and a predictable cycle so players can time it."
 *
 * Kinematic, like traffic: they run their route regardless of what lands on
 * them. Timing them is the skill; shoving them is not an option.
 */

import TUNING from '../TUNING.js';
import { RAPIER } from './physics.js';
import { GROUP_TRAFFIC } from './traffic.js';

export class Movers {
  constructor(world, arena) {
    this.world = world;
    this.specs = arena.movers || [];
    this.items = [];
    this.t = 0;

    for (const spec of this.specs) {
      if (spec.kind === 'train') {
        for (let i = 0; i < spec.cars; i++) this.items.push(this._make(spec, i));
      } else {
        this.items.push(this._make(spec, 0));
      }
    }
  }

  _make(spec, index) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -60, 0)
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(spec.half.x, spec.half.y, spec.half.z)
        .setFriction(1.0).setRestitution(0)
        .setCollisionGroups(GROUP_TRAFFIC),
      body
    );
    return { spec, index, body, collider, x: 0, y: spec.y, z: 0, yaw: 0, faceUp: true };
  }

  reset() { this.t = 0; }

  update(dt) {
    this.t += dt;
    for (const m of this.items) {
      const s = m.spec;
      if (s.kind === 'train') this._train(m, s);
      else if (s.kind === 'heli') this._heli(m, s);
      else this._billboard(m, s);

      m.body.setNextKinematicTranslation({ x: m.x, y: m.y, z: m.z });
      m.body.setNextKinematicRotation({
        x: Math.sin(m.pitch || 0) * 0, y: Math.sin(m.yaw / 2), z: 0, w: Math.cos(m.yaw / 2),
      });
    }
  }

  /** A rolling rooftop, five cars long, wrapping the line (§6.2). */
  _train(m, s) {
    const len = Math.hypot(s.to.x - s.from.x, s.to.z - s.from.z);
    const total = len + s.cars * s.gap;
    const d = ((this.t * s.speed + m.index * s.gap) % total);
    const u = d / len;
    m.x = s.from.x + (s.to.x - s.from.x) * Math.min(u, 1);
    m.z = s.from.z + (s.to.z - s.from.z) * Math.min(u, 1);
    m.y = s.y;
    m.yaw = Math.atan2(s.to.x - s.from.x, s.to.z - s.from.z);
    // Off the end of the line it parks below the world until it wraps.
    m.active = u <= 1;
    if (!m.active) m.y = -60;
  }

  /** Hovers, then relocates every `hold` seconds (§6.2). */
  _heli(m, s) {
    const n = s.stations.length;
    const cycle = s.hold;
    const idx = Math.floor(this.t / cycle) % n;
    const nxt = (idx + 1) % n;
    const u = (this.t % cycle) / cycle;
    // Nine tenths of the cycle is a hover; the move is quick and legible.
    const move = Math.max(0, (u - 0.88) / 0.12);
    const e = move * move * (3 - 2 * move);
    m.x = s.stations[idx].x + (s.stations[nxt].x - s.stations[idx].x) * e;
    m.z = s.stations[idx].z + (s.stations[nxt].z - s.stations[idx].z) * e;
    m.y = s.y + Math.sin(this.t * 1.1) * 0.35;
    m.yaw = this.t * 0.4;
    m.active = true;
  }

  /** Rotating panel: billboard tier only while face-up (§6.2). */
  _billboard(m, s) {
    m.x = s.at.x;
    m.z = s.at.z;
    m.y = s.y;
    m.yaw = this.t * s.spin;
    // The panel is a flat plate; "face up" is when its long axis is level.
    m.faceUp = Math.cos(this.t * s.spin * 2) > -0.2;
    m.active = true;
  }

  /**
   * Is this point on top of a mover? Returns the tier to score it at, or null.
   * §6.2: the billboard only pays billboard tier while face-up.
   */
  targetAt(p) {
    for (const m of this.items) {
      if (m.active === false) continue;
      const s = m.spec;
      if (Math.abs(p.x - m.x) > s.half.x + 1.4) continue;
      if (Math.abs(p.z - m.z) > s.half.z + 1.4) continue;
      const roof = m.y + s.half.y;
      if (p.y < roof - 0.8 || p.y > roof + TUNING.TRAFFIC.ROOF_TOLERANCE + 1.4) continue;
      if (s.kind === 'billboard' && !m.faceUp) return { id: s.id, tier: 'road' };
      return { id: s.id, tier: s.tier };
    }
    return null;
  }

  isMoverCollider(collider) {
    return this.items.some((m) => m.collider.handle === collider.handle);
  }

  snapshot() {
    return this.items.map((m) => ({
      id: `${m.spec.id}_${m.index}`, kind: m.spec.kind,
      x: m.x, y: m.y, z: m.z, yaw: m.yaw,
      half: m.spec.half, active: m.active !== false, faceUp: m.faceUp,
    }));
  }
}

export default Movers;
