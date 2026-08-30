/**
 * Named gaps (R6).
 *
 * A gap is a notable edge of an arena's reachability graph — a long, high
 * flight from one authored surface to another. They are not hand-placed:
 * `npm run gaps` derives them from the same line analysis that proved the park
 * is a network, and writes `gaps.generated.js`. Hand-authoring them would be
 * guesswork about geometry the analyzer already knows exactly.
 *
 * Matching is purely geometric — launch near A, land near B — so nothing in
 * the simulation has to carry a gap identity around, and the same code works
 * for any arena the moment its gaps are generated.
 */

import TUNING from '../TUNING.js';
import { GENERATED_GAPS } from './gaps.generated.js';

const byArena = new Map();
for (const g of GENERATED_GAPS) {
  if (!byArena.has(g.arena)) byArena.set(g.arena, []);
  byArena.get(g.arena).push(g);
}

export const gapsFor = (arena) => byArena.get(arena) || [];
export const gapCount = (arena) => gapsFor(arena).length;
export const findGapById = (id) => GENERATED_GAPS.find((g) => g.id === id) || null;

const d2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

/**
 * Altitude has to agree too, and only R8's generated gaps carry it: Vertical
 * City stacks three garage decks on one footprint, so two completely
 * different flights share an x/z landing point and the older, ground-plane
 * match would hand both of them the same name.
 */
const sameHeight = (p, g) => g.y === undefined || p.y === undefined
  || Math.abs(p.y - g.y) <= TUNING.GAPS.MATCH_HEIGHT;

/**
 * Did this flight fly a named gap? Both ends have to match, and where two gaps
 * both fit, the tighter one wins — otherwise a short hop inside a big gap's
 * tolerance would claim the big gap's name.
 */
export function matchGap(arena, launchPos, landPos) {
  const r2 = TUNING.GAPS.MATCH_RADIUS ** 2;
  let best = null, bestErr = Infinity;
  for (const g of gapsFor(arena)) {
    const a = d2(launchPos, g.from), b = d2(landPos, g.to);
    if (a > r2 || b > r2) continue;
    if (!sameHeight(launchPos, g.from) || !sameHeight(landPos, g.to)) continue;
    const err = a + b;
    if (err < bestErr) { best = g; bestErr = err; }
  }
  return best;
}
