/**
 * R9's gate: "100–150 challenges; a ghost can be loaded and beaten."
 *
 * Four things, and the first one is the only one that is really hard:
 *
 * 1. **A ghost is the run.** Baking re-simulates a recorded run in its own
 *    world and keeps the trajectory. If that trajectory is not the one the
 *    original run flew, the ghost is a plausible-looking lie and every
 *    comparison against it is meaningless. So: record a run, bake it, and
 *    compare step for step. §R measured playback at 0.0 m; a ghost is the
 *    same re-simulation, so it has to hold to the same number.
 * 2. **A ghost can be loaded and beaten.** The gate, verbatim.
 * 3. **The ladder is real.** 100–150 challenges, every one of them applicable
 *    to something that exists, and none of them completable by standing
 *    still — a challenge an empty run satisfies is a challenge that gates
 *    nothing.
 * 4. **Seven boards, and a run files onto every one it qualifies for.**
 *
 *   node tools/probe-mastery.mjs
 */

import TUNING from '../src/TUNING.js';
import { Sim } from '../src/sim/sim.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { resolveSetup } from '../src/sim/cars.js';
import { Recorder } from '../src/sim/replay.js';
import { loopActions, loopEdges } from '../src/loop-demo.js';
import { ghostFromRun, bakeGhost, STRIDE } from '../src/game/ghosts.js';
import {
  CHALLENGES, CHALLENGE_SETS, evaluateRun, applies, completedCount, UNLOCKS,
} from '../src/game/challenges.js';
import { BOARDS, submitRun, readBoard, entryFromRun } from '../src/game/boards.js';
import * as Gauntlet from '../src/game/gauntlet.js';
import { LocalBoard } from '../src/game/daily.js';
import { simVersion } from '../src/sim/version.js';

const DT = 1 / TUNING.SIM.HZ;
const SECONDS = 60;

const fails = [];
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(48)} ${detail}`);
  if (!ok) fails.push(label);
};

const profile = {
  slot: 0, name: 'PROBE', car: 'vector', livery: 'stock',
  tune: { weight: .5, suspension: .5, thrust: .5, aero: .5 },
  parts: { doors: 'stock', hood: 'stock', trunk: 'stock', spoiler: 'stock' },
  challenges: {}, gaps: [], unlocked: { arenas: ['park'], modes: [], trials: [] },
};
const setup = resolveSetup(profile);

console.log('\n── Mastery (R9) ────────────────────────────────────────────\n');

// ── 1. Record a run, exactly the way the game does ─────────────────────────
// The scripted driver is blind, so — as probe-replay does — scan a few seeds
// for a round it actually banks something in. What is under test is that a
// ghost reproduces whatever happened; a round worth nothing would reproduce
// perfectly and prove nothing, because a ghost scoring zero is beaten by
// standing still.
let sim = null, rec = null, truth = null, summary = null, usedSeed = 0;

for (let candidate = 1; candidate <= 16; candidate++) {
  usedSeed = (0x9e370000 + candidate * 7919) >>> 0;
  sim = await Sim.create(setup, 'park');
  sim.restartRun('stunt', SECONDS, usedSeed);
  // The countdown is part of the world's history: the game steps it with
  // hands off the wheel before the recorder hears anything (§R).
  while (!sim.round.running) sim.step(DT, NEUTRAL_ACTIONS);
  sim.drainEvents();

  rec = new Recorder({
    arena: 'park', setup, profile, seed: sim.roundSeed, duration: sim.round.duration,
  });
  truth = [];
  let t = 0, launchT = null;
  const ctx = { thrusted: false, airborne: false, launchT: null, boost: 0, aim: null };
  while (t < SECONDS && !sim.run.over) {
    ctx.airborne = sim.airborne;
    ctx.launchT = launchT;
    ctx.boost = sim.boost.value;
    ctx.car = sim.car;
    ctx.park = sim.park;
    const a = loopActions(t, NEUTRAL_ACTIONS, ctx);
    const e = loopEdges(t, DT, ctx);
    sim.step(DT, rec.record(a, e), e);
    const p = sim.car.position;
    truth.push([p.x, p.y, p.z, sim.players[0].run.score]);
    t += DT;
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'launch' && ev.launch.armed) { launchT = t; ctx.thrusted = false; }
    }
  }
  summary = sim.runSummary(0);
  if (summary.score > 0) break;
}
console.log(`  ..    a recorded round to test against`.padEnd(56) +
  `${summary.score.toLocaleString()} over ${summary.jumps} jumps (seed 0x${usedSeed.toString(16)})`);

// ── 2. Bake it, and check the ghost *is* the run ───────────────────────────
const record = ghostFromRun(rec, { ...summary, name: 'PROBE' }, 0);
const ghost = await bakeGhost(record, { yieldEvery: 0 });

let worst = 0, worstAt = 0, scoreErr = 0;
const n = Math.min(truth.length, ghost.steps);
const pose = {};
for (let i = 0; i < n; i++) {
  // Sample at the exact step, so this measures the bake rather than the
  // interpolation between two of its samples.
  const o = i * STRIDE;
  const d = Math.hypot(ghost.frames[o] - truth[i][0], ghost.frames[o + 1] - truth[i][1],
    ghost.frames[o + 2] - truth[i][2]);
  if (d > worst) { worst = d; worstAt = i; }
  scoreErr = Math.max(scoreErr, Math.abs(ghost.frames[o + 3 + 4] - truth[i][3]));
}
check(worst < 0.001, 'a baked ghost is the run it recorded',
  `worst divergence ${worst.toFixed(4)} m over ${n} steps (at step ${worstAt})`);
check(scoreErr === 0, 'and it carries the score the run had banked',
  `worst score error ${scoreErr}`);
check(ghost.steps > 0 && Math.abs(ghost.seconds - SECONDS) < 1.2,
  'the ghost covers the whole round',
  `${ghost.steps} steps, ${ghost.seconds.toFixed(1)}s of ${SECONDS}s`);

// Interpolation has to land on the samples it interpolates between.
ghost.at(0, pose);
const first = Math.hypot(pose.x - truth[0][0], pose.y - truth[0][1], pose.z - truth[0][2]);
check(first < 0.01, 'sampling at t=0 is the first step', `${first.toFixed(4)} m`);

// ── 3. Loaded and beaten — the gate, verbatim ──────────────────────────────
// A run that scores more than the ghost, evaluated through the same path the
// game uses. The ghost's own score is the bar, and the "run" that clears it is
// the same recorded run with a better number, because what is under test is
// whether beating a ghost is *detectable*, not whether a scripted driver can.
const beat = { ...summary, score: ghost.score + 1, ghost: { score: ghost.score, car: ghost.car, name: ghost.name } };
const lose = { ...summary, score: Math.max(0, ghost.score - 1), ghost: { score: ghost.score, car: ghost.car, name: ghost.name } };
const runCtx = { arena: 'park', mode: 'stunt', car: 'vector' };
const beatFresh = evaluateRun({ challenges: {} }, beat, runCtx).map((c) => c.id);
const loseFresh = evaluateRun({ challenges: {} }, lose, runCtx).map((c) => c.id);
// A ghost worth nothing is trivially beaten, so the window is long enough
// for the scripted driver to actually bank something first.
check(ghost.score > 0 && beatFresh.includes('ghost_beat') && !loseFresh.includes('ghost_beat'),
  'a ghost can be loaded and beaten',
  `ghost scored ${ghost.score.toLocaleString()}; beating it fires, losing to it does not`);

// ── 4. The ladder ──────────────────────────────────────────────────────────
check(CHALLENGES.length >= 100 && CHALLENGES.length <= 150,
  'the ladder is 100-150 challenges',
  `${CHALLENGES.length} across ${CHALLENGE_SETS.length} sets`);

// Nothing may be completable by a run that did nothing. A challenge an empty
// summary satisfies is a challenge that gates nothing.
const EMPTY = {
  score: 0, landings: [], jumps: 0, crashes: 0, bestChain: 0, coins: 0,
  nearMisses: 0, moverNearMisses: 0, respawns: 0, groundClimb: 0,
  gapsKnown: 0, ghost: null, gauntletDepth: 0,
};
const freebies = CHALLENGES.filter((c) => { try { return c.test(EMPTY); } catch { return false; } });
check(freebies.length === 0, 'none of them completes itself',
  freebies.length ? freebies.map((c) => c.id).join(', ') : 'an empty run earns nothing');

// Every challenge has to apply to something that exists.
const contexts = [];
for (const arena of ['park', 'city']) {
  for (const mode of ['stunt', 'shot', 'standing', 'potato', 'party']) {
    for (const car of ['vector', 'anvil']) contexts.push({ arena, mode, car });
  }
}
const orphanChallenges = CHALLENGES.filter((c) => !contexts.some((x) => applies(c, x))
  && !(c.car && !['vector', 'anvil'].includes(c.car)));
check(orphanChallenges.length === 0, 'every challenge applies to something that exists',
  orphanChallenges.length ? orphanChallenges.map((c) => c.id).join(', ') : 'no orphans');

// The unlock ladder must be reachable, and must never hand out a car.
const topRung = UNLOCKS[UNLOCKS.length - 1];
check(topRung.at <= CHALLENGES.length && !UNLOCKS.some((u) => u.kind === 'car'),
  'the unlock ladder is reachable, and gates no car',
  `top rung ${topRung.label} at ${topRung.at} of ${CHALLENGES.length}`);

// ── 5. The Gauntlet ────────────────────────────────────────────────────────
{
  let state = Gauntlet.begin();
  // Clear every stage by handing each one a summary it accepts, then confirm
  // a failed stage ends the attempt rather than skipping it.
  const pass = {
    bestChain: 12, moverNearMisses: 1,
    landings: [{
      landed: true, facetCount: 7, airtime: 4.5, tier: 'secret', target: 'stack_d2',
      quality: 'perfect', purity: { id: 'raw' }, rotation: 16.5, from: { y: 47 },
    }, {
      landed: true, facetCount: 6, airtime: 2, tier: 'billboard', target: 'spire',
      quality: 'clean', purity: { id: 'raw' }, rotation: 1, from: { y: 47 },
    }, {
      landed: true, facetCount: 6, airtime: 2, tier: 'rooftop', target: 'stack_d0',
      quality: 'clean', purity: { id: 'raw' }, rotation: 1, from: { y: 47 },
    }, {
      landed: true, facetCount: 6, airtime: 2, tier: 'rooftop', target: 'stack_d1',
      quality: 'clean', purity: { id: 'raw' }, rotation: 1, from: { y: 47 },
    }],
    score: 9000,
  };
  for (let i = 0; i < Gauntlet.LENGTH; i++) Gauntlet.resolve(state, pass);
  check(state.done && Gauntlet.depth(state) === Gauntlet.LENGTH,
    'every Gauntlet stage is clearable',
    `${Gauntlet.depth(state)}/${Gauntlet.LENGTH} stages`);

  state = Gauntlet.begin();
  Gauntlet.resolve(state, EMPTY);
  check(state.done && state.failed === 'g1' && Gauntlet.depth(state) === 0,
    'a failed stage ends the attempt', `failed at ${state.failed}`);
}

// ── 6. The seven boards ────────────────────────────────────────────────────
{
  check(BOARDS.length === 7, 'there are seven boards',
    BOARDS.map((b) => b.id).join(', '));

  // An in-memory store, so the probe does not depend on a browser or leave
  // anything behind. The adapter contract is two functions; this is both.
  const mem = new Map();
  const store = {
    name: 'probe',
    async submit(board, key, entry) {
      const k = `${board}/${key}`;
      const list = mem.get(k) || [];
      const mine = list.findIndex((e) => e.slot === entry.slot);
      if (mine >= 0) { if (entry.value > list[mine].value) list[mine] = entry; } else list.push(entry);
      list.sort((a, b) => b.value - a.value);
      mem.set(k, list);
      return list;
    },
    async top(board, key, n = 10) { return (mem.get(`${board}/${key}`) || []).slice(0, n); },
  };
  const { useBoard } = await import('../src/game/daily.js');
  useBoard(store);

  const stamped = { ...summary, sim: simVersion(), schema: 1 };
  const entry = entryFromRun(stamped, { profile, arena: 'park', mode: 'stunt', day: '2026-01-01', daily: true });
  const placings = await submitRun(stamped, {
    profile, arena: 'park', mode: 'stunt', day: '2026-01-01', daily: true,
  });
  // Stock and daily are true here; RAW depends on how the scripted driver flew.
  const expect = BOARDS.filter((b) => !b.lensOf && b.qualifies(entry)).length;
  check(placings.length === expect && placings.length >= 4,
    'one run files onto every board it qualifies for',
    `${placings.length} boards: ${placings.map((p) => p.board.id).join(', ')}`);

  check(placings.every((p) => p.rank === 1), 'and it ranks on each of them',
    placings.map((p) => `${p.board.id} #${p.rank}`).join(', '));

  // BEST STUNT must rank by the landing, not by the run.
  const stuntPlace = placings.find((p) => p.board.id === 'stunt');
  check(!!stuntPlace && stuntPlace.entry.value === entry.bestStunt
    && entry.bestStunt > 0 && entry.bestStunt <= entry.score,
    'BEST STUNT ranks one landing, not the run',
    stuntPlace ? `best stunt ${stuntPlace.entry.value.toLocaleString()} of a ${entry.score.toLocaleString()} run`
      : 'the run banked nothing worth ranking');

  // FRIENDS is a lens: it reads the arena board and filters, so it must never
  // show a stranger and must always show you.
  const friends = await readBoard('friends', {
    arena: 'park', mode: 'stunt', day: '2026-01-01', car: 'vector',
    slot: 0, friends: [],
  });
  const strangers = await readBoard('friends', {
    arena: 'park', mode: 'stunt', day: '2026-01-01', car: 'vector',
    slot: 9, friends: [],
  });
  check(friends.length === 1 && strangers.length === 0,
    'FRIENDS is a lens over the arena board',
    `you see ${friends.length}, a stranger with no friends sees ${strangers.length}`);

  useBoard(LocalBoard);
}

console.log('');
console.log(fails.length
  ? `FAIL  ${fails.length} of the mastery layer's claims do not hold`
  : 'PASS  ghosts are the runs they recorded, and the ladder holds');
process.exit(fails.length ? 1 : 0);
