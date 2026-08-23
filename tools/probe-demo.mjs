/** Does the scripted Gate A demo jump land? Run before any capture. */
import { Sim } from '../src/sim/sim.js';
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { demoActions, demoEdges, DEMO_CLIP } from '../src/demo-jump.js';

const DT = 1 / TUNING.SIM.HZ;
const sim = await Sim.create();
let t = 0, launch = null, landing = null, maxTilt = 0, thrust = null;
const marks = [];
for (let i = 0; i < Math.round(16 / DT) && !landing; i++) {
  sim.step(DT, demoActions(t, NEUTRAL_ACTIONS, launch && launch.t), demoEdges(t, DT, launch && launch.t));
  t += DT;
  if (launch) maxTilt = Math.max(maxTilt, sim.car.tiltAngle * 180 / Math.PI);
  if (sim.thrust.active && !thrust) thrust = { t, mode: sim.thrust.mode };
  for (const e of sim.drainEvents()) {
    if (e.type === 'launch' && e.launch.armed && !launch) { launch = { ...e.launch, t }; maxTilt = 0; }
    if (e.type === 'deploy') marks.push(`${e.slot}@${t.toFixed(2)}`);
    if (e.type === 'landed' && launch && !landing) landing = { ...e.landing, t };
  }
}
console.log(`launch      t=${launch.t.toFixed(2)}s  speed ${launch.speed.toFixed(1)} m/s  predicted air ${launch.predictedAirtime.toFixed(2)}s`);
console.log(`deploys     ${marks.join(' ') || 'none'}`);
console.log(`thrust      ${thrust ? `${thrust.mode.toUpperCase()} at t=${thrust.t.toFixed(2)}` : 'never fired'}`);
console.log(`peak tilt   ${maxTilt.toFixed(0)}deg`);
console.log(`landing     ${landing.quality.toUpperCase()} ${landing.angleDeg.toFixed(1)}deg  ${landing.wheels} wheels  airtime ${landing.airtime.toFixed(2)}s  tier ${landing.tier}`);
console.log(`clip window t=${DEMO_CLIP.start} .. ${DEMO_CLIP.start + DEMO_CLIP.seconds}s  (launch at ${launch.t.toFixed(2)}, landing at ${landing.t.toFixed(2)})`);
const inFrame = launch.t > DEMO_CLIP.start && landing.t < DEMO_CLIP.start + DEMO_CLIP.seconds;
console.log(inFrame ? 'PASS  launch and landing both inside the 10s clip' : 'FAIL  clip window misses the jump');
process.exit(landing.quality === 'crash' || !inFrame ? 1 : 0);
