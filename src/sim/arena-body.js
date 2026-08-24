/**
 * Arena colliders — turns the stunt park description into Rapier statics.
 * Render builds its meshes from the same records (src/render/arena-view.js).
 */

import TUNING from '../TUNING.js';
import { RAPIER, GROUP_WORLD } from './physics.js';
import { getArena, rampSlabs } from '../arena/index.js';
import { qAxisAngle, WORLD_UP } from './mathx.js';

export function buildArena(world, arenaId = 'park') {
  const A = TUNING.ARENA;
  const park = getArena(arenaId);
  const colliders = [];

  const finish = (desc) => {
    desc.setFriction(A.GROUND_FRICTION)
      .setRestitution(A.GROUND_RESTITUTION)
      .setCollisionGroups(GROUP_WORLD);
    colliders.push(world.createCollider(desc));
  };

  // Ground: a thick slab rather than a plane so nothing can tunnel under it.
  const size = park.ground || A.GROUND_SIZE;
  const g = RAPIER.ColliderDesc.cuboid(size / 2, 2, size / 2).setTranslation(0, -2, 0);
  finish(g);

  // Every ramp is a chain of convex slabs (see arena/ramp-geometry.js): a
  // convex shape always knows which way is out, so a fast chassis can never be
  // resolved against the wrong face and fired backwards.
  for (const r of park.ramps) {
    const rot = qAxisAngle(WORLD_UP, r.yaw);
    for (const points of rampSlabs(r)) {
      const desc = RAPIER.ColliderDesc.convexHull(points);
      if (!desc) continue;
      desc.setTranslation(r.pos.x, r.pos.y, r.pos.z).setRotation(rot);
      finish(desc);
    }
  }

  for (const s of park.structures) {
    const desc = RAPIER.ColliderDesc.cuboid(s.half.x, s.half.y, s.half.z)
      .setTranslation(s.pos.x, s.pos.y, s.pos.z)
      .setRotation(qAxisAngle(WORLD_UP, s.yaw));
    finish(desc);
  }

  return { park, colliders };
}

/** Which tagged target (if any) contains this point. Ground reads as 'road'. */
export function targetAt(park, p) {
  for (const t of park.targets) {
    if (Math.abs(p.x - t.aim.x) <= t.half.x &&
        Math.abs(p.z - t.aim.z) <= t.half.z &&
        p.y >= t.aim.y - t.half.y && p.y <= t.aim.y + t.half.y) return t;
  }
  return null;
}
