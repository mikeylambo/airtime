/**
 * Breakable props (R7's debt).
 *
 * "Twenty to thirty individually mundane objects" is how the arenas are
 * built; this is the layer under that — the things that are *not* part of the
 * routing graph and exist only to be destroyed. A stunt game where the world
 * is entirely immovable reads as a diorama, and one where everything is
 * dynamic costs a solver step it cannot afford on an integrated GPU.
 *
 * So the rule is narrow and physical:
 *
 * - A prop is a **kinematic** body until it is hit hard enough. Kinematic
 *   bodies cost the solver almost nothing, which is why a city can be full of
 *   them.
 * - Hit above a threshold, it **wakes into a dynamic body** and is thrown. It
 *   never comes back until the round restarts.
 * - Hit below it, nothing happens at all — no wobble, no nudge. A bollard that
 *   twitches when you brush it at walking pace is worse than one that does not
 *   move, because it promises physics it is not running.
 * - There is a **budget**. Past it, props stop waking and stay kinematic. The
 *   frame rate is a feature; a street of two hundred loose crates is not.
 *
 * The threshold is a speed rather than a force because that is what a player
 * can predict from inside the car: below about walking-into-it speed nothing
 * breaks, above it everything does.
 */

import TUNING from '../TUNING.js';
import { RAPIER } from './physics.js';
import { GROUP_TRAFFIC } from './traffic.js';

export class Props {
  constructor(world, arena) {
    this.world = world;
    this.specs = arena.props || [];
    this.items = [];
    this.live = 0;              // how many are currently dynamic

    for (const spec of this.specs) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(spec.pos.x, spec.pos.y, spec.pos.z)
      );
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(spec.half.x, spec.half.y, spec.half.z)
          .setMass(spec.mass ?? TUNING.PROPS.MASS)
          .setFriction(0.7).setRestitution(0.1)
          .setCollisionGroups(GROUP_TRAFFIC),
        body
      );
      this.items.push({ spec, body, collider, broken: false, t: 0 });
    }
  }

  /** A fresh round puts every prop back, standing. */
  reset() {
    this.live = 0;
    for (const it of this.items) {
      if (it.broken) {
        // Rapier will not convert a body's type back cleanly with contacts
        // cached against it, so the body is remade rather than reset in place
        // — the same reason §R rebuilds a world to rewind instead of
        // teleporting one.
        this.world.removeRigidBody(it.body);
        const body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(it.spec.pos.x, it.spec.pos.y, it.spec.pos.z)
        );
        it.collider = this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(it.spec.half.x, it.spec.half.y, it.spec.half.z)
            .setMass(it.spec.mass ?? TUNING.PROPS.MASS)
            .setFriction(0.7).setRestitution(0.1)
            .setCollisionGroups(GROUP_TRAFFIC),
          body
        );
        it.body = body;
        it.broken = false;
      }
      it.t = 0;
    }
  }

  /**
   * Break whatever the players have run into.
   * @returns [{ id, pos, severity }] — one entry per prop broken this step,
   *          for the effects and the audio to answer
   */
  update(dt, players = []) {
    const P = TUNING.PROPS;
    const list = Array.isArray(players) ? players : [players];
    const broke = [];

    for (const it of this.items) {
      if (it.broken) {
        it.t += dt;
        continue;
      }
      const p = it.body.translation();
      for (const pl of list) {
        const c = pl.car.position;
        const v = pl.car.linvel;
        const speed = Math.hypot(v.x, v.y, v.z);
        if (speed < P.BREAK_SPEED) continue;
        const dx = Math.abs(c.x - p.x) - it.spec.half.x;
        const dy = Math.abs(c.y - p.y) - it.spec.half.y;
        const dz = Math.abs(c.z - p.z) - it.spec.half.z;
        if (Math.max(dx, dy, dz) > P.REACH) continue;
        if (this.live >= P.BUDGET) continue;   // the frame rate is a feature

        // Wake it: a dynamic body, thrown along the car's velocity with a
        // little lift, so it leaves the ground rather than sliding.
        this.world.removeRigidBody(it.body);
        const body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(p.x, p.y, p.z)
            .setLinearDamping(0.2).setAngularDamping(0.3)
        );
        it.collider = this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(it.spec.half.x, it.spec.half.y, it.spec.half.z)
            .setMass(it.spec.mass ?? P.MASS)
            .setFriction(0.7).setRestitution(0.25)
            .setCollisionGroups(GROUP_TRAFFIC),
          body
        );
        const k = Math.min(1, speed / P.FULL_SPEED);
        body.setLinvel({ x: v.x * P.THROW * k, y: P.LIFT * k, z: v.z * P.THROW * k }, true);
        body.setAngvel({ x: (v.z / speed) * 9 * k, y: 3 * k, z: (-v.x / speed) * 9 * k }, true);
        it.body = body;
        it.broken = true;
        it.t = 0;
        this.live++;
        broke.push({ id: it.spec.id, pos: { x: p.x, y: p.y, z: p.z }, severity: k });
        break;
      }
    }
    return broke;
  }

  snapshot() {
    return this.items.map((it) => {
      const p = it.body.translation();
      const r = it.body.rotation();
      return {
        id: it.spec.id, kind: it.spec.kind || 'crate',
        x: p.x, y: p.y, z: p.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w,
        half: it.spec.half, broken: it.broken,
      };
    });
  }
}

export default Props;
