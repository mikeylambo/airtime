/**
 * Ghosts (R9).
 *
 * "A ghost is a replay we do not draw the HUD for." That was folklore until
 * §R measured it: a clip is inputs plus a seed, and re-simulating one
 * reproduces its run to 0.0 m, bit for bit (`npm run probe:replay`). So a
 * ghost costs no new simulation architecture at all — it is the replay
 * theater, running beside you instead of instead of you.
 *
 * **It does not share your world.** A ghost that were a second body in the
 * live sim would be shoved by you, would shove you, and would perturb the
 * traffic you are both driving through — and the moment it is touched it
 * stops being the run it recorded. So a ghost is *baked*: the clip is
 * re-simulated once, in its own world, and what is kept is the trajectory.
 * After that it is eight floats a step and no physics at all, which is also
 * why racing one costs nothing on a machine with no GPU.
 *
 * Baking is the expensive moment — a ninety second run is 5,400 steps of real
 * solver — so it happens when a ghost is *chosen*, never at the start of a
 * run. R4's budget is one input and 1.20 s between "that run ended" and "I am
 * driving", and it is not negotiable.
 *
 * The eighth float is the score. A ghost that is only a shape is scenery; a
 * ghost that carries what it had banked by this moment is an opponent, and
 * "+2,400" against a car you can see is the whole of the retention loop.
 */

import TUNING from '../TUNING.js';
import { Sim } from '../sim/sim.js';
import { Player } from '../sim/replay.js';
import { resolveSetup } from '../sim/cars.js';
import { simCurrent, simVersion } from '../sim/version.js';
import { Storage } from '../storage/storage.js';

/** x y z qx qy qz qw score — the whole of a ghost, per step. */
export const STRIDE = 8;

const DT = 1 / TUNING.SIM.HZ;
const key = (slot) => `ghosts:${slot}`;
export const ghostKey = (arena, mode) => `${arena}:${mode}`;

/**
 * A finished run, as a ghost record: the *whole* stream rather than a clip's
 * window, because a ghost has to be beside you for the entire round.
 */
export function ghostFromRun(recorder, summary, focus = 0) {
  const clip = recorder.clip(0, recorder.step, {
    total: summary.score, ghost: true,
  }, focus);
  return {
    id: `ghost_${clip.meta.created}_${focus}`,
    name: summary.name || 'YOU',
    score: summary.score,
    medal: summary.medal || null,
    arena: clip.meta.arena,
    mode: clip.meta.mode,
    car: clip.meta.car,
    created: clip.meta.created,
    sim: clip.meta.sim,
    clip,
  };
}

/**
 * Re-simulate a ghost record into a trajectory.
 *
 * @param onProgress 0..1, called between chunks
 * @param yieldEvery steps between yields to the event loop. Baking is a few
 *        thousand solver steps; doing them in one go freezes the frame that
 *        asked for it, which is exactly the kind of hitch this game has spent
 *        four builds refusing to ship.
 */
export async function bakeGhost(record, { onProgress = null, yieldEvery = 300 } = {}) {
  const clip = record.clip;
  const meta = clip.meta;
  const setup = resolveSetup({
    car: meta.car, livery: meta.livery,
    tune: meta.tune || { weight: .5, suspension: .5, thrust: .5, aero: .5 },
    parts: meta.parts || {},
  });
  const players = meta.players || 1;
  const focus = clip.focus || 0;

  const sim = await Sim.create(setup, meta.arena, { players, mode: meta.mode || 'stunt' });
  // The sim reads the traffic option live (§R), so a bake pins it to what the
  // recording saw and puts the player's choice back afterwards.
  const before = TUNING.TRAFFIC.MODE;
  TUNING.TRAFFIC.MODE = meta.traffic || before;
  try {
    sim.replayStart(meta);
    const player = new Player(clip);
    const steps = clip.end;
    const frames = new Float32Array(steps * STRIDE);
    let n = 0;
    while (!player.done && n < steps) {
      const { actions, edges } = player.next();
      sim.step(DT, actions, edges);
      sim.drainEvents();
      const car = sim.players[focus].car;
      const p = car.position, q = car.rotation;
      const o = n * STRIDE;
      frames[o] = p.x; frames[o + 1] = p.y; frames[o + 2] = p.z;
      frames[o + 3] = q.x; frames[o + 4] = q.y; frames[o + 5] = q.z; frames[o + 6] = q.w;
      frames[o + 7] = sim.players[focus].run.score;
      n++;
      if (yieldEvery && n % yieldEvery === 0) {
        if (onProgress) onProgress(n / steps);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    if (onProgress) onProgress(1);
    // The ghost is drawn as its own car's silhouette, not as yours — which is
    // the entire content of the "beat a ghost set in a different car"
    // challenge, and would be a lie if the shape came from the live setup.
    return new Ghost(record, frames, n, { half: setup.half, wheel: setup.wheel });
  } finally {
    TUNING.TRAFFIC.MODE = before;
  }
}

/** A baked ghost: a trajectory, a score curve, and nothing else. */
export class Ghost {
  constructor(record, frames, steps, shape = {}) {
    this.record = record;
    this.frames = frames;
    this.steps = steps;
    this.half = shape.half || null;
    this.wheel = shape.wheel || null;
    this.hz = record.clip.meta.hz || TUNING.SIM.HZ;
  }

  get name() { return this.record.name; }
  get score() { return this.record.score; }
  get car() { return this.record.car; }
  get seconds() { return this.steps / this.hz; }

  /**
   * The pose at a wall-clock time into the round, interpolated.
   *
   * A ghost runs at the simulation's rate and is *drawn* at the display's, so
   * without the interpolation it judders visibly at any refresh that is not
   * an exact multiple of 60 — which on the target hardware is most of them.
   */
  at(t, out = {}) {
    const s = Math.max(0, Math.min(this.steps - 1, t * this.hz));
    const i = Math.floor(s);
    const j = Math.min(this.steps - 1, i + 1);
    const u = s - i;
    const a = i * STRIDE, b = j * STRIDE;
    const f = this.frames;
    out.x = f[a] + (f[b] - f[a]) * u;
    out.y = f[a + 1] + (f[b + 1] - f[a + 1]) * u;
    out.z = f[a + 2] + (f[b + 2] - f[a + 2]) * u;
    // Nearest-neighbour on the quaternion, deliberately: a car mid-flip can
    // cover more than 180 degrees between two samples, and lerping across
    // that draws the car snapping the short way round a rotation it did not
    // make. At 60 Hz the nearest sample is never more than 8 ms stale.
    const k = (u < 0.5 ? i : j) * STRIDE;
    out.qx = f[k + 3]; out.qy = f[k + 4]; out.qz = f[k + 5]; out.qw = f[k + 6];
    out.score = f[a + 7];
    out.done = t * this.hz >= this.steps - 1;
    return out;
  }

  /** What the ghost had banked by this moment — the number the HUD shows. */
  scoreAt(t) {
    const i = Math.max(0, Math.min(this.steps - 1, Math.floor(t * this.hz)));
    return this.frames[i * STRIDE + 7];
  }
}

// ── Storage ────────────────────────────────────────────────────────────────
// One personal best per arena and mode. A ghost is a clip, so the library
// costs a few KB per entry and lives in localStorage next to the others.

export function loadGhosts(slot) {
  const all = Storage.read(key(slot), {});
  return all && typeof all === 'object' ? all : {};
}

/**
 * Keep a ghost only if it beats the one already there.
 * @returns the stored ghost for that key, whether or not it changed
 */
export function saveGhost(slot, record) {
  const all = loadGhosts(slot);
  const k = ghostKey(record.arena, record.mode);
  const prev = all[k];
  // §R: a ghost from a different physics build is not a target, it is a
  // different game. It is replaced rather than defended.
  if (!prev || !simCurrent(prev) || record.score > prev.score) {
    all[k] = record;
    Storage.write(key(slot), all);
  }
  return all[k];
}

/** The ghost to race here, or null if there is nothing to race. */
export function bestGhost(slot, arena, mode) {
  const g = loadGhosts(slot)[ghostKey(arena, mode)];
  return g && simCurrent(g) ? g : null;
}

/** Every ghost this profile could race, newest-strongest first. */
export function listGhosts(slot) {
  return Object.values(loadGhosts(slot))
    .filter(simCurrent)
    .sort((a, b) => b.score - a.score);
}

export function deleteGhost(slot, arena, mode) {
  const all = loadGhosts(slot);
  delete all[ghostKey(arena, mode)];
  Storage.write(key(slot), all);
  return all;
}

/**
 * Ghosts orphaned by a physics change, for the screen that has to explain why
 * a personal best vanished. §R's whole point is that this is knowable rather
 * than mysterious.
 */
export function staleGhosts(slot) {
  const now = simVersion();
  return Object.values(loadGhosts(slot)).filter((g) => g.sim !== now);
}
