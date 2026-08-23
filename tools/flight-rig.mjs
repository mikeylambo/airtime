/**
 * Shared measurement rig: holds the car in a chosen flight state and reports
 * the aerodynamic force and torque reaching the chassis.
 *
 * The whole assembly — chassis and every panel — is moved rigidly, preserving
 * hinge angles. Pinning the chassis alone leaves the panels with no velocity
 * of their own, and every part then measures as generating nothing.
 */
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { Sim } from '../src/sim/sim.js';
import { qInvRot, qRot, qMul, qConj, sub, add, cross, v3 } from '../src/sim/mathx.js';

const DT = 1 / TUNING.SIM.HZ;
export const SPEED = 45;
export const AOA = 0.35;      // the car really flies at ~20 deg incidence
export const ATTITUDE = { x: Math.sin(AOA / 2), y: 0, z: 0, w: Math.cos(AOA / 2) };
const POS = { x: 0, y: 400, z: 0 };
const VEL = { x: 0, y: 0, z: -SPEED };

export function setFlightState(sim, pos, rot, vel) {
  const b = sim.car.body;
  const oldP = b.translation();
  const delta = qMul(rot, qConj(b.rotation()));
  for (const p of sim.panels.list) {
    const rel = sub(p.body.translation(), oldP);
    p.body.setTranslation(add(pos, qRot(delta, rel)), true);
    p.body.setRotation(qMul(delta, p.body.rotation()), true);
    p.body.setLinvel(vel, true);
    p.body.setAngvel(v3(), true);
  }
  b.setTranslation(pos, true);
  b.setRotation(rot, true);
  b.setLinvel(vel, true);
  b.setAngvel(v3(), true);
}

/** @returns {{drag, pitch, yaw, roll}} drag in kN, torques in kN·m, car-local. */
export async function probe(actions = {}, attitude = ATTITUDE) {
  const sim = await Sim.create();
  const b = sim.car.body;
  const act = { ...NEUTRAL_ACTIONS, ...actions };

  setFlightState(sim, POS, attitude, VEL);
  sim.panels.syncToChassis();
  setFlightState(sim, POS, attitude, VEL);
  for (let i = 0; i < Math.round(0.7 / DT); i++) sim.step(DT, act, {});

  let F = v3(), T = v3(), n = 0;
  for (let i = 0; i < 3; i++) {
    setFlightState(sim, POS, attitude, VEL);
    sim.step(DT, act, {});
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
  const Tl = qInvRot(attitude, { x: T.x * k, y: T.y * k, z: T.z * k });
  const Fl = qInvRot(attitude, { x: F.x * k, y: F.y * k, z: F.z * k });
  return { drag: Fl.z / 1000, pitch: Tl.x / 1000, yaw: Tl.y / 1000, roll: -Tl.z / 1000 };
}
