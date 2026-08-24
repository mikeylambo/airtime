/**
 * Can the player actually complete a rotation?
 *
 * §3 promises flips, barrel rolls and spins, and §3.1 prices them — so a
 * reasonable hold on a part has to be able to turn the car all the way over.
 * Chassis angular drag is what fights that, but it is *not* what makes the car
 * land: the weathercock comes from AERO.CHASSIS_COP sitting behind the centre
 * of mass. This sweep separates the two.
 */
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { Sim } from '../src/sim/sim.js';

const DT = 1 / TUNING.SIM.HZ;
const TAU = Math.PI * 2;

async function jump(hold, holdFor) {
  const sim = await Sim.create();
  sim.run.begin();
  let t = 0, lt = null, res = null;
  for (let i = 0; i < Math.round(15 / DT) && !res; i++) {
    const air = sim.airborne && lt !== null;
    const u = air ? t - lt : 0;
    const a = { ...NEUTRAL_ACTIONS, throttle: 1, boost: t < 4.6,
                ...(air && u > 0.25 && u < 0.25 + holdFor ? hold : {}) };
    sim.step(DT, a, {});
    t += DT;
    for (const e of sim.drainEvents()) {
      if (e.type === 'launch' && e.launch.armed && lt === null) lt = t;
      if (e.type === 'landed' && e.result && e.result.airtime > 1.0) res = e.result;
    }
  }
  return res;
}

async function measure() {
  const neutral = await jump({}, 0);
  const flip = await jump({ hood: 1 }, 1.2);
  const roll = await jump({ doorL: 1 }, 1.2);
  const spin = await jump({ doorL: 1, doorR: 1 }, 1.2);
  const named = (r) => (r && r.tricks.filter((k) => k.kind !== 'pose').map((k) => k.name).join('+')) || '—';
  return { neutral, flip, roll, spin, named };
}

// Rotation is fought by two different things and they trade against each
// other: angular drag simply bleeds spin, while the centre of pressure behind
// the centre of mass actively trims the car back to nose-first. The second is
// what lands a neutral jump, so the question is how little of it we can keep.
console.log('COP.z  angDrag | neutral         | 1.2s hood       | 1.2s left door  | 1.2s both doors');
for (const cop of [0.20, 0.35, 0.50, 0.62]) {
  for (const d of [0.30, 0.50, 0.75]) {
    TUNING.AERO.CHASSIS_COP.z = cop;
    TUNING.AERO.CHASSIS_ANG_DRAG = d;
    const m = await measure();
    const cell = (r) => (r ? `${r.quality.slice(0, 5).padEnd(5)} ${m.named(r).slice(0, 9).padEnd(9)}` : 'none          ');
    console.log(`${cop.toFixed(2).padStart(5)} ${d.toFixed(2).padStart(7)} | ${cell(m.neutral)} | ${cell(m.flip)} | ${cell(m.roll)} | ${cell(m.spin)}`);
  }
}
