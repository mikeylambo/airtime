/**
 * A scripted driver for the Gate B capture — the whole loop, not one jump.
 *
 * It holds whatever heading it was put on rather than picking targets. A
 * driver that chose "the nearest ramp ahead" sawed at the wheel, scrubbed
 * itself to a standstill, changed its mind every few seconds and eventually
 * drove off the edge of the deck — and produced a run so chaotic that any
 * small change to the simulation sent it somewhere completely different, which
 * makes it useless as something to measure against.
 *
 * Deterministic, like the demo jump: same inputs, same run, every time. The
 * same script drives tools/probe-run.mjs headlessly.
 *
 * It is a weak proxy for a player — it lands what it launches but only finds a
 * handful of ramps in a round — so it is a smoke test that the loop runs end to
 * end, not a benchmark of what the mode is worth in someone's hands.
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function loopActions(t, neutral, ctx) {
  const a = { ...neutral, throttle: 1 };
  const { airborne, launchT, boost, car, park } = ctx;
  const u = airborne && launchT !== null ? t - launchT : 0;

  if (airborne) {
    // Taps, not holds — a part held through a whole flight ends it on its roof.
    if (u > 0.30 && u < 0.62) a.doorL = 1;
    if (u > 1.05 && u < 1.34) a.doorR = 1;
    if (u > 1.34) a.spoiler = 1;
    ctx.wasAir = true;
    return a;
  }

  a.boost = boost > 0.22;
  if (!car) return a;

  // Hold the heading the car was put on.
  //
  // Recovery already places you on the approach to a ramp, pointed at it, and
  // the spawn faces down the hero straight — so "keep going the way you were
  // pointed" chains ramp, landing, recovery, ramp without the driver having to
  // choose anything. Choosing was what made it saw at the wheel, scrub itself
  // to a standstill and drive off the deck.
  const heading = Math.atan2(car.forward.x, car.forward.z);
  const speed = car.groundSpeed;
  if (speed < 6 || ctx.hold === undefined) ctx.hold = heading;

  // Turn around once the line has run out. Holding a heading forever means
  // one jump and then eighty seconds of driving away from the park.
  if (park) {
    const home = park.ramps.find((r) => r.id === 'hero') || park.ramps.find((r) => r.id !== 'garage');
    if (home) {
      const hx = home.pos.x - car.position.x, hz = home.pos.z - car.position.z;
      const hd = Math.hypot(hx, hz) || 1;
      const facing = (hx * car.forward.x + hz * car.forward.z) / hd;
      // Far away and pointed the wrong way: line up on the ramp again.
      if (hd > 110 && facing < 0.25) ctx.hold = Math.atan2(hx, hz);
    }
  }

  // Sway across the traffic lanes for near-miss boost (§4), gently.
  const target = ctx.hold + Math.sin(t * 0.45) * 0.11;
  let err = target - heading;
  while (err > Math.PI) err -= Math.PI * 2;
  while (err < -Math.PI) err += Math.PI * 2;

  // Facing the wrong way entirely: take the new heading as the line rather
  // than fighting it. At an error near 180 degrees the sign of the correction
  // flips every frame, the wheel chatters between full lock either way, and
  // the car simply drives straight out of the arena — which is exactly what it
  // did, every run, from a 0.15 rad drift the gain then overcorrected into a
  // spin.
  if (Math.abs(err) > 2.4) { ctx.hold = heading; err = 0; }

  a.steer = clamp(err * 0.9, -1, 1) * clamp(speed / 14, 0.2, 1);
  ctx.wasAir = false;
  return a;
}

export function loopEdges(t, dt, ctx) {
  const u = ctx.airborne && ctx.launchT !== null ? t - ctx.launchT : 0;
  if (u > 1.9 && !ctx.thrusted) { ctx.thrusted = true; return { thrust: true }; }
  return {};
}

/** Set from tools/probe-run.mjs once the run is measured. */
export const LOOP_CLIP = { start: 2.0, seconds: 20 };
