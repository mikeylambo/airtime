/**
 * A whole run, end to end: drive, score, chain, record, grade.
 *
 * This is the Gate B check — "boost earn -> launch -> trick -> land -> score,
 * 90s timer, result screen" — everything except the screen, which is a picture
 * (capture/screens/result.png), not something a script can judge.
 */
import { Sim } from '../src/sim/sim.js';
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { resolveSetup } from '../src/sim/cars.js';
import { Recorder } from '../src/sim/replay.js';
import { LICENCES, evaluate } from '../src/game/licences.js';
import { loopActions, loopEdges } from '../src/loop-demo.js';

const DT = 1 / TUNING.SIM.HZ;
// VECTOR, not a favourite: this probe measures the loop, and the loop should
// be measured on the car the tuning file describes rather than on whichever
// instrument happens to suit the scripted driver.
const profile = {
  car: 'vector', livery: 'stock',
  tune: { weight: .5, suspension: .5, thrust: .5, aero: .5 },
  parts: { doors: 'stock', hood: 'stock', trunk: 'stock', spoiler: 'stock' },
};

const setup = resolveSetup(profile);
const sim = await Sim.create(setup, 'park');
const rec = new Recorder({ arena: 'park', setup, profile });
sim.restartRun('stunt');
sim.run.begin();

let t = 0, launchT = null, launchStep = 0;
const clips = [];
const log = [];

// The same scripted driver the Gate B capture uses, so what the clip shows and
// what this measures are the same run.
const ctx = { thrusted: false, airborne: false, launchT: null, boost: 0, aim: null };
const drive = () => {
  ctx.airborne = sim.airborne;
  ctx.launchT = launchT;
  ctx.boost = sim.boost.value;
  ctx.car = sim.car;
  ctx.park = sim.park;
  return loopActions(t, NEUTRAL_ACTIONS, ctx);
};
const edgesFor = () => loopEdges(t, DT, ctx);

while (!sim.run.over && t < 120) {
  const a = drive();
  const e = edgesFor();
  rec.record(a, e);
  sim.step(DT, a, e);
  t += DT;
  for (const ev of sim.drainEvents()) {
    if (ev.type === 'launch' && ev.launch.armed) { launchT = t; launchStep = rec.step; ctx.thrusted = false; }
    if (ev.type === 'landed' && ev.result) {
      const r = ev.result;
      if (r.airtime > TUNING.AIRTIME.MIN_LOGGED_AIRTIME) {
        log.push(`  t=${t.toFixed(1).padStart(5)}s ${r.quality.padEnd(7)} air ${r.airtime.toFixed(2)}s  tier ${r.tier.padEnd(9)} ` +
          `bank ${String(Math.round(r.bank)).padStart(4)} x${(r.landingMult * r.tierMult * r.combo).toFixed(2)} = ` +
          `${String(r.total).padStart(5)}  ${r.tricks.map((k) => k.name).join('+') || '—'}`);
      }
      if (r.total >= TUNING.REPLAY.AUTOSAVE_SCORE) {
        clips.push(rec.clip(launchStep, rec.step, { total: r.total, quality: r.quality }));
      }
    }
  }
}

const s = sim.runSummary();
console.log(`── a ${TUNING.RUN.DURATION}s run ──────────────────────────────────────────`);
for (const l of log.slice(0, 14)) console.log(l);
if (log.length > 14) console.log(`  … ${log.length - 14} more`);
console.log(`\nscore        ${s.score.toLocaleString()}   medal ${s.medal || 'none'}`);
console.log(`jumps        ${s.jumps}  landed ${s.landed}  crashes ${s.crashes}  rate ${(s.landingRate * 100).toFixed(0)}%`);
console.log(`coins        ${s.coins}/${sim.park.coins.length}   near misses ${s.nearMisses}   thrust bursts ${s.thrustBursts}`);
console.log(`ground time  ${(sim.telemetry.groundFraction * 100).toFixed(0)}%  (§5 wants ~70%)`);
console.log(`respawns     ${sim.respawns}`);
console.log(`replay       ${rec.frames.length} frames, ${(rec.sizeBytes / 1024).toFixed(1)}KB · ${clips.length} clips auto-saved`);

console.log('\n── licence grades this run would earn ──');
for (const test of LICENCES.slice(0, 5)) {
  const r = evaluate(test, s);
  console.log(`  ${test.name.padEnd(16)} ${String(r.value).padStart(3)} ${r.unit.padEnd(14)} ${r.grade || '—'}`);
}

const ok = s.score > 0 && s.jumps > 0 && rec.frames.length > 0;
console.log(ok ? '\nPASS  the loop runs: earn, launch, trick, land, score' : '\nFAIL');
process.exit(ok ? 0 : 1);
