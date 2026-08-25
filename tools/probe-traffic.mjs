/** §4 boost economy: does weaving through traffic actually pay? */
import { Sim } from '../src/sim/sim.js';
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';

const DT = 1 / TUNING.SIM.HZ;

async function run(mode, laneX) {
  TUNING.TRAFFIC.MODE = mode;
  const sim = await Sim.create();
  sim.run.begin();
  sim.boost.value = 0;                       // start empty: measure the earn
  // Park the car in (or beside) a traffic lane and hold it there — this
  // measures the near-miss economy, not the player's steering.
  sim.placeCar({ x: laneX, y: 1.08, z: 232 }, 0);
  let t = 0, honks = 0, oncomingTime = 0, peak = 0, minDist = 1e9, topSpeed = 0, passes = 0;
  for (let i = 0; i < Math.round(9 / DT); i++) {
    const err = laneX - sim.car.position.x;
    const a = { ...NEUTRAL_ACTIONS, throttle: 1, steer: Math.max(-1, Math.min(1, err * 0.35)) };
    sim.step(DT, a, {});
    t += DT;
    peak = Math.max(peak, sim.boost.value);
    topSpeed = Math.max(topSpeed, sim.car.groundSpeed);
    const p = sim.car.position;
    for (const c of sim.traffic.cars) {
      const d = Math.hypot(p.x - (c.x || 0), p.z - (c.z || 0));
      if (d < minDist) minDist = d;
      if (d < 12) passes++;
    }
    if (sim.p0.oncoming) oncomingTime += DT;
    for (const e of sim.drainEvents()) if (e.type === 'honk') honks++;
  }
  return { near: sim.traffic.nearMisses, boost: sim.boost.value, peak, honks,
           oncomingTime, earned: sim.boost.earnedThisRun, minDist, topSpeed,
           passes, finalZ: sim.car.position.z };
}

console.log('mode      line               | near  oncoming  earned  honks | minDist  topSpd  close  endZ');
const rows = {};
for (const [mode, label, x] of [
  ['reactive', 'clean centre line ', 0],
  ['reactive', 'with-traffic lane ', -13],
  ['reactive', 'alongside it      ', -10],
  ['reactive', 'oncoming lane     ', 13],
  ['ambient',  'with-traffic lane ', -13],
  ['ambient',  'oncoming lane     ', 13],
]) {
  const r = await run(mode, x);
  rows[`${mode}:${x}`] = r;
  console.log(`${mode.padEnd(9)} ${label} | ${String(r.near).padStart(4)}  ${r.oncomingTime.toFixed(1).padStart(7)}s  ${r.earned.toFixed(2).padStart(6)}  ${String(r.honks).padStart(5)} | ${r.minDist.toFixed(1).padStart(7)}  ${r.topSpeed.toFixed(0).padStart(6)}  ${String(r.passes).padStart(5)}  ${r.finalZ.toFixed(0).padStart(4)}`);
}
const centre = rows['reactive:0'], lane = rows['reactive:-13'], onc = rows['reactive:13'];
// §4's claim is that *near-miss and the oncoming lane* pay, not that any lane
// beats a clear road: the yard's approach straight is exactly where you hold
// top speed, so driving it cleanly earns the speed bonus and driving among
// traffic costs you speed. The trade is risk for fill rate.
const ok = onc.earned > centre.earned * 1.5
  && onc.oncomingTime > 2.0
  && (lane.near + onc.near + rows['ambient:13'].near) > 0;
console.log(`\noncoming fills the bar ${(onc.earned / Math.max(0.01, centre.earned)).toFixed(1)}x faster than the clear line`);
console.log(ok
  ? 'PASS  risk pays: oncoming and near-miss fill the bar (§4)'
  : 'FAIL  traffic does not pay');
process.exit(ok ? 0 : 1);
