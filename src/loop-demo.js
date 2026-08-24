/**
 * A scripted driver for the Gate B capture — the whole loop, not one jump.
 *
 * Drive, weave the lanes for near-miss boost, hit ramps, flick parts in the
 * air, land, chain. Deterministic like the demo jump: same inputs, same run,
 * every time. The same script is what tools/probe-run.mjs drives headlessly.
 */

export function loopActions(t, neutral, ctx) {
  const a = { ...neutral, throttle: 1 };
  const { airborne, launchT, boost } = ctx;
  const u = airborne && launchT !== null ? t - launchT : 0;

  if (airborne) {
    // Taps, not holds — a part held through a whole flight ends it on its roof.
    if (u > 0.30 && u < 0.62) a.doorL = 1;
    if (u > 1.05 && u < 1.34) a.doorR = 1;
    if (u > 1.34) a.spoiler = 1;
  } else {
    a.boost = boost > 0.25;
    // Weave out to the traffic lanes and back across the ramp line (§4).
    // The amplitude matters more than it looks: a gentle weave stays on the
    // clean centre line, earns no near-miss boost, and crosses almost no ramps.
    a.steer = Math.sin(t * 0.9) * 0.5;
  }
  return a;
}

export function loopEdges(t, dt, ctx) {
  const u = ctx.airborne && ctx.launchT !== null ? t - ctx.launchT : 0;
  if (u > 1.9 && !ctx.thrusted) { ctx.thrusted = true; return { thrust: true }; }
  return {};
}

/**
 * The window worth watching, found with tools/probe-run.mjs: five landings in
 * twenty seconds, including a rooftop stick and a 360, with the chain building.
 */
export const LOOP_CLIP = { start: 40.0, seconds: 20 };
