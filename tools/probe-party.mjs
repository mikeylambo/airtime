/**
 * R11's gate: seven lenses on one game, and the things you do with a run.
 *
 * The mode roster's whole claim is that these are *lenses*, not seven games:
 * the same loop with one rule bolted on. That is only true if each rule
 * actually bites and none of them needs its own simulation — so each is
 * exercised here against a real world, the same way §9's original three were.
 *
 * And two things that are not modes:
 *
 * - **A run is a string.** A clip is inputs and a seed, so sharing a run needs
 *   no upload, no account and no server — and what arrives is not a video, it
 *   is the run, re-simulating to the same metre.
 * - **The daily set is drawn from the ladder that exists.** A daily asking for
 *   something the game does not otherwise ask for is a second game.
 *
 *   node tools/probe-party.mjs
 */

import TUNING from '../src/TUNING.js';
import { Sim } from '../src/sim/sim.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { resolveSetup } from '../src/sim/cars.js';
import { MODES } from '../src/sim/modes.js';
import { Recorder } from '../src/sim/replay.js';
import { loopActions, loopEdges } from '../src/loop-demo.js';
import { ghostFromRun, bakeGhost, STRIDE } from '../src/game/ghosts.js';
import { encodeRun, decodeRun } from '../src/game/codes.js';
import { dailySet, todayKey } from '../src/game/daily.js';
import { CHALLENGES } from '../src/game/challenges.js';
import * as Horse from '../src/game/horse.js';

const DT = 1 / TUNING.SIM.HZ;
const fails = [];
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} ${detail}`);
  if (!ok) fails.push(label);
};
const setup = resolveSetup({
  car: 'vector', livery: 'stock',
  tune: { weight: .5, suspension: .5, thrust: .5, aero: .5 },
  parts: { doors: 'stock', hood: 'stock', trunk: 'stock', spoiler: 'stock' },
});

console.log('\n── seven lenses, and what you do with a run ─────────────────\n');

// ── The roster ─────────────────────────────────────────────────────────────
{
  const ids = Object.keys(MODES);
  const solo = ids.filter((id) => !MODES[id].party);
  check(ids.length >= 7, 'the roster is seven lenses or more',
    `${ids.length}: ${ids.join(', ')}`);
  const noRules = ids.filter((id) => !MODES[id].rules);
  check(noRules.length === 0, 'and every one of them states its rule',
    noRules.length ? noRules.join(', ') : `${solo.length} solo, ${ids.length - solo.length} party`);
}

/** A landing the mode hooks can chew on. */
const landing = (over) => ({
  quality: 'clean', multiplier: 1.5, angle: 0.05, angleDeg: 3, wheels: 4, bounced: false,
  airtime: 2.2, height: 12, impactVel: 6, bounces: 0,
  from: { x: 0, y: 10, z: 80 }, landedAt: { x: 0, y: 8, z: -10 },
  target: null, tier: 'road', counted: true, ...over,
});

const world = async (mode) => {
  const sim = await Sim.create(setup, 'park', { mode });
  sim.restartRun(mode, MODES[mode].seconds, 7);
  sim.run.begin();
  sim.drainEvents();
  return sim;
};

// ── Best Trick: the score is the best landing, never the sum ───────────────
{
  const sim = await world('besttrick');
  const p = sim.players[0];
  for (const total of [4000, 1500, 9000, 2000]) {
    sim._bank(p, landing({}), false);
    // _bank resolves through the trick tracker, so drive the mode hook with a
    // known payout directly — what is under test is the running maximum.
    const r = MODES.besttrick.onLanded(p, { landed: true, total, payout: total, coins: 0 }, sim);
    p.run.addLanding(r);
  }
  const best = sim.modeState.best[0];
  check(best === 9000 && p.run.score >= 9000,
    'BEST TRICK: the score is the best landing',
    `4,000 / 1,500 / 9,000 / 2,000 -> best ${best.toLocaleString()}`);
}

// ── Combo Run: a crash ends it ─────────────────────────────────────────────
{
  const sim = await world('combo');
  const p = sim.players[0];
  MODES.combo.onLanded(p, { landed: true, total: 100 }, sim);
  const aliveAfterLanding = p.run.alive;
  MODES.combo.onLanded(p, { landed: false, total: 0 }, sim);
  check(aliveAfterLanding && !p.run.alive && MODES.combo.isOver(sim),
    'COMBO RUN: one crash ends the run',
    `alive after a landing, out after a crash, round over ${MODES.combo.isOver(sim)}`);
}

// ── Survival: the clock is the score ───────────────────────────────────────
{
  const S = TUNING.MODES.SURVIVAL;
  const sim = await world('survival');
  const p = sim.players[0];
  check(Math.abs(sim.round.duration - S.START) < 0.01,
    'SURVIVAL: it starts with twenty seconds', `${sim.round.duration}s`);

  const before = sim.round.timeLeft;
  MODES.survival.onLanded(p, { landed: true, total: 500, facetCount: 5 }, sim);
  const afterLanding = sim.round.timeLeft;
  MODES.survival.onLanded(p, { landed: false, total: 0 }, sim);
  const afterCrash = sim.round.timeLeft;
  check(afterLanding > before && afterCrash < afterLanding,
    'a landing buys time and a crash costs it',
    `${before.toFixed(1)}s -> ${afterLanding.toFixed(1)}s -> ${afterCrash.toFixed(1)}s`);

  // A big stack buys more than a hop, and neither buys a whole round.
  const a = { ...sim, round: { ...sim.round, timeLeft: 20 } };
  const hop = MODES.survival.onLanded(p, { landed: true, facetCount: 0 }, a).timeAdded;
  a.round.timeLeft = 20;
  const stack = MODES.survival.onLanded(p, { landed: true, facetCount: 9 }, a).timeAdded;
  check(stack > hop && stack <= S.MAX_ADD,
    'and a stack buys more than a hop, within a cap',
    `hop +${hop}s, nine facets +${stack}s, cap ${S.MAX_ADD}s`);
}

// ── Free Ride: no clock worth watching, and off the boards ─────────────────
{
  check(MODES.freeride.scored === false && MODES.freeride.seconds >= 600,
    'FREE RIDE: no medal, and no clock worth watching',
    `${MODES.freeride.seconds}s and off the boards`);
}

// ── HORSE ──────────────────────────────────────────────────────────────────
{
  const run = (facets) => ({ landings: [{ landed: true, facetCount: facets }] });
  let st = Horse.begin(3);

  const set = Horse.resolve(st, run(6));
  check(set.result === 'set' && st.mark.facets === 6,
    'HORSE: the first turn sets the mark', 'six facets, and the setter never misses');

  const matched = Horse.resolve(st, run(7));
  const missed = Horse.resolve(st, run(2));
  check(matched.result === 'matched' && missed.result === 'missed'
    && st.players[2].letters === 1,
    'matching costs nothing, missing costs a letter',
    `seven matched a six; two took an "${Horse.WORD[0]}"`);

  // Five letters and you are out; last one standing wins.
  st = Horse.begin(2);
  for (let i = 0; i < 24 && !st.over; i++) {
    Horse.resolve(st, st.turn === 0 ? run(8) : run(0));
  }
  check(st.over && st.winner === 0 && st.players[1].letters === Horse.WORD.length,
    'five letters and you are out',
    `player 1 wins; player 2 spelled ${Horse.spell(st.players[1].letters)}`);
}

// ── Run codes: a run is a string, and the string is the run ────────────────
{
  const SECONDS = 20;
  const sim = await Sim.create(setup, 'park');
  sim.restartRun('stunt', SECONDS, 0x1234abcd);
  while (!sim.round.running) sim.step(DT, NEUTRAL_ACTIONS);
  sim.drainEvents();
  const rec = new Recorder({
    arena: 'park', setup,
    profile: { car: 'vector', livery: 'stock', tune: null, parts: null },
    seed: sim.roundSeed, duration: sim.round.duration,
  });
  const truth = [];
  let t = 0, launchT = null;
  const ctx = { thrusted: false, airborne: false, launchT: null, boost: 0, aim: null };
  while (t < SECONDS && !sim.run.over) {
    ctx.airborne = sim.airborne; ctx.launchT = launchT; ctx.boost = sim.boost.value;
    ctx.car = sim.car; ctx.park = sim.park;
    const a = loopActions(t, NEUTRAL_ACTIONS, ctx);
    const e = loopEdges(t, DT, ctx);
    sim.step(DT, rec.record(a, e), e);
    const p = sim.car.position;
    truth.push([p.x, p.y, p.z]);
    t += DT;
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'launch' && ev.launch.armed) { launchT = t; ctx.thrusted = false; }
    }
  }
  const record = ghostFromRun(rec, { ...sim.runSummary(0), name: 'PROBE' }, 0);

  const code = await encodeRun(record);
  check(typeof code === 'string' && code.startsWith('AT1.') && code.length < 60000,
    'a run encodes to a string you could paste',
    `${code.length} characters for ${SECONDS}s of driving`);

  const back = await decodeRun(code);
  check(back.ok, 'and decodes back', back.ok ? `${back.record.name} · ${back.record.score}` : back.why);

  // The real question: is the decoded run the run? Bake it and compare.
  const ghost = await bakeGhost(back.record, { yieldEvery: 0 });
  let worst = 0;
  const n = Math.min(truth.length, ghost.steps);
  for (let i = 0; i < n; i++) {
    const o = i * STRIDE;
    worst = Math.max(worst, Math.hypot(
      ghost.frames[o] - truth[i][0], ghost.frames[o + 1] - truth[i][1],
      ghost.frames[o + 2] - truth[i][2]));
  }
  check(worst < 0.001, 'and what arrives is the run, not a picture of it',
    `worst divergence ${worst.toFixed(4)} m over ${n} steps`);

  const junk = await decodeRun('hello');
  const wrongSim = await decodeRun(await encodeRun({ ...record, sim: '999.zzz' }));
  check(!junk.ok && !wrongSim.ok,
    'a bad code is refused with a reason',
    `"${junk.why}" / "${wrongSim.why}"`);
}

// ── The daily set ──────────────────────────────────────────────────────────
{
  const a = dailySet(CHALLENGES, '2026-03-01');
  const b = dailySet(CHALLENGES, '2026-03-01');
  const c = dailySet(CHALLENGES, '2026-03-02');
  const sameIds = (x, y) => x.challenges.map((q) => q.id).join() === y.challenges.map((q) => q.id).join();
  check(a.challenges.length === 3 && sameIds(a, b) && !sameIds(a, c),
    'the daily set is three, fixed by the date',
    `${a.challenges.map((q) => q.name).join(' · ')}`);

  const fromLadder = a.challenges.every((q) => CHALLENGES.includes(q));
  const noModes = a.challenges.every((q) => !q.mode);
  check(fromLadder && noModes,
    'drawn from the ladder, and never gated on a mode',
    'a daily asking for something the game does not otherwise ask for is a second game');

  const today = dailySet(CHALLENGES);
  check(today.day === todayKey() && today.challenges.length === 3,
    'and today has one', today.challenges.map((q) => q.name).join(' · '));
}

console.log('');
console.log(fails.length
  ? `FAIL  ${fails.length} of R11's claims do not hold`
  : 'PASS  seven lenses, and a run is a string');
process.exit(fails.length ? 1 : 0);
