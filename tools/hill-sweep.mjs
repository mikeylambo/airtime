/**
 * Searches landing-hill geometry for the one that turns the hero jump into a
 * landing rather than a crash.
 *
 * The hill must be slightly *shallower* than the arc's own descent, with its
 * crest below the arc: parallel to the arc and the car either clips the crest
 * or floats the whole slope, and steeper and it catches the car nose-first.
 */
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { HILL } from '../src/arena/stunt-park.js';
import { Sim } from '../src/sim/sim.js';

const DT = 1 / TUNING.SIM.HZ;
const act = { ...NEUTRAL_ACTIONS, throttle: 1, boost: true };

async function trial(cfg) {
  Object.assign(HILL, cfg);          // describePark() reads HILL at call time
  const sim = await Sim.create();
  let launch = null, first = null, landing = null, t = 0;
  for (let i = 0; i < Math.round(15 / DT) && !landing; i++) {
    sim.step(DT, act, {}); t += DT;
    if (launch && !first && sim.car.wheelsInContact > 0) {
      first = { z: sim.car.position.z, y: sim.car.position.y, vy: sim.car.linvel.y,
                tilt: sim.car.tiltAngle * 180 / Math.PI, airtime: t - launch.t };
    }
    for (const e of sim.drainEvents()) {
      if (e.type === 'launch' && e.launch.armed && !launch) launch = { ...e.launch, t };
      if (e.type === 'landed' && launch && !landing) landing = e.landing;
    }
  }
  return { first, landing, finalTilt: sim.car.tiltAngle * 180 / Math.PI };
}

console.log('crest  h   slope len | contact z    vDown  tilt  air  | quality  angle w');
const rows = [];
for (const crestZ of [-128, -134, -140]) {
  for (const height of [6, 8, 10]) {
    for (const slopeDeg of [16, 20, 24]) {
      const length = height / Math.tan((slopeDeg * Math.PI) / 180);
      const r = await trial({ crestZ, height, length, halfWidth: 26 });
      const f = r.first, l = r.landing;
      rows.push({ crestZ, height, slopeDeg, length, ...r });
      console.log(
        `${String(crestZ).padStart(5)} ${String(height).padStart(2)} ${String(slopeDeg).padStart(6)}deg ${length.toFixed(0).padStart(3)} |` +
        (f ? ` ${f.z.toFixed(0).padStart(6)} ${(-f.vy).toFixed(1).padStart(7)} ${f.tilt.toFixed(0).padStart(4)}deg ${f.airtime.toFixed(2)}s` : '     no contact        ') +
        ` | ${l ? `${l.quality.padEnd(7)} ${l.angleDeg.toFixed(0).padStart(3)}deg ${l.wheels}` : '(unresolved)'}`
      );
    }
  }
}
const good = rows.filter(r => r.landing && r.landing.quality !== 'crash');
console.log(`\n${good.length}/${rows.length} configurations land.`);
if (good.length) {
  good.sort((a, b) => (a.landing.angleDeg - b.landing.angleDeg));
  const b = good[0];
  console.log(`best: crestZ=${b.crestZ} height=${b.height} slope=${b.slopeDeg}deg length=${b.length.toFixed(1)} -> ${b.landing.quality} at ${b.landing.angleDeg.toFixed(1)}deg`);
}
