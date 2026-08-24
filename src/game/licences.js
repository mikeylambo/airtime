/**
 * Licence tests (§8).
 *
 * "Short authored jumps that teach the physics without a tutorial. This is how
 * learn-by-flailing scales past hour one."
 *
 * Every test is a question about the *physics*, not about a button. "Land a
 * 360 using one door only" is a discovery: the player finds out what a door
 * does by being asked to use one, and the answer is the same aerodynamics that
 * tools/probe-aero.mjs measures.
 */

import TUNING from '../TUNING.js';

/** A test evaluates the landings of one short run. */
export const LICENCES = [
  {
    id: 'first_air', name: 'FIRST AIR', arena: 'park', seconds: 45,
    brief: 'Land anything. Wheels down, still moving.',
    teaches: 'The car leaves the ramp with whatever the ramp gave it.',
    score: (r) => r.landings.filter((l) => l.landed && l.airtime > 0.6).length,
    tiers: { bronze: 1, silver: 3, gold: 5 },
    unit: 'landings',
  },
  {
    id: 'one_door', name: 'ONE DOOR', arena: 'park', seconds: 60,
    brief: 'Land a barrel roll using a single door.',
    teaches: 'One door is a roll input. Both are an air brake.',
    score: (r) => r.landings.filter((l) => l.landed
      && l.tricks.some((t) => t.kind === 'roll')
      && l.tricks.some((t) => t.slot === 'DOOR_L' || t.slot === 'DOOR_R')
      && !(l.tricks.some((t) => t.slot === 'DOOR_L') && l.tricks.some((t) => t.slot === 'DOOR_R'))).length,
    tiers: { bronze: 1, silver: 2, gold: 4 },
    unit: 'rolls landed',
  },
  {
    id: 'no_thrust', name: 'COLD LANDING', arena: 'park', seconds: 45,
    brief: 'Stick a clean landing without spending a single thrust burst.',
    teaches: 'Thrust is a rescue, not a requirement. The ramp already did the work.',
    score: (r) => (r.thrustBursts === 0
      ? r.landings.filter((l) => l.quality === 'clean' || l.quality === 'perfect').length : 0),
    tiers: { bronze: 1, silver: 2, gold: 4 },
    unit: 'clean sticks',
  },
  {
    id: 'tail_down', name: 'NOSE DOWN', arena: 'park', seconds: 45,
    brief: 'Use the tail flap to drop the nose, then land it.',
    teaches: 'Only a surface below the centre of mass can pitch the nose down.',
    score: (r) => r.landings.filter((l) => l.landed && l.tricks.some((t) => t.slot === 'TRUNK')).length,
    tiers: { bronze: 1, silver: 3, gold: 5 },
    unit: 'landings',
  },
  {
    id: 'rooftop', name: 'ABOVE THE ROAD', arena: 'park', seconds: 60,
    brief: 'Land on a rooftop. Anything but the deck.',
    teaches: 'Where you land is worth more than what you did on the way.',
    score: (r) => r.landings.filter((l) => l.landed && l.tier !== 'road').length,
    tiers: { bronze: 1, silver: 3, gold: 5 },
    unit: 'tiered sticks',
  },
  {
    id: 'billboard', name: 'THE BILLBOARD', arena: 'city', seconds: 75,
    brief: 'Stick a billboard.',
    teaches: 'Narrow targets need a dive, and a dive costs bar.',
    score: (r) => r.landings.filter((l) => l.landed && l.tier === 'billboard').length,
    tiers: { bronze: 1, silver: 2, gold: 3 },
    unit: 'billboards',
  },
  {
    id: 'chain', name: 'THE CHAIN', arena: 'park', seconds: 75,
    brief: 'Land three in a row without crashing.',
    teaches: 'The chain multiplier is worth more than any single trick.',
    score: (r) => {
      let best = 0, n = 0;
      for (const l of r.landings) { if (l.landed) { n++; best = Math.max(best, n); } else n = 0; }
      return best;
    },
    tiers: { bronze: 3, silver: 5, gold: 8 },
    unit: 'chain',
  },
  {
    id: 'coins', name: 'THE LINE', arena: 'park', seconds: 60,
    brief: 'Take the coin line over the hero jump.',
    teaches: 'Routes pay twice — coins are flat score a crash cannot take.',
    score: (r) => r.coins,
    tiers: { bronze: 12, silver: 26, gold: 40 },
    unit: 'coins',
  },
  {
    id: 'secret', name: 'THE MAST', arena: 'city', seconds: 90,
    brief: 'Land on the secret pad. It is worth five times anything else.',
    teaches: 'The absurd landing is the whole point of the mode.',
    score: (r) => r.landings.filter((l) => l.landed && l.tier === 'secret').length,
    tiers: { bronze: 1, silver: 2, gold: 3 },
    unit: 'sticks',
  },
];

export function gradeFor(test, value) {
  if (value >= test.tiers.gold) return 'gold';
  if (value >= test.tiers.silver) return 'silver';
  if (value >= test.tiers.bronze) return 'bronze';
  return null;
}

/**
 * Evaluate a finished run against a test.
 * @param run  the Run summary, plus the extra counters a test may ask for
 */
export function evaluate(test, run) {
  const value = test.score(run) || 0;
  return { value, grade: gradeFor(test, value), unit: test.unit };
}

export const licenceRank = (g) => ({ gold: 3, silver: 2, bronze: 1 }[g] || 0);

/** §8: medal totals unlock content; licences are their own progression. */
export function licenceScore(profile) {
  return Object.values(profile.licences || {}).reduce((a, g) => a + licenceRank(g), 0);
}
