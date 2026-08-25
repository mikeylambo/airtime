/** Searches demo-jump timings for a showy flight that still sticks the landing. */
import { Sim } from '../src/sim/sim.js';
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
const DT = 1 / TUNING.SIM.HZ;
const L = 4.29;   // measured launch time on the current park

function mk(rollDur, gap, thrustAt, trunkDab) {
  const S = [['throttle', 0, 20, 1], ['boost', 0, 4.6, true]];
  if (trunkDab > 0) S.push(['trunk', L + 0.15, L + 0.15 + trunkDab, 1]);
  S.push(['doorL', L + 0.45, L + 0.45 + rollDur, 1]);
  S.push(['doorR', L + 0.45 + rollDur + gap, L + 0.45 + rollDur + gap + rollDur, 1]);
  S.push(['spoiler', L + 0.45 + 2 * rollDur + gap, L + 3.4, 1]);
  return { S, E: [['thrust', thrustAt]] };
}

async function run({ S, E }) {
  const sim = await Sim.create();
  let t = 0, launch = null, landing = null, rollTotal = 0, maxTilt = 0;
  for (let i = 0; i < Math.round(15 / DT) && !landing; i++) {
    const a = { ...NEUTRAL_ACTIONS };
    for (const [k, f, to, v] of S) if (t >= f && t < to) a[k] = v;
    const e = {};
    for (const [k, at] of E) if (t <= at && t + DT > at) e[k] = true;
    sim.step(DT, a, e); t += DT;
    if (launch) {
      const w = sim.car.angvel, f = sim.car.forward;
      rollTotal += Math.abs(w.x * f.x + w.y * f.y + w.z * f.z) * DT;
      maxTilt = Math.max(maxTilt, sim.car.tiltAngle * 180 / Math.PI);
    }
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'launch' && ev.launch.armed && !launch) { launch = { ...ev.launch, t }; rollTotal = 0; maxTilt = 0; }
      if (ev.type === 'landed' && launch && !landing) landing = { ...ev.landing, t };
    }
  }
  return { landing, rollDeg: rollTotal * 180 / Math.PI, maxTilt };
}

console.log('rollDur gap thrust trunk | roll(deg) peakTilt | landing');
const good = [];
for (const rollDur of [0.24, 0.28, 0.32, 0.36]) {
  for (const gap of [0.30, 0.42, 0.55]) {
    for (const trunkDab of [0.12, 0.18, 0.24]) {
     for (const tOff of [1.9, 2.2, 2.5]) {
      const thrustAt = L + tOff;
      const cfg = { rollDur, gap, thrustAt, trunkDab };
      const r = await run(mk(rollDur, gap, thrustAt, trunkDab));
      const l = r.landing;
      // Reject "landings" that are really a later hop after the real one.
      const ok = l && l.quality !== 'crash' && l.airtime > 2.0;
      if (ok) good.push({ ...cfg, ...r });
     }
    }
  }
}
// Prefer a clean stick, then the most roll we can show while still landing it.
const rank = { perfect: 0, clean: 1, sloppy: 2 };
good.sort((a, b) => (rank[a.landing.quality] - rank[b.landing.quality]) || (b.rollDeg - a.rollDeg));
console.log(`\n${good.length} land.`);
for (const g of good.slice(0, 6)) {
  console.log(`  rollDur ${g.rollDur} gap ${g.gap} trunk ${g.trunkDab} thrust +${(g.thrustAt - L).toFixed(2)} -> ${g.landing.quality} ${g.landing.angleDeg.toFixed(0)}deg, roll ${Math.round(g.rollDeg)}deg, peak tilt ${g.maxTilt.toFixed(0)}deg, air ${g.landing.airtime.toFixed(2)}s`);
}
