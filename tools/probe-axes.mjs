/**
 * The R2 blocker: can the car be *both* recoverable and rotatable?
 *
 * A single centre of pressure forces a choice. This checks that splitting it
 * per axis buys both — a hands-off jump that lands, and panel inputs that can
 * still turn the car all the way over.
 */
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { Sim } from '../src/sim/sim.js';

const DT = 1 / TUNING.SIM.HZ;

async function jump(hold = {}, holdFor = 0, correctAt = null) {
  const sim = await Sim.create();
  sim.run.begin();
  let t = 0, lt = null, res = null, maxTilt = 0;
  for (let i = 0; i < Math.round(15 / DT) && !res; i++) {
    const air = sim.airborne && lt !== null;
    const u = air ? t - lt : 0;
    const a = { ...NEUTRAL_ACTIONS, throttle: 1, boost: t < 4.6,
                ...(air && u > 0.25 && u < 0.25 + holdFor ? hold : {}) };
    const e = correctAt !== null && air && u >= correctAt && u < correctAt + DT ? { thrust: true } : {};
    sim.step(DT, a, e);
    t += DT;
    if (lt !== null) maxTilt = Math.max(maxTilt, sim.car.tiltAngle * 180 / Math.PI);
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'launch' && ev.launch.armed && lt === null) { lt = t; maxTilt = 0; }
      if (ev.type === 'landed' && ev.result && ev.result.airtime > 1.0) res = ev.result;
    }
  }
  const names = res ? res.tricks.filter((k) => k.kind !== 'pose').map((k) => k.name) : [];
  return { res, names, maxTilt };
}

const row = (label, r) =>
  `${label.padEnd(26)} ${(r.res ? r.res.quality : 'none').padEnd(8)} ` +
  `${(r.res ? r.res.airtime.toFixed(2) + 's' : '  -').padStart(6)}  ` +
  `peak tilt ${r.maxTilt.toFixed(0).padStart(3)}  ${r.names.join('+') || '—'}`;

console.log('── can it land hands-off, and still be turned over? ──\n');
const neutral = await jump();
console.log(row('hands off', neutral));
console.log(row('hood 1.0s', await jump({ hood: 1 }, 1.0)));
console.log(row('tail flap 1.0s', await jump({ trunk: 1 }, 1.0)));
console.log(row('left door 1.0s', await jump({ doorL: 1 }, 1.0)));
console.log(row('both doors 1.0s', await jump({ doorL: 1, doorR: 1 }, 1.0)));
console.log('\n── and can a single correction save a wild one? ──\n');
console.log(row('door 1.0s, no save', await jump({ doorL: 1 }, 1.0)));
console.log(row('door 1.0s + CORRECT', await jump({ doorL: 1 }, 1.0, 1.9)));

const landsClean = neutral.res && neutral.res.quality !== 'crash';
const rotates = ['hood', 'trunk', 'doorL'].length;
const spun = [
  await jump({ hood: 1 }, 1.0),
  await jump({ trunk: 1 }, 1.0),
  await jump({ doorL: 1 }, 1.0),
].filter((r) => r.names.length > 0).length;
console.log(`\nhands-off landing: ${landsClean ? neutral.res.quality : 'CRASH'}`);
console.log(`parts that complete a rotation in 1.0s: ${spun}/${rotates}`);
const ok = landsClean && spun >= 2;
console.log(ok
  ? '\nPASS  recoverable and rotatable at the same time — R2 is not blocked'
  : '\nFAIL  still forced to choose between landing it and turning it over');
process.exit(ok ? 0 : 1);
