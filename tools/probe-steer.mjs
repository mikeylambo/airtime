/** Does deploying a part visibly change a real jump? (Gate A's central claim) */
import { Sim } from '../src/sim/sim.js';
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
const DT = 1 / TUNING.SIM.HZ;

async function jump(midAir = {}, label = '') {
  const sim = await Sim.create();
  let launch = null, t = 0, landing = null, maxTilt = 0;
  const drive = { ...NEUTRAL_ACTIONS, throttle: 1, boost: true };
  for (let i = 0; i < Math.round(16 / DT) && !landing; i++) {
    const airborne = sim.airborne && launch;
    // Hold the part from 0.4 s after launch until touchdown.
    const act = airborne && t - launch.t > 0.4 ? { ...drive, ...midAir } : drive;
    sim.step(DT, act, {}); t += DT;
    if (launch) maxTilt = Math.max(maxTilt, sim.car.tiltAngle * 180 / Math.PI);
    for (const e of sim.drainEvents()) {
      if (e.type === 'launch' && e.launch.armed && !launch) { launch = { ...e.launch, t }; maxTilt = 0; }
      if (e.type === 'landed' && launch && !landing) landing = e.landing;
    }
  }
  console.log(`${label.padEnd(14)} airtime ${landing ? landing.airtime.toFixed(2) : ' -- '}s  landing ${(landing ? landing.quality : 'none').padEnd(7)} ${landing ? landing.angleDeg.toFixed(0).padStart(3) : ' --'}deg  peak tilt ${maxTilt.toFixed(0).padStart(3)}deg  z ${sim.car.position.z.toFixed(0)}`);
}
await jump({}, 'nothing');
await jump({ hood: 1 }, 'hood');
await jump({ trunk: 1 }, 'trunk');
await jump({ doorL: 1 }, 'left door');
await jump({ doorL: 1, doorR: 1 }, 'both doors');
await jump({ spoiler: 1 }, 'spoiler');
