/**
 * Searches panel geometry for the configuration that makes §5.1 true:
 * hood pitches back, trunk pitches forward, one door rolls, both brake.
 */
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { Sim } from '../src/sim/sim.js';
import { qInvRot, sub, cross, v3 } from '../src/sim/mathx.js';

const DT = 1 / TUNING.SIM.HZ;
const LEVEL = { x: 0, y: 0, z: 0, w: 1 };
TUNING.AERO.APPLY_TO = 'chassis';

async function probe(actions) {
  const sim = await Sim.create();
  const b = sim.car.body;
  const act = { ...NEUTRAL_ACTIONS, ...actions };
  const hold = () => {
    b.setTranslation({ x: 0, y: 260, z: 0 }, true);
    b.setRotation(LEVEL, true);
    b.setLinvel({ x: 0, y: 0, z: -45 }, true);
    b.setAngvel(v3(), true);
  };
  hold(); sim.panels.syncToChassis();
  for (let i = 0; i < Math.round(0.6 / DT); i++) { hold(); sim.step(DT, act, {}); }
  let F = v3(), T = v3(), n = 0;
  for (let i = 0; i < Math.round(0.3 / DT); i++) {
    hold(); sim.step(DT, act, {});
    const com = b.worldCom();
    for (const e of sim.aero.applied) {
      if (e.body.handle !== b.handle) continue;
      F = { x: F.x + e.force.x, y: F.y + e.force.y, z: F.z + e.force.z };
      const t = cross(sub(e.point, com), e.force);
      T = { x: T.x + t.x, y: T.y + t.y, z: T.z + t.z };
    }
    n++;
  }
  const k = 1 / Math.max(1, n);
  return { drag: F.z * k / 1000, pitch: T.x * k / 1000, yaw: T.y * k / 1000, roll: -T.z * k / 1000 };
}

const P = TUNING.PANELS;
const d = (v) => ((v >= 0 ? '+' : '') + v.toFixed(1)).padStart(6);

// ── 1. Global panel gain: size the hood's pitch authority sensibly ─────────
// Pitch inertia of the chassis, so torque can be read as rad/s^2.
const C = TUNING.CAR;
const Ix = (C.MASS / 3) * (C.HALF.y ** 2 + C.HALF.z ** 2) * C.INERTIA_SCALE.x;
console.log(`chassis pitch inertia ${Ix.toFixed(0)} kg·m²  (torque/Ix = rad/s²)\n`);
console.log('PANEL_SCALE | hood pitch kN·m  -> rad/s²');
for (const g of [1.6, 2.3, 3.0, 4.0, 5.4]) {
  TUNING.AERO.PANEL_SCALE = g;
  const base = await probe({});
  const h = await probe({ hood: 1 });
  const t = h.pitch - base.pitch;
  console.log(`${String(g).padStart(11)} | ${d(t)}          ${(t * 1000 / Ix).toFixed(2)}`);
}

TUNING.AERO.PANEL_SCALE = 2.3;
const base = await probe({});

// ── 2. Trunk open angle: find where it flips to nose-down ──────────────────
console.log('\ntrunk open (rad) | pitch kN·m  (want negative = nose down)   drag');
for (const o of [0.72, 0.58, 0.46, 0.36, 0.28]) {
  P.TRUNK.open = o; P.TRUNK.limitMax = o + 0.1;
  const r = await probe({ trunk: 1 });
  console.log(`${String(o).padStart(16)} | ${d(r.pitch - base.pitch)}                              ${d(r.drag - base.drag)}`);
}

// ── 3. Door hinge dihedral: trade yaw for roll ─────────────────────────────
console.log('\ndoor tilt | one door: roll   yaw   | both doors: drag (air brake)');
for (const tilt of [0.0, 0.55, 1.0, 1.5, 2.2, 3.2]) {
  P.DOOR_L.axis = { x: -tilt, y: 1, z: 0 };
  P.DOOR_R.axis = { x: tilt, y: 1, z: 0 };
  const one = await probe({ doorL: 1 });
  const both = await probe({ doorL: 1, doorR: 1 });
  console.log(`${String(tilt).padStart(9)} | ${d(one.roll - base.roll)} ${d(one.yaw - base.yaw)}   | ${d(both.drag - base.drag)}`);
}

// ── 4. Spoiler open angle: keep it a stabiliser, not a pitch lever ─────────
console.log('\nspoiler open | pitch kN·m (want small)   drag');
for (const o of [-1.05, -1.25, -1.40, -1.52]) {
  P.SPOILER.open = o; P.SPOILER.limitMin = o - 0.1;
  const r = await probe({ spoiler: 1 });
  console.log(`${String(o).padStart(12)} | ${d(r.pitch - base.pitch)}                  ${d(r.drag - base.drag)}`);
}
