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
    // Shorter taps than Build 2 used. Every car now carries its own centre of
    // pressure, and VECTOR's trims nose-up where the old shared one did not,
    // so the same hold that used to produce a tidy roll-and-catch now puts the
    // car past vertical and lands it on its roof.
    if (u > 0.30 && u < 0.52) a.doorL = 1;
    if (u > 0.95 && u < 1.15) a.doorR = 1;
    if (u > 1.30) a.spoiler = 1;
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

  // Where to point. This driver is a smoke test, not an AI: its job is to
  // produce the same loop every run so the probes measure the game rather than
  // the driver. So the rule is deliberately dumb — line up on the hero ramp
  // whenever you are not already on its approach, and hold whatever heading
  // the landing left you with while you are close to it.
  //
  // Two cleverer versions failed here. Re-aiming only when far from the ramp
  // *and* pointed away from it is a condition a car circling a ring park never
  // meets, so it drove into the perimeter and stopped. Aiming at the middle of
  // the yard whenever heading outward turned it around on the spawn straight,
  // which points at the middle already.
  if (park) {
    const home = park.ramps.find((h) => h.id === 'hero');
    if (home) {
      const hx = home.pos.x - car.position.x, hz = home.pos.z - car.position.z;
      if (Math.hypot(hx, hz) > 60) ctx.hold = Math.atan2(hx, hz);
    }
  }

  // Sway across the traffic lanes for near-miss boost (§4), gently — and only
  // once the car is actually inside the yard. On the spawn straight the sway
  // was enough to walk it 30 m sideways into the corner of a perimeter bank,
  // and a scripted driver that cannot reliably reach the first ramp measures
  // nothing.
  const inside = Math.hypot(car.position.x, car.position.z) < 150;
  const target = ctx.hold + (inside ? Math.sin(t * 0.45) * 0.11 : 0);
  let err = target - heading;
  while (err > Math.PI) err -= Math.PI * 2;
  while (err < -Math.PI) err += Math.PI * 2;

  // Facing the wrong way entirely: commit to a U-turn in one direction.
  //
  // Near 180 degrees the sign of the correction flips every frame, the wheel
  // chatters between full lock either way, and the car drives straight out of
  // the arena. The first fix for that was to surrender — adopt the current
  // heading as the line — which works only while nothing else is choosing the
  // line. Once the driver aims at a ramp, surrendering means it can never
  // execute a turn bigger than 137 degrees: the aim sets the target, the guard
  // throws it away, and the car drives off in whatever direction it was left
  // pointing. That is precisely what it did. So latch a direction instead and
  // hold it until the turn is most of the way done.
  if (Math.abs(err) > 2.4) ctx.turning = ctx.turning || (err > 0 ? 1 : -1);
  else if (Math.abs(err) < 1.6) ctx.turning = 0;

  a.steer = ctx.turning
    ? ctx.turning * clamp(speed / 14, 0.35, 1)
    : clamp(err * 0.55, -0.6, 0.6) * clamp(speed / 14, 0.2, 1);
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
