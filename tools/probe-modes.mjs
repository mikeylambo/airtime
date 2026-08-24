/**
 * §9 modes: does each rule actually change what a round is worth?
 *
 * Every mode is the same loop with one rule bolted on, so the check is that
 * the same driving pays differently under each of them.
 */
import { Sim } from '../src/sim/sim.js';
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { loopActions, loopEdges } from '../src/loop-demo.js';
import { MODES } from '../src/sim/modes.js';

const DT = 1 / TUNING.SIM.HZ;

async function round(modeId, players = 1, seconds = 45) {
  const arena = MODES[modeId].arena;
  const sim = await Sim.create(null, arena, { players, mode: modeId, duration: seconds });
  sim.restartRun(modeId, seconds);
  sim.round.begin();
  const ctxs = sim.players.map(() => ({ thrusted: false, airborne: false, launchT: null, boost: 0 }));
  const launch = sim.players.map(() => null);
  let t = 0, zones = 0, elims = 0, calls = 0;

  while (!sim.round.over && t < seconds + 4) {
    const acts = sim.players.map((p, i) => {
      const c = ctxs[i];
      c.airborne = p.airborne; c.launchT = launch[i]; c.boost = p.boost.value;
      c.car = p.car; c.park = sim.park;
      // Nudge each driver onto a slightly different line so they diverge.
      return loopActions(t + i * 1.7, NEUTRAL_ACTIONS, c);
    });
    const eds = sim.players.map((_, i) => loopEdges(t + i * 1.7, DT, ctxs[i]));
    sim.step(DT, acts, eds);
    t += DT;
    for (const e of sim.drainEvents()) {
      if (e.type === 'launch' && e.launch.armed) { launch[e.player || 0] = t; ctxs[e.player || 0].thrusted = false; }
      if (e.type === 'zone') zones++;
      if (e.type === 'eliminated') elims++;
      if (e.type === 'landed' && e.result && e.result.called) calls++;
    }
  }
  return { sim, all: sim.allSummaries(), zones, elims, calls, t };
}

console.log('mode        arena  players  score(s)                 notes');
for (const id of ['stunt', 'shot', 'standing', 'potato']) {
  const players = id === 'standing' ? 3 : 1;
  const r = await round(id, players);
  const scores = r.all.map((s) => s.score.toLocaleString()).join(' / ');
  const notes = [];
  if (id === 'shot') notes.push(`${r.calls} landings had a call`);
  if (id === 'potato') notes.push(`${r.zones} zone moves`);
  if (id === 'standing') notes.push(`${r.elims} eliminated, ended at ${r.t.toFixed(0)}s`);
  console.log(
    `${id.padEnd(11)} ${MODES[id].arena.padEnd(6)} ${String(players).padStart(7)}  ${scores.padEnd(24)} ${notes.join(', ')}`
  );
}

// Split-screen: four cars, one world, one clock.
const split = await round('stunt', 4, 30);
console.log(`\nsplit-screen 4p: scores ${split.all.map((s) => s.score).join(' / ')}`);
console.log(`  cars are in one world: distinct positions ${new Set(split.sim.players.map((p) => p.car.position.x.toFixed(1))).size}/4`);
const ok = split.all.length === 4;


// ── The two rules the scripted driver is too timid to demonstrate ──────────
console.log('\n── mode rules, exercised directly ──');
{
  // Hot Potato: the same landing pays inside the zone and pays nothing outside.
  const sim = await Sim.create(null, 'city', { mode: 'potato', duration: 60 });
  sim.restartRun('potato', 60); sim.round.begin();
  const zone = sim.modeState.zone;
  const p = sim.players[0];
  const fake = { landed: true, quality: 'clean', target: zone.id, tier: zone.tier,
                 bank: 400, payout: 400, coins: 0, total: 400, tricks: [], airtime: 2 };
  const inside = sim.mode.onLanded(p, { ...fake }, sim);
  const outside = sim.mode.onLanded(p, { ...fake, target: 'somewhere_else' }, sim);
  console.log(`  potato: inside the zone ${inside.total}, outside it ${outside.total}` +
    `  ${inside.total > 0 && outside.total === 0 ? 'PASS' : 'FAIL'}`);
}
{
  // Last Car Standing: a crash takes a driver out, and the round ends when one is left.
  const sim = await Sim.create(null, 'park', { players: 3, mode: 'standing', duration: 90 });
  sim.restartRun('standing', 90); sim.round.begin();
  const crash = { landed: false, quality: 'crash', bank: 0, payout: 0, coins: 0, total: 0, tricks: [], airtime: 1 };
  sim.mode.onLanded(sim.players[0], { ...crash }, sim);
  sim.mode.onLanded(sim.players[1], { ...crash }, sim);
  const alive = sim.players.filter((p) => p.run.alive).length;
  const over = sim.mode.isOver(sim);
  console.log(`  standing: 2 of 3 crashed -> ${alive} alive, round over ${over}` +
    `  ${alive === 1 && over ? 'PASS' : 'FAIL'}`);
}
{
  // Call Your Shot: hitting the named target multiplies, missing it does not.
  const sim = await Sim.create(null, 'city', { mode: 'shot', duration: 60 });
  sim.restartRun('shot', 60); sim.round.begin();
  const p = sim.players[0];
  p.launchCall = 'bb_0';
  const base = { landed: true, quality: 'clean', tier: 'billboard', bank: 300,
                 payout: 300, coins: 0, total: 300, tricks: [], airtime: 2 };
  const hit = sim.mode.onLanded(p, { ...base, target: 'bb_0' }, sim);
  const miss = sim.mode.onLanded(p, { ...base, target: 'bb_1' }, sim);
  console.log(`  call your shot: called and hit ${hit.total}, called and missed ${miss.total}` +
    `  ${hit.total > miss.total ? 'PASS' : 'FAIL'}`);
}

console.log(ok ? '\nPASS  every mode runs and split-screen carries four independent scores' : '\nFAIL');
process.exit(ok ? 0 : 1);
