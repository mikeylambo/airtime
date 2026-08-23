/** Door hinge dihedral: trades yaw authority for roll authority (§5.1). */
import TUNING from '../src/TUNING.js';
import { probe } from './flight-rig.mjs';
TUNING.AERO.APPLY_TO = 'chassis';
const P = TUNING.PANELS;
const d = (v) => ((v >= 0 ? '+' : '') + v.toFixed(1)).padStart(6);

console.log('tilt | one door:  roll    yaw   roll/yaw | both doors: drag');
for (const tilt of [0.0, 0.55, 0.9, 1.3, 1.8, 2.5, 3.5]) {
  P.DOOR_L.axis = { x: -tilt, y: 1, z: 0 };
  P.DOOR_R.axis = { x: tilt, y: 1, z: 0 };
  const base = await probe({});
  const one = await probe({ doorL: 1 });
  const both = await probe({ doorL: 1, doorR: 1 });
  const roll = one.roll - base.roll, yaw = one.yaw - base.yaw;
  console.log(`${String(tilt).padStart(4)} | ${d(roll)} ${d(yaw)}   ${(Math.abs(roll / (yaw || 1e-9))).toFixed(2).padStart(6)} | ${d(both.drag - base.drag)}`);
}
