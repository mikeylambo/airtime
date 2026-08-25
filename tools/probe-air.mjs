/**
 * R2's gate: is the car flyable from the stick alone?
 *
 * Not "do the panels work" — probe-aero measures that. This asks whether a
 * player holding one stick can pitch, roll, brake and recover without ever
 * naming a panel.
 *
 * It measures the angular rate *while the stick is held*, in the car's own
 * frame, rather than the facet that comes out at the end. Once a car has
 * tumbled through a large angle its body axes have mixed, so a clean roll
 * input legitimately lands as "a bit of everything" — which is what TWIST is
 * for, and useless as a test of the mapping.
 */
import TUNING from '../src/TUNING.js';
import { Input, NEUTRAL_ACTIONS } from '../src/input/input.js';
import { Sim } from '../src/sim/sim.js';
import { qInvRot } from '../src/sim/mathx.js';

const DT = 1 / TUNING.SIM.HZ;
const input = new Input({ addEventListener() {} });

/** Hold a stick position for `hold` seconds after launch and watch the rates. */
async function fly({ x = 0, y = 0, brake = false, hold = 0.6, spin = null, label }) {
  const sim = await Sim.create();
  sim.run.begin();
  let t = 0, lt = null, res = null, maxTilt = 0, n = 0;
  const rate = { pitch: 0, yaw: 0, roll: 0 };

  for (let i = 0; i < Math.round(16 / DT) && !res; i++) {
    const air = sim.airborne && lt !== null;
    const u = air ? t - lt : 0;
    const a = { ...NEUTRAL_ACTIONS, throttle: 1, boost: t < 4.6 };
    if (air) {
      const on = u >= 0.25 && u < 0.25 + hold;
      a.stickX = on ? x : 0;
      a.stickY = on ? y : 0;
      input._flyStick(a, on && brake);
      if (on) {
        const w = qInvRot(sim.car.rotation, sim.car.angvel);
        rate.pitch += w.x; rate.yaw += w.y; rate.roll += -w.z;
        n++;
      }
    }
    sim.step(DT, a, {}); t += DT;
    if (air && spin && Math.abs(u - 0.24) < DT) sim.car.body.setAngvel(spin, true);
    if (lt !== null) maxTilt = Math.max(maxTilt, sim.car.tiltAngle * 180 / Math.PI);
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'launch' && ev.launch.armed && lt === null) { lt = t; maxTilt = 0; }
      if (ev.type === 'landed' && ev.result && ev.result.airtime > 1.0) res = ev.result;
    }
  }
  const k = 1 / Math.max(1, n);
  const out = { pitch: rate.pitch * k, yaw: rate.yaw * k, roll: rate.roll * k, maxTilt, res };
  const f = (v) => ((v >= 0 ? '+' : '') + v.toFixed(2)).padStart(6);
  console.log(`${label.padEnd(22)} pitch ${f(out.pitch)}  roll ${f(out.roll)}  yaw ${f(out.yaw)}   ` +
    `peak tilt ${maxTilt.toFixed(0).padStart(3)}  ${res ? `${res.quality} · ${res.facetCount} facets` : 'no landing'}`);
  return out;
}

console.log('── mean angular rate while the stick is held, car frame (rad/s) ──\n');
const off = await fly({ label: 'hands off' });
const right = await fly({ x: 1, label: 'stick right' });
const left = await fly({ x: -1, label: 'stick left' });
const up = await fly({ y: 1, label: 'stick up' });
const down = await fly({ y: -1, label: 'stick down' });
const half = await fly({ x: 0.4, label: 'stick right, half' });

console.log('\n── the brake, against a deliberate 5 rad/s tumble ──\n');
const spin = { x: 3.5, y: 0, z: 3.5 };
const free = await fly({ label: 'tumbling, no brake', spin, hold: 1.6 });
const held = await fly({ brake: true, label: 'tumbling, brake held', spin, hold: 1.6 });

const rollsRight = right.roll > 1.0;
const rollsLeft = left.roll < -1.0;
const pitchesUp = up.pitch > 1.0;
const pitchesDown = down.pitch < -1.0;
const analog = Math.abs(half.roll) < Math.abs(right.roll) * 0.85;
// Total rotation rate, not peak tilt: a braked car rotates slower but stays up
// longer, so it can still end further over while plainly being calmer.
const mag = (r) => Math.hypot(r.pitch, r.yaw, r.roll);
const settles = mag(held) < mag(free) * 0.7;
const landsOff = off.res && off.res.landed;

console.log(`\nroll follows the stick:  ${rollsRight && rollsLeft ? 'yes' : 'no'}`);
console.log(`pitch follows the stick: ${pitchesUp && pitchesDown ? 'yes' : 'no'}`);
console.log(`it is analog:            ${analog ? 'yes' : 'no'} (half stick rolls ${(half.roll / right.roll * 100).toFixed(0)}% as hard)`);
console.log(`brake settles a tumble:  ${settles ? 'yes' : 'no'} ` +
  `(${mag(free).toFixed(2)} -> ${mag(held).toFixed(2)} rad/s, ` +
  `${((1 - mag(held) / mag(free)) * 100).toFixed(0)}% calmer; ` +
  `${free.res ? free.res.quality : 'none'} -> ${held.res ? held.res.quality : 'none'})`);
console.log(`hands off still lands:   ${landsOff ? off.res.quality : 'no'}`);

const ok = rollsRight && rollsLeft && pitchesUp && pitchesDown && analog && settles && landsOff;
console.log(ok ? '\nPASS  the car flies from the stick' : '\nFAIL');
process.exit(ok ? 0 : 1);
