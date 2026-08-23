/** Hero arc: signed pitch vs path angle, and where it crosses each height. */
import { Sim } from '../src/sim/sim.js';
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { dot } from '../src/sim/mathx.js';
const DT = 1 / TUNING.SIM.HZ;
const sim = await Sim.create();
const act = { ...NEUTRAL_ACTIONS, throttle: 1, boost: true };
let launch = null, t = 0;
const arc = [];
for (let i = 0; i < Math.round(13 / DT); i++) {
  sim.step(DT, act, {}); t += DT;
  for (const e of sim.drainEvents()) if (e.type === 'launch' && e.launch.armed && !launch) launch = e.launch;
  if (launch) {
    const p = sim.car.position, v = sim.car.linvel, f = sim.car.forward;
    // signed nose pitch above horizontal, and the angle of the flight path
    const nose = Math.asin(Math.max(-1, Math.min(1, f.y))) * 180 / Math.PI;
    const path = Math.atan2(v.y, Math.hypot(v.x, v.z)) * 180 / Math.PI;
    arc.push({ t, ...p, nose, path, aoa: nose - path, tilt: sim.car.tiltAngle * 180 / Math.PI });
  }
}
const t0 = arc[0].t;
let apex = arc[0]; for (const p of arc) if (p.y > apex.y) apex = p;
console.log(`launch ${launch.speed.toFixed(1)} m/s @ ${(Math.asin(launch.upVelocity/launch.speed)*180/Math.PI).toFixed(1)}deg | apex y=${apex.y.toFixed(1)} z=${apex.z.toFixed(1)}`);
console.log('  t    z       y     nose   path    AoA   tilt');
for (const p of arc) {
  if (Math.round((p.t - t0) * 100) % 40 !== 0) continue;
  console.log(`${(p.t-t0).toFixed(1).padStart(4)} ${p.z.toFixed(1).padStart(7)} ${p.y.toFixed(1).padStart(6)} ${p.nose.toFixed(0).padStart(6)} ${p.path.toFixed(0).padStart(6)} ${p.aoa.toFixed(0).padStart(6)} ${p.tilt.toFixed(0).padStart(6)}`);
}
const past = arc.filter(p => p.t > apex.t);
for (const h of [9, 6, 3]) {
  const hit = past.find(p => p.y <= h);
  if (hit) console.log(`crosses y=${h}m at z=${hit.z.toFixed(1)} airtime=${(hit.t-t0).toFixed(2)}s tilt=${hit.tilt.toFixed(0)}deg`);
}
