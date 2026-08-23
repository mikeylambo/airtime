/**
 * Physics — Rapier world bootstrap and collision layers.
 *
 * Nothing in src/sim imports three.js. The whole simulation runs headless in
 * node, which is what makes `npm run gate:a` a real check and what will make
 * the state-based replay of §6.1 possible without a renderer.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import TUNING from '../TUNING.js';

let ready = false;

export async function initRapier() {
  if (!ready) { await RAPIER.init(); ready = true; }
  return RAPIER;
}

// ── Interaction groups ─────────────────────────────────────────────────────
// upper 16 bits = membership, lower 16 = which memberships we collide with.
export const LAYER = { WORLD: 0x0001, CAR: 0x0002, PANEL: 0x0004, TRIGGER: 0x0008 };
export const groups = (membership, filter) => ((membership << 16) | filter) >>> 0;

export const GROUP_WORLD  = groups(LAYER.WORLD, LAYER.CAR | LAYER.PANEL);
export const GROUP_CAR    = groups(LAYER.CAR,   LAYER.WORLD);
export const GROUP_PANEL  = groups(LAYER.PANEL, LAYER.WORLD);
// Wheel ray-casts should see the world and nothing else — not the car's own
// chassis, and definitely not its flapping doors.
export const WHEEL_RAY_GROUPS = groups(LAYER.CAR, LAYER.WORLD);

export function createWorld() {
  const world = new RAPIER.World({ x: 0, y: TUNING.SIM.GRAVITY, z: 0 });
  world.integrationParameters.dt = 1 / TUNING.SIM.HZ;
  if ('numSolverIterations' in world.integrationParameters) {
    world.integrationParameters.numSolverIterations = TUNING.SIM.SOLVER_ITERATIONS;
  }
  return world;
}

export { RAPIER };
