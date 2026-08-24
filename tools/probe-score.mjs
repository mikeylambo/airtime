/** Does a real run bank, multiply and pay out the way §3.1 says it should? */
import { Sim } from '../src/sim/sim.js';
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { demoActions, demoEdges } from '../src/demo-jump.js';

const DT = 1 / TUNING.SIM.HZ;
const sim = await Sim.create();
sim.run.begin();
let t = 0, launchT = null;
const rows = [];
for (let i = 0; i < Math.round(12 / DT); i++) {
  sim.step(DT, demoActions(t, NEUTRAL_ACTIONS, launchT), demoEdges(t, DT, launchT));
  t += DT;
  for (const e of sim.drainEvents()) {
    if (e.type === 'launch' && e.launch.armed && launchT === null) launchT = t;
    if (e.type === 'coin') rows.push(`  coin @ t=${t.toFixed(2)}`);
    if (e.type === 'landed' && e.result) {
      const r = e.result;
      console.log(`\nLANDING  ${r.quality.toUpperCase()}  airtime ${r.airtime.toFixed(2)}s  tier ${r.tier} (x${r.tierMult})`);
      console.log(`  tricks named after the fact:`);
      for (const k of r.tricks) console.log(`    ${k.name.padEnd(16)} ${String(k.value).padStart(5)}`);
      if (!r.tricks.length) console.log('    (none)');
      console.log(`  trick total ${String(r.trickTotal).padStart(5)}   airtime bonus ${String(r.airBonus).padStart(4)}   height bonus ${String(r.heightBonus).padStart(4)}`);
      console.log(`  BANK ${r.bank}  x landing ${r.landingMult}  x tier ${r.tierMult}  x combo ${r.combo}  =  ${r.payout}`);
      console.log(`  coins ${r.coins} (flat)  ->  TOTAL ${r.total}`);
    }
  }
}
console.log(`\ncoins collected: ${sim.coinsTaken.size}/${sim.park.coins.length}`);
console.log(`run score: ${sim.run.score}  medal: ${sim.run.medal || 'none'}  combo now x${sim.run.combo}`);
const ok = sim.run.score > 0;
console.log(ok ? '\nPASS  a run banks and pays out' : '\nFAIL  nothing scored');

// ── Real inputs that earn real rotations, to prove the namer ───────────────
console.log('\n── holding parts long enough to complete rotations ──');
for (const [label, hold] of [
  ['both doors 0.9s -> ?', { doorL: 1 }],
  ['hood 1.1s (backflip)', { hood: 1 }],
  ['tail flap 1.1s      ', { trunk: 1 }],
]) {
  const s2 = await Sim.create();
  s2.run.begin();
  let t2 = 0, lt = null, done = false;
  for (let i = 0; i < Math.round(15 / DT) && !done; i++) {
    const air = s2.airborne && lt !== null;
    const u = air ? t2 - lt : 0;
    const a = { ...NEUTRAL_ACTIONS, throttle: 1, boost: t2 < 4.6,
                ...(air && u > 0.3 && u < 1.4 ? hold : {}) };
    s2.step(DT, a, {});
    t2 += DT;
    for (const e of s2.drainEvents()) {
      if (e.type === 'launch' && e.launch.armed && lt === null) lt = t2;
      if (e.type === 'landed' && e.result && lt !== null && e.result.airtime > 1.0) {
        const r = e.result;
        const names = r.tricks.length ? r.tricks.map((k) => `${k.name} ${k.value}`).join(' + ') : '(no full rotation)';
        console.log(`  ${label}  ${r.quality.toUpperCase().padEnd(7)} air ${r.airtime.toFixed(2)}s  ${names}`);
        console.log(`      bank ${r.bank} x landing ${r.landingMult} x tier ${r.tierMult} = ${r.payout}`);
        done = true;
        break;
      }
    }
  }
}

process.exit(ok ? 0 : 1);
