import { Sim } from '../src/sim/sim.js';
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
const DT = 1 / TUNING.SIM.HZ;
const sim = await Sim.create();
const act = { ...NEUTRAL_ACTIONS, throttle: 1, boost: true };
let t = 0;
const n = Math.round(14 / DT);
for (let i = 0; i < n; i++) {
  sim.step(DT, act, {});
  t += DT;
  for (const e of sim.drainEvents()) {
    if (e.type !== 'deploy') console.log(`  t=${t.toFixed(2)} EVENT ${e.type}`, e.landing ? `${e.landing.quality} ${e.landing.angleDeg.toFixed(0)}deg` : (e.launch ? `spd ${e.launch.speed.toFixed(1)} up ${e.launch.upVelocity.toFixed(1)} armed=${e.launch.armed}` : ''));
  }
  if (i % Math.round(0.5 / DT) === 0) {
    const p = sim.car.position;
    console.log(`t=${t.toFixed(1)} z=${p.z.toFixed(1)} y=${p.y.toFixed(2)} spd=${sim.car.speed.toFixed(1)} wheels=${sim.car.wheelsInContact} tilt=${(sim.car.tiltAngle*180/Math.PI).toFixed(0)}deg boost=${sim.boost.value.toFixed(2)}`);
  }
}
