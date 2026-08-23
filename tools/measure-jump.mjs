/**
 * Measures the hero jump the Gate A capture uses. Run it after touching any
 * ramp, car or suspension number — HERO_LANDING_Z in the park is set from it.
 */
import { Sim } from '../src/sim/sim.js';
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';

const DT = 1 / TUNING.SIM.HZ;
const sim = await Sim.create();
const act = { ...NEUTRAL_ACTIONS, throttle: 1, boost: true };

let launch = null, land = null, apexY = 0, apexZ = 0, t = 0, clamps = 0;
const n = Math.round(16 / DT);
for (let i = 0; i < n && !land; i++) {
  sim.step(DT, act, {}); t += DT;
  if (sim.car.position.y > apexY) { apexY = sim.car.position.y; apexZ = sim.car.position.z; }
  for (const e of sim.drainEvents()) {
    if (e.type === 'launch' && e.launch.armed && !launch) { launch = { ...e.launch, t }; apexY = 0; }
    if (e.type === 'speedClamp') clamps++;
    if (e.type === 'landed' && launch && !land) land = { ...e.landing, t };
  }
}

console.log('── hero jump ──────────────────────────────────────────────');
if (!launch) { console.log('FAIL: never launched'); process.exit(1); }
console.log(`launch      t=${launch.t.toFixed(2)}s  z=${launch.position.z.toFixed(1)}  speed=${launch.speed.toFixed(1)} m/s  up=${launch.upVelocity.toFixed(1)} m/s`);
console.log(`             angle=${(Math.asin(launch.upVelocity / launch.speed) * 180 / Math.PI).toFixed(1)}deg`);
console.log(`prediction  airtime=${launch.predictedAirtime.toFixed(2)}s  apex=${launch.predictedApex.toFixed(1)}m  landing z=${launch.predictedLanding.z.toFixed(1)}`);
console.log(`actual      apex=${apexY.toFixed(1)}m at z=${apexZ.toFixed(1)}`);
if (land) {
  console.log(`landing     ${land.quality.toUpperCase()}  airtime=${land.airtime.toFixed(2)}s  angle=${land.angleDeg.toFixed(1)}deg  wheels=${land.wheels}  tier=${land.tier}  target=${land.target}`);
  console.log(`             final z=${sim.car.position.z.toFixed(1)}  y=${sim.car.position.y.toFixed(1)}`);
} else console.log('landing     (none resolved)');
console.log(`speed clamps fired: ${clamps} ${clamps === 0 ? '(good — no solver blow-ups)' : '(BAD — investigate)'}`);
const orbit = launch.predictedAirtime >= TUNING.CAMERA.ORBIT.MIN_PREDICTED_AIRTIME;
console.log(`orbit camera would arm: ${orbit ? 'YES' : 'NO'} (needs >= ${TUNING.CAMERA.ORBIT.MIN_PREDICTED_AIRTIME}s)`);

const ok = land && land.quality !== 'crash' && clamps === 0 && land.airtime > 2.5 && land.airtime < 3.6;
console.log(ok ? '\nPASS  the hero jump is a ~3s flight that lands' : '\nFAIL  hero jump did not land cleanly');
process.exit(ok ? 0 : 1);
