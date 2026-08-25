/**
 * The Gate A demo jump — a fixed input script, replayed identically every time.
 *
 * The whole point of putting Rapier under this (§1) is determinism: same seed,
 * same fixed timestep, same actions in, same jump out. That is what lets the
 * three camera captures be genuinely the *same* jump shot three ways, and it
 * is the seed of the state-based replay in §6.1 — a saved run is this, with
 * the player's actions in place of a scripted list.
 *
 * The ground phase is on absolute time; everything in the air is relative to
 * the launch event. Absolute air timings are far too brittle — moving the
 * spawn point by seven centimetres shifted the launch by 80 ms and turned a
 * clean landing into a crash.
 */

/** Ground phase: [action, from, to, value] in seconds from the start. */
const GROUND = [
  ['throttle', 0.00, 30.0, 1],
  ['boost', 0.00, 4.60, true],
];

/**
 * Air phase: [action, from, to, value] in seconds *after launch*.
 *
 * Taps, not holds. One door is worth 7.5 rad/s² of roll, so a third of a
 * second of it is most of a barrel roll and holding one through a whole flight
 * ends the run on its roof. These timings were searched by tools/demo-tune.mjs
 * for the showiest flight that still sticks: the car banks to about 40 degrees,
 * rolls back, and lands clean.
 */
const AIR = [
  ['trunk', 0.15, 0.27, 1],      // tail flap: drop the nose off the lip (§5.1)
  ['doorL', 0.45, 0.81, 1],      // one door -> roll (§5.1)
  ['doorR', 1.23, 1.59, 1],      // the other -> roll back
  ['spoiler', 1.59, 4.20, 1],    // wing out to steady the descent
];

/** One-shot presses after launch: [action, at]. */
const AIR_EDGES = [
  ['thrust', 2.20],              // stick neutral at the press -> CORRECT (§5)
];

export function demoActions(t, neutral, launchT = null) {
  const a = { ...neutral };
  for (const [key, from, to, value] of GROUND) {
    if (t >= from && t < to) a[key] = value;
  }
  if (launchT !== null) {
    const u = t - launchT;
    for (const [key, from, to, value] of AIR) {
      if (u >= from && u < to) a[key] = value;
    }
  }
  return a;
}

export function demoEdges(t, dt, launchT = null) {
  const e = {};
  if (launchT === null) return e;
  const u = t - launchT;
  for (const [key, at] of AIR_EDGES) {
    if (u <= at && u + dt > at) e[key] = true;
  }
  return e;
}

/** Capture window for a 10-second clip: approach, launch, flight, landing. */
export const DEMO_CLIP = { start: 1.60, seconds: 10 };
