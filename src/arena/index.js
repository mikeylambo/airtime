/**
 * Arena registry (§2.1: "any mode runs on any arena").
 *
 * An arena is plain data — ramps, structures, targets, coins, traffic lanes and
 * moving targets. Physics, rendering and the camera all read the same record.
 */

import { describePark } from './stunt-park.js';
import { describeCity } from './city-block.js';

const BUILDERS = { park: describePark, city: describeCity };

export const ARENA_IDS = Object.keys(BUILDERS);

export function getArena(id = 'park') {
  const build = BUILDERS[id] || BUILDERS.park;
  const a = build();
  a.id = a.id || id;
  a.movers = a.movers || [];
  a.lanes = a.lanes || [];
  a.coins = a.coins || [];
  a.props = a.props || [];
  return a;
}

export { describePark, describeCity };
export { PIECES, expandPieces, serializeArena, parseArena } from './pieces.js';
export * from './ramp-geometry.js';
