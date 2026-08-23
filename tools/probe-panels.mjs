/** Where each panel physically ends up when deployed, and which way it faces. */
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { Sim } from '../src/sim/sim.js';
import { qInvRot, sub, qRot, v3 } from '../src/sim/mathx.js';
import { plateAreas } from '../src/sim/aero.js';

const DT = 1 / TUNING.SIM.HZ;
const AX = [v3(1,0,0), v3(0,1,0), v3(0,0,1)];

const sim = await Sim.create();
const b = sim.car.body;
b.setTranslation({ x: 0, y: 260, z: 0 }, true);
b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
b.setLinvel({ x: 0, y: 0, z: -45 }, true);
b.setAngvel(v3(), true);
sim.panels.syncToChassis();

const act = { ...NEUTRAL_ACTIONS, doorL: 1, doorR: 1, hood: 1, trunk: 1, spoiler: 1 };
for (let i = 0; i < Math.round(0.5 / DT); i++) sim.step(DT, act, {});

const com = b.worldCom();
const carRot = sim.car.rotation;
console.log('panel     centre rel. COM (x,y,z)      plate normal (x,y,z)   force dir @45m/s   tau_x  tau_y  tau_z');
for (const p of sim.panels.list) {
  const wp = p.body.translation();
  const r = qInvRot(carRot, sub(wp, com));
  const n = qInvRot(carRot, qRot(p.body.rotation(), AX[plateAreas(p.cfg.size).axis]));
  // relative wind is -Z in car frame at this attitude
  const v = { x: 0, y: 0, z: -45 };
  const vn = n.x * v.x + n.y * v.y + n.z * v.z;
  const s = -Math.abs(vn) * vn;                    // sign of the force along n
  const f = { x: n.x * s, y: n.y * s, z: n.z * s };
  const m = Math.hypot(f.x, f.y, f.z) || 1;
  const fd = { x: f.x / m, y: f.y / m, z: f.z / m };
  const tx = r.y * fd.z - r.z * fd.y;
  const ty = r.z * fd.x - r.x * fd.z;
  const tz = r.x * fd.y - r.y * fd.x;
  const fmt = (o) => `(${o.x.toFixed(2).padStart(5)},${o.y.toFixed(2).padStart(5)},${o.z.toFixed(2).padStart(5)})`;
  console.log(`${p.slot.padEnd(8)} ${fmt(r)}  ${fmt(n)}  ${fmt(fd)}  ${tx.toFixed(2).padStart(6)} ${ty.toFixed(2).padStart(6)} ${tz.toFixed(2).padStart(6)}`);
}
console.log('\ntau_x + = nose UP,  tau_y + = nose LEFT,  tau_z + = roll LEFT (right side up)');
