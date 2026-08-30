/**
 * Challenges (R9) — "give hundreds of runs purpose".
 *
 * The release shape asks for 100–150 of these, and hand-writing 130 objects
 * would be 130 chances to write a challenge nobody can complete because the
 * arena does not contain the thing it asks for. So they are **generated from
 * templates against the arenas and the roster**, the same way named gaps are
 * derived from the reachability graph rather than guessed: if a tier does not
 * exist in an arena, no challenge asks for it; if a car is added to the
 * roster, its challenges appear with it.
 *
 * Two rules keep them honest:
 *
 * - **They complete during normal play.** A challenge is evaluated against
 *   the summary of any run you happen to make. Nothing here is a separate
 *   mode you have to go and select, because the point is to give the runs you
 *   were going to make anyway a reason to have been made.
 * - **They ask for something specific.** "Score more" is not a challenge, it
 *   is a scoreboard. Every set below names a technique, a place, or a
 *   restraint — and the restraint ones (RAW, stock, no crashes) are the ones
 *   that actually change how somebody drives.
 *
 * Cars are never gated behind these. The law from the vision holds: unlocking
 * a car is unlocking a technique, never a tier, so what challenges unlock is
 * *arenas, liveries, trials and eventually The Gauntlet* — never a faster car.
 */

import { getArena, ARENA_IDS } from '../arena/index.js';
import { CARS } from '../sim/cars.js';
import { gapsFor } from '../arena/gaps.js';
import { MODES } from '../sim/modes.js';

const ARENA_LABEL = {
  park: 'The Yard', city: 'Vertical City', works: 'Mega Works',
  flood: 'Floodway', sky: 'Skyline', hall: 'The Concourse',
};
const TIER_LABEL = {
  road: 'the road', rooftop: 'a rooftop', billboard: 'a billboard',
  moving: 'something moving', pool: 'the pool', secret: 'the secret pad',
};

const landed = (r) => (r.landings || []).filter((l) => l.landed);
const facetsOf = (l) => l.facets || l.tricks || [];
const hasFacet = (l, id) => facetsOf(l).some((f) => f.id === id);
/** Total rotation on any one axis, in degrees — what "land a 900" means. */
const spinDeg = (l) => Math.round((l.rotation || 0) * (180 / Math.PI));

let nextOrder = 0;
const make = (set, o) => ({ set, order: nextOrder++, arena: null, mode: null, car: null, ...o });

// ── The sets ───────────────────────────────────────────────────────────────

/** ROTATION — the ladder everybody understands without being told. */
const rotation = [360, 540, 720, 900, 1080, 1260].map((deg, i) => make('ROTATION', {
  id: `rot_${deg}`,
  name: `LAND A ${deg}`,
  brief: `Land a jump carrying ${deg} degrees on one axis.`,
  teaches: 'Rotation is integrated from the car\'s own angular velocity. Nothing triggers it.',
  tier: i,
  test: (r) => landed(r).some((l) => spinDeg(l) >= deg),
}));

/** STACK — the R1 thesis: variety multiplies, repetition does not. */
const stack = [3, 4, 5, 6, 7, 8, 9, 10].map((n, i) => make('STACK', {
  id: `stack_${n}`,
  name: `${n} AT ONCE`,
  brief: `Land a jump that is doing ${n} different things at the same time.`,
  teaches: 'The count is what pays, not any single facet.',
  tier: i,
  test: (r) => landed(r).some((l) => (l.facetCount || facetsOf(l).length) >= n),
}));

/** PURITY — the restraint set. The assist is a resource. */
const purity = [
  ...[4000, 12000, 25000, 50000].map((n, i) => make('PURITY', {
    id: `raw_score_${n}`,
    name: `${(n / 1000).toFixed(0)}K RAW`,
    brief: `Bank ${n.toLocaleString()} in a round without a stabiliser on any landing.`,
    teaches: 'No thrust burst, no air brake, no wing. Restraint is worth more than any trick.',
    tier: i,
    test: (r) => r.score >= n && landed(r).length > 0
      && landed(r).every((l) => l.purity && l.purity.id === 'raw'),
  })),
  ...[1, 3, 6, 10].map((n, i) => make('PURITY', {
    id: `raw_sticks_${n}`,
    name: n === 1 ? 'ONE RAW' : `${n} RAW STICKS`,
    brief: `Land ${n} jump${n > 1 ? 's' : ''} of six facets or more with nothing touched.`,
    teaches: 'A jump doing six things and rescued by a burst is not the same jump.',
    tier: i,
    test: (r) => landed(r).filter((l) => (l.facetCount || 0) >= 6
      && l.purity && l.purity.id === 'raw').length >= n,
  })),
];

/** CHAIN — the combo window is worth more than any single trick. */
const chain = [3, 5, 8, 12, 16].map((n, i) => make('CHAIN', {
  id: `chain_${n}`,
  name: `CHAIN OF ${n}`,
  brief: `Land ${n} in a row without crashing.`,
  teaches: 'The chain multiplier compounds. A crash sets it to one.',
  tier: i,
  test: (r) => (r.bestChain || 0) >= n,
}));

/** AIR — hang time, which in this game is a routing decision. */
const air = [3, 4, 5, 6].map((s, i) => make('AIR', {
  id: `air_${s}`,
  name: `${s} SECONDS UP`,
  brief: `Land a flight of ${s} seconds or more.`,
  teaches: 'Hang time comes from where you launched, not from how hard.',
  tier: i,
  test: (r) => landed(r).some((l) => (l.airtime || 0) >= s),
}));

/** PRECISION — the landing is a real event, and PERFECT is a narrow window. */
const precision = [1, 3, 6, 10].map((n, i) => make('PRECISION', {
  id: `perfect_${n}`,
  name: n === 1 ? 'PERFECT STICK' : `${n} PERFECT`,
  brief: `Land ${n} jump${n > 1 ? 's' : ''} perfectly in one round.`,
  teaches: 'Perfect is wheels down, level, and still going. It is not luck.',
  tier: i,
  test: (r) => landed(r).filter((l) => l.quality === 'perfect').length >= n,
}));

/** SURVIVAL — a run is 90 seconds and crashing is free. Refusing to is not. */
const survival = [
  make('SURVIVAL', {
    id: 'no_crash',
    name: 'CLEAN ROUND',
    brief: 'Finish a round with at least eight jumps and no crashes.',
    teaches: 'Land it or lose it, applied to a whole round.',
    tier: 1,
    test: (r) => (r.jumps || 0) >= 8 && (r.crashes || 0) === 0,
  }),
  make('SURVIVAL', {
    id: 'no_respawn',
    name: 'NEVER STOPPED',
    brief: 'Finish a round of twelve jumps without a single respawn.',
    teaches: 'Recovery is a skill before it is a button.',
    tier: 2,
    test: (r) => (r.jumps || 0) >= 12 && (r.respawns || 0) === 0,
  }),
];

// ── Derived sets: these read the arenas rather than assuming them ──────────

/** SCORE, per arena. Thresholds are the same; the arenas are not. */
const score = ARENA_IDS.flatMap((arena) =>
  // Three thresholds, not five. With two arenas five was fine; with six it
  // would put the ladder over the vision's 150 on the score set alone.
  [6000, 24000, 60000].map((n, i) => make('SCORE', {
    id: `score_${arena}_${n}`,
    arena,
    name: `${(n / 1000).toFixed(0)}K IN ${ARENA_LABEL[arena].toUpperCase()}`,
    brief: `Bank ${n.toLocaleString()} in one round of ${ARENA_LABEL[arena]}.`,
    teaches: 'Every arena pays differently, because every arena routes differently.',
    tier: i,
    test: (r) => r.score >= n,
  })));

/**
 * TIER, per arena — generated from the arena's own targets, so no challenge
 * ever asks for a pool in an arena that has no pool.
 */
const tiers = ARENA_IDS.flatMap((arena) => {
  const present = [...new Set(getArena(arena).targets
    .filter((t) => t.tagged !== false).map((t) => t.tier))];
  const ORDER = ['road', 'rooftop', 'billboard', 'moving', 'pool', 'secret'];
  return ORDER.filter((t) => present.includes(t)).map((tier, i) => make('TIER', {
    id: `tier_${arena}_${tier}`,
    arena,
    name: `STICK ${TIER_LABEL[tier].toUpperCase()}`,
    brief: `Land on ${TIER_LABEL[tier]} in ${ARENA_LABEL[arena]}.`,
    teaches: 'Where you land is worth more than what you did on the way.',
    tier: i,
    test: (r) => landed(r).some((l) => l.tier === tier),
  }));
});

/** GAPS, per arena — the counts come from how many that arena actually has. */
const gaps = ARENA_IDS.flatMap((arena) => {
  const total = gapsFor(arena).length;
  if (!total) return [];
  const steps = [...new Set([Math.ceil(total / 3), Math.ceil((total * 2) / 3), total])];
  return steps.map((n, i) => make('GAPS', {
    id: `gaps_${arena}_${n}`,
    arena,
    name: n === total ? `EVERY GAP IN ${ARENA_LABEL[arena].toUpperCase()}` : `${n} NAMED GAPS`,
    brief: `Discover ${n} of ${ARENA_LABEL[arena]}'s ${total} named gaps.`,
    teaches: 'Gaps are derived from the arena\'s own reachability graph. Nobody placed them.',
    tier: i,
    // Cumulative across the profile, not per run: a gap is discovered once,
    // ever, which is the whole reason discovery is worth a bonus.
    test: (r) => (r.gapsKnown || 0) >= n,
  }));
});

/**
 * VEHICLE — one per car, twice. The roster's law is that no car is stronger,
 * so these ask you to be *competent* in each rather than to grind the best
 * one, and the thresholds are identical for exactly that reason.
 */
const vehicles = Object.values(CARS).flatMap((car) => [
  make('VEHICLE', {
    id: `car_score_${car.id}`,
    car: car.id,
    name: `${car.label || car.id.toUpperCase()}: 12K`,
    brief: `Bank 12,000 in one round driving the ${car.label || car.id}.`,
    teaches: car.blurb || 'Every car is a different way to play, never a stronger one.',
    tier: 0,
    test: (r) => r.score >= 12000,
  }),
  make('VEHICLE', {
    id: `car_stack_${car.id}`,
    car: car.id,
    name: `${car.label || car.id.toUpperCase()}: SIX AT ONCE`,
    brief: `Land a six-facet jump in the ${car.label || car.id}.`,
    teaches: 'The instrument changes what is easy, never what is possible.',
    tier: 1,
    test: (r) => landed(r).some((l) => (l.facetCount || 0) >= 6),
  }),
]);

/** GHOST — the R9 gate, as something a player is asked to do. */
const ghost = [
  make('GHOST', {
    id: 'ghost_beat',
    name: 'BEAT YOUR GHOST',
    brief: 'Race your own personal best and beat it.',
    teaches: 'A ghost is a replay we do not draw the HUD for. It is the run, again.',
    tier: 0,
    test: (r) => r.ghost && r.score > r.ghost.score,
  }),
  make('GHOST', {
    id: 'ghost_crush',
    name: 'BY HALF AGAIN',
    brief: 'Beat your ghost by fifty per cent.',
    teaches: 'The gap between a good run and your best one is mostly routing.',
    tier: 1,
    test: (r) => r.ghost && r.score >= r.ghost.score * 1.5,
  }),
  make('GHOST', {
    id: 'ghost_other_car',
    name: 'WRONG INSTRUMENT',
    brief: 'Beat a ghost that was set in a different car.',
    teaches: 'No car is better. Proving it is a different matter.',
    tier: 2,
    test: (r) => r.ghost && r.ghost.car !== r.car && r.score > r.ghost.score,
  }),
];

/** TRAFFIC — risk pays, where there is traffic to risk it against. */
const traffic = [5, 12, 25].map((n, i) => make('TRAFFIC', {
  id: `nearmiss_${n}`,
  arena: 'city',
  name: `${n} NEAR MISSES`,
  brief: `Pass ${n} vehicles close enough to count in one round.`,
  teaches: 'Boost comes from driving well. Traffic is where "well" is measured.',
  tier: i,
  test: (r) => (r.nearMisses || 0) >= n,
}));

/** COINS, per arena — coins are a routing hint, so these are route challenges. */
const coins = ARENA_IDS.flatMap((arena) => {
  const total = getArena(arena).coins.length;
  return [Math.ceil(total / 2), total].map((n, i) => make('COINS', {
    id: `coins_${arena}_${n}`,
    arena,
    name: n === total ? 'EVERY COIN' : `${n} COINS`,
    brief: `Take ${n} of ${ARENA_LABEL[arena]}'s ${total} coins in one round.`,
    teaches: 'Coins define the authored lines through the dark. Following one is the lesson.',
    tier: i,
    test: (r) => (r.coins || 0) >= n,
  }));
});

/**
 * SIGNATURE — one per arena, naming the thing that arena is *for*. These are
 * the challenges that read as a description of the place rather than as a
 * number, and there is exactly one per arena on purpose: a second would be a
 * second-best description.
 */
const signature = [
  make('SIGNATURE', {
    id: 'sig_works', arena: 'works',
    name: 'CAUGHT THE SKIP',
    brief: 'Land on something that was moving when you left the ramp.',
    teaches: 'Mega Works routes in time. The graph opens and closes.',
    tier: 0,
    test: (r) => landed(r).some((l) => l.tier === 'moving'),
  }),
  make('SIGNATURE', {
    id: 'sig_flood', arena: 'flood',
    name: 'RODE THE FLOW',
    brief: 'Land eight in a row without crashing, in one channel run.',
    teaches: 'Floodway has a direction. Going with it, speed is free.',
    tier: 0,
    test: (r) => (r.bestChain || 0) >= 8,
  }),
  make('SIGNATURE', {
    id: 'sig_hall', arena: 'hall',
    name: 'NEVER LOOKED UP',
    brief: 'Bank 40,000 without once touching the gallery or the catwalks.',
    teaches: 'The Concourse has a ceiling. Height is not the answer here.',
    tier: 0,
    test: (r) => (r.total || 0) >= 40000
      && !(r.landings || []).some((l) => l.landed && /^(mezz|gantry)_/.test(l.targetId || '')),
  }),
  make('SIGNATURE', {
    id: 'sig_sky', arena: 'sky',
    name: 'NEVER CAME DOWN',
    brief: 'Finish a round of ten jumps without a single respawn.',
    teaches: 'Skyline has no ground. A missed landing is a demotion.',
    tier: 0,
    test: (r) => (r.jumps || 0) >= 10 && (r.respawns || 0) === 0,
  }),
];

/**
 * CITY — the R8 arena's own vocabulary, and the acceptance clip broken into
 * the four things it is actually made of.
 */
const city = [
  make('CITY', {
    id: 'city_spire',
    arena: 'city',
    name: 'THE SPIRE',
    brief: 'Land on the roof of the skyscraper.',
    teaches: 'Forty-six metres. One apex from the roofs, and only from the roofs.',
    tier: 0,
    test: (r) => landed(r).some((l) => l.target === 'spire'),
  }),
  make('CITY', {
    id: 'city_coil',
    arena: 'city',
    name: 'THE COIL',
    brief: 'Drive the spiral flyover from the street to the top without leaving the ground.',
    teaches: 'The honest way up. It costs time, which is the point.',
    tier: 1,
    test: (r) => (r.groundClimb || 0) >= 24,
  }),
  make('CITY', {
    id: 'city_stack',
    arena: 'city',
    name: 'THE WHOLE STACK',
    brief: 'Land on all three decks of the parking structure in one round.',
    teaches: 'Overshooting the top deck is landing on the one below, not on nothing.',
    tier: 2,
    test: (r) => new Set(landed(r).map((l) => l.target)
      .filter((t) => t && t.startsWith('stack_d'))).size >= 3,
  }),
  make('CITY', {
    id: 'city_heli',
    arena: 'city',
    name: 'THE HELICOPTER',
    brief: 'Pass the helicopter close enough to count, in the air.',
    teaches: 'A near miss is a near miss whether or not your wheels are down.',
    tier: 3,
    test: (r) => (r.moverNearMisses || 0) >= 1,
  }),
  make('CITY', {
    id: 'city_clip',
    arena: 'city',
    name: 'THE SHOT',
    brief: 'Off the spire, past the helicopter, six facets, land it on a garage deck.',
    teaches: 'The vision ends with this ten seconds. When you can do it in one take, the game is real.',
    tier: 4,
    test: (r) => (r.moverNearMisses || 0) >= 1 && landed(r).some((l) =>
      (l.facetCount || 0) >= 6 && (l.target || '').startsWith('stack_d')
      && (l.from ? l.from.y > 40 : false)),
  }),
];

/** MODE — one per lens, so the mode select is not a menu nobody opens. */
const modes = Object.values(MODES).filter((m) => m.id !== 'stunt').map((m, i) => make('MODE', {
  id: `mode_${m.id}`,
  mode: m.id,
  name: m.label,
  brief: `Bank 6,000 in a round of ${m.label}.`,
  teaches: m.rules,
  tier: i,
  test: (r) => r.score >= 6000,
}));

/**
 * GAUNTLET — the exam, as rungs. These read the profile's deepest attempt
 * rather than the run, because The Gauntlet is scored across a chain of runs
 * and asking "did this one round clear four stages" would be nonsense.
 */
const gauntlet = [6, 12, 18].map((n, i) => make('GAUNTLET', {
  id: `gauntlet_${n}`,
  name: n === 18 ? 'THE WHOLE GAUNTLET' : `GAUNTLET: ${n} STAGES`,
  brief: `Clear ${n} stages of The Gauntlet in one attempt.`,
  teaches: 'Unlocked, not offered. The last stage is the shot the vision ends on.',
  tier: i,
  test: (r) => (r.gauntletDepth || 0) >= n,
}));

export const CHALLENGES = [
  ...rotation, ...stack, ...purity, ...chain, ...air, ...precision, ...survival,
  ...score, ...tiers, ...gaps, ...vehicles, ...ghost, ...traffic, ...coins,
  ...city, ...signature, ...modes, ...gauntlet,
];

export const CHALLENGE_SETS = [...new Set(CHALLENGES.map((c) => c.set))];
export const bySet = (set) => CHALLENGES.filter((c) => c.set === set);
export const findChallenge = (id) => CHALLENGES.find((c) => c.id === id) || null;

/** Does this challenge even apply to the run that just happened? */
export function applies(c, ctx) {
  if (c.arena && c.arena !== ctx.arena) return false;
  if (c.mode && c.mode !== ctx.mode) return false;
  if (c.car && c.car !== ctx.car) return false;
  return true;
}

/**
 * Score a finished run against every challenge it could have completed.
 * @returns the ids newly completed by this run
 */
export function evaluateRun(profile, summary, ctx) {
  const done = profile.challenges || (profile.challenges = {});
  const fresh = [];
  for (const c of CHALLENGES) {
    if (done[c.id]) continue;
    if (!applies(c, ctx)) continue;
    let ok = false;
    // A challenge is data written by hand; a bad predicate must cost one
    // challenge, never the run's whole result screen.
    try { ok = !!c.test(summary); } catch { ok = false; }
    if (ok) { done[c.id] = Date.now(); fresh.push(c.id); }
  }
  return fresh.map(findChallenge);
}

export const completedCount = (profile) =>
  Object.keys(profile.challenges || {}).length;

/** Per-set progress, for the screen. */
export function setProgress(profile) {
  const done = profile.challenges || {};
  return CHALLENGE_SETS.map((set) => {
    const list = bySet(set);
    return { set, done: list.filter((c) => done[c.id]).length, total: list.length };
  });
}

/**
 * What challenges buy. Never a car — the roster's law is that unlocking a car
 * is unlocking a technique rather than a tier, so what a ladder can hand out
 * is places to drive and reasons to go back.
 */
export const UNLOCKS = [
  { at: 1, id: 'city', kind: 'arena', label: 'VERTICAL CITY' },
  { at: 14, id: 'freeride', kind: 'mode', label: 'FREE RIDE' },
  { at: 22, id: 'works', kind: 'arena', label: 'MEGA WORKS' },
  { at: 32, id: 'besttrick', kind: 'mode', label: 'BEST TRICK' },
  { at: 44, id: 'flood', kind: 'arena', label: 'FLOODWAY' },
  { at: 54, id: 'shot', kind: 'mode', label: 'CALL YOUR SHOT' },
  { at: 66, id: 'sky', kind: 'arena', label: 'SKYLINE' },
  { at: 78, id: 'hall', kind: 'arena', label: 'THE CONCOURSE' },
  { at: 84, id: 'combo', kind: 'mode', label: 'COMBO RUN' },
  { at: 90, id: 'survival', kind: 'mode', label: 'SURVIVAL' },
  { at: 102, id: 'party', kind: 'mode', label: 'PARTY STUNTS' },
  { at: 118, id: 'gauntlet', kind: 'trial', label: 'THE GAUNTLET' },
];

export function unlockedBy(profile) {
  const n = completedCount(profile);
  return UNLOCKS.filter((u) => n >= u.at);
}

/** The next thing on the ladder, and how far off it is. */
export function nextUnlock(profile) {
  const n = completedCount(profile);
  const u = UNLOCKS.find((x) => n < x.at);
  return u ? { ...u, remaining: u.at - n } : null;
}
