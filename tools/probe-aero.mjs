/**
 * Measures what each body panel actually does to the car in flight — the
 * evidence behind §5.1 and pillar 5.
 *
 * Nothing in the code says "hood pitches back". The hood is a plate on a hinge
 * and the air decides; this probe reads the result. Results are reported as
 * angular acceleration, not torque, because the car's roll inertia is about
 * seven times smaller than its yaw inertia — compare raw torques and a door
 * looks like a yaw device when what you actually feel is roll.
 */
import TUNING from '../src/TUNING.js';
import { probe, SPEED, AOA } from './flight-rig.mjs';

const C = TUNING.CAR;
const I = {
  pitch: (C.MASS / 3) * (C.HALF.y ** 2 + C.HALF.z ** 2) * C.INERTIA_SCALE.x,
  yaw: (C.MASS / 3) * (C.HALF.x ** 2 + C.HALF.z ** 2) * C.INERTIA_SCALE.y,
  roll: (C.MASS / 3) * (C.HALF.x ** 2 + C.HALF.y ** 2) * C.INERTIA_SCALE.z,
};

const BASE = await probe({});
const n = (v) => ((v >= 0 ? '+' : '') + v.toFixed(2)).padStart(6);
const checks = [];

async function row(name, actions, want, test) {
  const r = await probe(actions);
  const a = {
    pitch: (r.pitch - BASE.pitch) * 1000 / I.pitch,
    yaw: (r.yaw - BASE.yaw) * 1000 / I.yaw,
    roll: (r.roll - BASE.roll) * 1000 / I.roll,
    dragRatio: r.drag / BASE.drag,
  };
  const ok = test(a);
  checks.push(ok);
  console.log(`${name.padEnd(12)} pitch ${n(a.pitch)}  yaw ${n(a.yaw)}  roll ${n(a.roll)}  drag x${a.dragRatio.toFixed(2)}   ${ok ? 'PASS' : 'FAIL'}  ${want}`);
  return a;
}

console.log(`── what each part does to the car, ${SPEED} m/s at ${(AOA * 180 / Math.PI).toFixed(0)}deg AoA ──`);
console.log(`   angular acceleration in rad/s², + = nose up / nose left / right side down`);
console.log(`   inertia: pitch ${I.pitch.toFixed(0)}  yaw ${I.yaw.toFixed(0)}  roll ${I.roll.toFixed(0)} kg·m²`);
console.log(`   bare car: drag ${BASE.drag.toFixed(2)} kN, pitch ${(BASE.pitch * 1000 / I.pitch).toFixed(2)} rad/s² (weathercock)\n`);

await row('HOOD', { hood: 1 }, '§5.1 hood = pitch back', (a) => a.pitch > 1.0);
await row('TRUNK', { trunk: 1 }, '§5.1 trunk = pitch forward', (a) => a.pitch < -1.0);
await row('DOOR_L', { doorL: 1 }, '§5.1 one door = roll', (a) => Math.abs(a.roll) > 2.0 && Math.abs(a.roll) > Math.abs(a.yaw));
await row('DOOR_R', { doorR: 1 }, '§5.1 one door = roll (mirrored)', (a) => Math.abs(a.roll) > 2.0 && Math.abs(a.roll) > Math.abs(a.yaw));
await row('BOTH DOORS', { doorL: 1, doorR: 1 }, '§5.1 both = air brake', (a) => a.dragRatio > 2.0 && Math.abs(a.roll) < 1.0);
await row('SPOILER', { spoiler: 1 }, '§5.1 spoiler = stability', (a) => Math.abs(a.pitch) < 1.0);

console.log(`\n${checks.filter(Boolean).length}/${checks.length} of §5.1's claims hold in measurement.`);
process.exit(checks.every(Boolean) ? 0 : 1);
