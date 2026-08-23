/** Are the panels actually reaching their commanded angle inside the probe rig? */
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { Sim } from '../src/sim/sim.js';
import { qInvRot, sub, qRot, v3, len } from '../src/sim/mathx.js';
import { plateAreas } from '../src/sim/aero.js';
const DT = 1 / TUNING.SIM.HZ;
const AOA = 0.35;
const LEVEL = { x: Math.sin(AOA/2), y: 0, z: 0, w: Math.cos(AOA/2) };
TUNING.AERO.APPLY_TO = 'chassis';
const AX = [v3(1,0,0), v3(0,1,0), v3(0,0,1)];

const sim = await Sim.create();
const b = sim.car.body;
const act = { ...NEUTRAL_ACTIONS, doorL: 1, doorR: 1, hood: 1, trunk: 1, spoiler: 1 };
const hold = () => {
  b.setTranslation({x:0,y:260,z:0}, true); b.setRotation(LEVEL, true);
  b.setLinvel({x:0,y:0,z:-45}, true); b.setAngvel(v3(), true);
};
hold(); sim.panels.syncToChassis();
for (let i = 0; i < Math.round(0.6/DT); i++) { hold(); sim.step(DT, act, {}); }

const com = b.worldCom();
console.log('every aero force applied this step (car-local frame):');
console.log('  point rel COM              force N                    |F|');
for (const e of sim.aero.applied) {
  const r = qInvRot(LEVEL, sub(e.point, com));
  const f = qInvRot(LEVEL, e.force);
  console.log(`  (${r.x.toFixed(2).padStart(5)},${r.y.toFixed(2).padStart(5)},${r.z.toFixed(2).padStart(5)})   (${f.x.toFixed(0).padStart(6)},${f.y.toFixed(0).padStart(6)},${f.z.toFixed(0).padStart(6)})   ${len(e.force).toFixed(0).padStart(6)}`);
}
console.log('\npanel hinge state:');
for (const p of sim.panels.list) {
  const r = qInvRot(LEVEL, sub(p.body.translation(), com));
  const n = qInvRot(LEVEL, qRot(p.body.rotation(), AX[plateAreas(p.cfg.size).axis]));
  console.log(`  ${p.slot.padEnd(8)} deploy=${p.deploy.toFixed(2)} centre (${r.x.toFixed(2).padStart(5)},${r.y.toFixed(2).padStart(5)},${r.z.toFixed(2).padStart(5)}) normal (${n.x.toFixed(2).padStart(5)},${n.y.toFixed(2).padStart(5)},${n.z.toFixed(2).padStart(5)})`);
}
