/**
 * R1's gate: does stacking facets actually break the scoring open?
 *
 * A jump that does six different things at once has to be worth an order of
 * magnitude more than a jump that does one thing beautifully — that is the
 * difference between the reference's scoring and ours, and the whole reason
 * for the rewrite.
 */
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { Sim } from '../src/sim/sim.js';

const DT = 1 / TUNING.SIM.HZ;

async function jump(script = {}) {
  const sim = await Sim.create();
  sim.run.begin();
  let t = 0, lt = null, res = null;
  for (let i = 0; i < Math.round(16 / DT) && !res; i++) {
    const air = sim.airborne && lt !== null;
    const u = air ? t - lt : 0;
    const a = { ...NEUTRAL_ACTIONS, throttle: 1, boost: t < 4.6 };
    if (air) for (const [key, from, to] of script.air || []) {
      if (u >= from && u < to) a[key] = 1;
    }
    const e = (script.thrust != null && air && u >= script.thrust && u < script.thrust + DT)
      ? { thrust: true } : {};
    sim.step(DT, a, e); t += DT;
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'launch' && ev.launch.armed && lt === null) lt = t;
      if (ev.type === 'landed' && ev.result && ev.result.airtime > 1.0) res = ev.result;
    }
  }
  return res;
}

const show = (label, r) => {
  if (!r) return console.log(`${label.padEnd(22)} (no landing)`);
  const names = r.facets.map((f) => f.label).join(' · ');
  console.log(`${label.padEnd(22)} ${String(r.facetCount).padStart(2)} facets  x${String(r.facetMult).padStart(4)} ` +
    `${(r.facetName || '').padEnd(10)} ${r.purity.label.padEnd(7)} x${r.purity.mult}  ` +
    `bank ${String(r.bank).padStart(6)}  ${r.landed ? r.quality : 'CRASH'}  ->  ${r.total.toLocaleString()}`);
  console.log(`${''.padEnd(22)} ${names}`);
};

console.log('── one jump, doing more and more at once ──\n');
const plain = await jump();
show('hands off', plain);
const one = await jump({ air: [['doorL', 0.35, 0.75]] });
show('one door', one);
const two = await jump({ air: [['doorL', 0.35, 0.75], ['trunk', 0.10, 0.30]] });
show('door + tail flap', two);
const many = await jump({
  air: [['trunk', 0.10, 0.34], ['doorL', 0.40, 0.86], ['doorR', 1.30, 1.60], ['spoiler', 1.70, 3.4]],
  thrust: 1.95,
});
show('the works', many);

console.log('\n── purity: the same jump, helped and unhelped ──\n');
const raw = await jump({ air: [['doorL', 0.35, 0.80]] });
const flown = await jump({ air: [['doorL', 0.35, 0.80], ['spoiler', 1.0, 3.4]], thrust: 1.9 });
show('no help', raw);
show('wing + thrust', flown);

const all = [plain, one, two, many].filter(Boolean);
const best = all.slice().sort((a, b) => b.facetCount - a.facetCount)[0];
const bankRatio = plain && plain.bank > 0 ? best.bank / plain.bank : Infinity;
const multSpan = best.facetMult / plain.facetMult;
console.log(`\nplainest: ${plain.facetCount} facets x${plain.facetMult}   richest: ${best.facetCount} facets x${best.facetMult}`);
console.log(`multiplier span ${multSpan.toFixed(1)}x   bank ${bankRatio.toFixed(1)}x`);
console.log(`purity span: RAW x${TUNING.SCORE.PURITY.RAW} vs FLOWN x${TUNING.SCORE.PURITY.FLOWN}`);
const ok = best.facetCount >= 6 && multSpan >= 4 && bankRatio >= 4;
console.log(ok
  ? 'PASS  stacking facets breaks the scoring open'
  : 'FAIL  stacking is not paying enough to be the point');
process.exit(ok ? 0 : 1);
