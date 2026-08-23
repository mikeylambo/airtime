/**
 * Headless drive probe — proves the ground handling before anything is drawn.
 * Checks that throttle moves the car the way its nose points, that steering
 * turns the right way, and that the hero ramp actually launches it.
 */
import { Sim } from '../src/sim/sim.js';
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';

const DT = 1 / TUNING.SIM.HZ;
const sim = await Sim.create();
const A = (o = {}) => ({ ...NEUTRAL_ACTIONS, ...o });

function run(actions, seconds, tap = null) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    sim.step(DT, typeof actions === 'function' ? actions(i * DT) : actions, {});
    if (tap) tap(i * DT);
  }
}

const p0 = { ...sim.car.position };
console.log('spawn        ', fmt(p0), 'heading -Z');

// 1. Throttle for 3s, straight.
run(A({ throttle: 1 }), 3);
const p1 = { ...sim.car.position };
console.log('after 3s WOT ', fmt(p1), 'speed', sim.car.speed.toFixed(1), 'm/s');
const dz = p1.z - p0.z;
console.log(dz < -5 ? 'PASS throttle drives toward -Z (the way the nose points)'
                    : `FAIL throttle moved dz=${dz.toFixed(2)} (expected strongly negative)`);

// 2. Steering direction.
sim.reset();
run(A({ throttle: 1 }), 2);
run(A({ throttle: 1, steer: -1 }), 1.6);
const dxL = sim.car.position.x;
sim.reset();
run(A({ throttle: 1 }), 2);
run(A({ throttle: 1, steer: 1 }), 1.6);
const dxR = sim.car.position.x;
console.log('steer -1 ->x', dxL.toFixed(2), '| steer +1 ->x', dxR.toFixed(2));
console.log(dxL < -1 && dxR > 1 ? 'PASS steer -1 goes left (-X), +1 goes right (+X)'
                                : 'FAIL steering sign is inverted');

// 3. Boost run-up into the hero ramp.
sim.reset();
let maxSpeed = 0, launched = null, landed = null, apex = 0;
run(A({ throttle: 1, boost: true }), 14, () => {
  maxSpeed = Math.max(maxSpeed, sim.car.speed);
  apex = Math.max(apex, sim.car.position.y);
  for (const e of sim.drainEvents()) {
    if (e.type === 'launch' && e.launch.armed && !launched) launched = e.launch;
    if (e.type === 'landed' && launched && !landed) landed = e.landing;
  }
});
console.log('top speed    ', maxSpeed.toFixed(1), 'm/s  | apex y', apex.toFixed(1));
if (launched) {
  console.log('LAUNCH at z', launched.position.z.toFixed(1),
    'speed', launched.speed.toFixed(1),
    'up', launched.upVelocity.toFixed(1),
    '| predicted airtime', launched.predictedAirtime.toFixed(2), 's',
    'landing z', launched.predictedLanding.z.toFixed(1));
} else console.log('FAIL never launched off the hero ramp');
if (landed) {
  console.log('LANDED', landed.quality, 'angle', landed.angleDeg.toFixed(1) + '°',
    'wheels', landed.wheels, 'airtime', landed.airtime.toFixed(2), 's', 'tier', landed.tier);
} else console.log('(no landing resolved inside the window)');
console.log('final pos    ', fmt(sim.car.position));
console.log('telemetry    ', JSON.stringify(sim.telemetry.summary().byQuality), 'groundFrac', sim.telemetry.summary().groundFraction);

function fmt(p) { return `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`; }
