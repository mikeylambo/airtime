/** §7: do the three archetypes and the four sliders actually fly differently? */
import { Sim } from '../src/sim/sim.js';
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { resolveSetup, CARS, SLIDERS } from '../src/sim/cars.js';

const DT = 1 / TUNING.SIM.HZ;
const base = { livery: 'stock', parts: { doors: 'stock', hood: 'stock', trunk: 'stock', spoiler: 'stock' } };

async function fly(profile, hold = {}) {
  const sim = await Sim.create(resolveSetup(profile));
  sim.run.begin();
  let t = 0, lt = null, res = null, apex = 0, launch = null;
  for (let i = 0; i < Math.round(15 / DT) && !res; i++) {
    const air = sim.airborne && lt !== null;
    const u = air ? t - lt : 0;
    const a = { ...NEUTRAL_ACTIONS, throttle: 1, boost: t < 4.6,
                ...(air && u > 0.25 && u < 1.25 ? hold : {}) };
    sim.step(DT, a, {}); t += DT;
    if (lt !== null) apex = Math.max(apex, sim.car.position.y);
    for (const e of sim.drainEvents()) {
      if (e.type === 'launch' && e.launch.armed && lt === null) { lt = t; launch = e.launch; apex = 0; }
      if (e.type === 'landed' && e.result && e.result.airtime > 1.0) res = e.result;
    }
  }
  return { launch, apex, res };
}

console.log('§7 archetypes — same line, same inputs\n');
console.log('car     launch  apex   air    landing   1.0s door hold ->');
for (const c of CARS) {
  const p = { ...base, car: c.id, tune: { weight: .5, suspension: .5, thrust: .5, aero: .5 } };
  const plain = await fly(p);
  const door = await fly(p, { doorL: 1 });
  const names = door.res ? (door.res.tricks.filter((k) => k.kind !== 'pose').map((k) => k.name).join('+') || '—') : '—';
  console.log(
    `${c.id.padEnd(7)} ${plain.launch.speed.toFixed(1).padStart(5)}  ${plain.apex.toFixed(1).padStart(5)}  ` +
    `${(plain.res ? plain.res.airtime : 0).toFixed(2)}s  ${(plain.res ? plain.res.quality : 'none').padEnd(8)}  ${names}`
  );
}

console.log('\n§7 sliders on VECTOR — each end of each slider\n');
console.log('slider       low end                      high end');
for (const s of SLIDERS) {
  const mk = (v) => ({ ...base, car: 'vector', tune: { weight: .5, suspension: .5, thrust: .5, aero: .5, [s.key]: v } });
  const lo = await fly(mk(0));
  const hi = await fly(mk(1));
  const cell = (r) => `${r.launch.speed.toFixed(1)}m/s apex ${r.apex.toFixed(1)} ${(r.res ? r.res.quality : 'none')}`;
  console.log(`${s.label.padEnd(12)} ${cell(lo).padEnd(28)} ${cell(hi)}`);
}
