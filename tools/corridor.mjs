/**
 * Ray-casts the hero corridor and prints the actual collision surface height
 * against the measured flight arc. Anything with less than a couple of metres
 * of clearance is something the car will clip mid-flight.
 */
import { Sim } from '../src/sim/sim.js';
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { RAPIER, WHEEL_RAY_GROUPS } from '../src/sim/physics.js';

const DT = 1 / TUNING.SIM.HZ;
const sim = await Sim.create();

// Fly the jump first to capture the true arc.
const act = { ...NEUTRAL_ACTIONS, throttle: 1, boost: true };
let launch = null, t = 0; const arc = [];
for (let i = 0; i < Math.round(8.2 / DT); i++) {
  sim.step(DT, act, {}); t += DT;
  for (const e of sim.drainEvents()) if (e.type === 'launch' && e.launch.armed && !launch) launch = e.launch;
  if (launch) arc.push({ z: sim.car.position.z, y: sim.car.position.y });
}
const arcY = (z) => {
  let best = null;
  for (const p of arc) if (best === null || Math.abs(p.z - z) < Math.abs(best.z - z)) best = p;
  return best && Math.abs(best.z - z) < 4 ? best.y : null;
};

const surf = (x, z) => {
  const hit = sim.world.castRay(new RAPIER.Ray({ x, y: 300, z }, { x: 0, y: -1, z: 0 }), 400, true, undefined, WHEEL_RAY_GROUPS);
  return hit ? 300 - hit.timeOfImpact : -999;
};

console.log('  z      surface   arc      clearance');
for (let z = 20; z >= -170; z -= 6) {
  const g = surf(0, z);
  const a = arcY(z);
  const c = a === null ? null : a - g;
  const flag = c !== null && c < 2.5 && c > -50 ? '  <-- TIGHT' : '';
  console.log(`${String(z).padStart(5)}  ${g.toFixed(1).padStart(7)}  ${a === null ? '   -  ' : a.toFixed(1).padStart(6)}  ${c === null ? '' : c.toFixed(1).padStart(9)}${flag}`);
}
