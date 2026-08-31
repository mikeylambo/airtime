/**
 * Facets — the stunt grammar (R1).
 *
 * The reference's scoring did not ask "what trick was that?". It asked "how
 * many *different things* were true at once?", and then multiplied brutally.
 * That is the difference between a jump that pays 400 and a jump that pays
 * 40,000, and it is what turns a run into a story.
 *
 * So a flight is not reduced to one trick name. It is decomposed into facets —
 * independent, simultaneously-true properties — and the count of them is the
 * multiplier. Doing one thing beautifully is worth a little. Doing seven
 * different things at once and surviving is worth an absurd amount.
 *
 * Every facet is read off physics that already happened. Nothing here is
 * triggered by a button.
 */

import TUNING from '../TUNING.js';

const TAU = Math.PI * 2;

/** Complete turns about one axis, with a little grace so a near-miss pays. */
function turns(rad) {
  return Math.floor((Math.abs(rad) + TUNING.SCORE.ROTATION_GRACE) / TAU);
}

const COUNT_NAME = (n) => ({
  1: '', 2: 'DOUBLE', 3: 'TRIPLE', 4: 'QUAD', 5: 'QUINT',
}[n] || `${n}x`);

/**
 * How hard the count multiplies. The curve is the whole design: flat at the
 * bottom so a single clean trick is not punished, and steep from about four
 * so that stacking is always the strongest thing a player can do.
 */
export function facetMultiplier(n) {
  const T = TUNING.SCORE.FACET_MULT;
  if (n <= 0) return { mult: 1, name: null };
  const i = Math.min(n, T.length) - 1;
  return T[i];
}

/**
 * @param f a flight record (see TrickTracker.snapshot)
 * @returns {{facets, base, mult, multName, purity}}
 */
export function computeFacets(f) {
  const S = TUNING.SCORE;
  const F = S.FACET;
  const out = [];
  const add = (id, label, value, detail) => out.push({ id, label, value: Math.round(value), detail });

  // ── Rotation, per axis ─────────────────────────────────────────────────
  const flips = turns(f.pitch);
  const rolls = turns(f.roll);
  const spins = turns(f.yaw);
  if (flips) add('flip', `${COUNT_NAME(flips)} ${f.pitch > 0 ? 'BACKFLIP' : 'FRONTFLIP'}`.trim(),
    F.FLIP * (1 + S.EXTRA_ROTATION * (flips - 1)), flips);
  if (rolls) add('roll', `${COUNT_NAME(rolls)} BARREL ROLL`.trim(),
    F.ROLL * (1 + S.EXTRA_ROTATION * (rolls - 1)), rolls);
  if (spins) add('spin', `${spins * 360}`,
    F.SPIN * (1 + S.EXTRA_ROTATION * (spins - 1)), spins);

  // Twist is the facet that rewards *mixing* axes rather than stacking one.
  if (f.twistTime >= F.TWIST_TIME) add('twist', 'TWIST', F.TWIST, +f.twistTime.toFixed(2));
  if (f.maxTilt >= F.INVERT_ANGLE) add('invert', 'INVERTED', F.INVERT);

  // ── The shape of the flight ────────────────────────────────────────────
  if (f.airtime >= F.BIG_AIR_TIME) add('air', 'BIG AIR', F.BIG_AIR + (f.airtime - F.BIG_AIR_TIME) * F.BIG_AIR_PER_SEC, +f.airtime.toFixed(2));
  if (f.height >= F.HIGH_M) add('high', 'HIGH', F.HIGH, Math.round(f.height));
  if (f.distance >= F.FAR_M) add('far', 'DISTANCE', F.FAR + (f.distance - F.FAR_M) * F.FAR_PER_M, Math.round(f.distance));
  if (f.gap) add('gap', 'GAP', F.GAP);
  if (f.transfer) add('transfer', 'TRANSFER', F.TRANSFER);

  // ── Ground stunts, banked from before the launch ───────────────────────
  if (f.ground) {
    if (f.ground.wheelie >= F.GROUND_TIME) add('wheelie', 'WHEELIE', F.WHEELIE + f.ground.wheelie * F.GROUND_PER_SEC, +f.ground.wheelie.toFixed(2));
    if (f.ground.endo >= F.GROUND_TIME) add('endo', 'ENDO', F.ENDO + f.ground.endo * F.GROUND_PER_SEC, +f.ground.endo.toFixed(2));
    if (f.ground.twoWheel >= F.GROUND_TIME) add('twowheel', 'TWO WHEELS', F.TWO_WHEEL + f.ground.twoWheel * F.GROUND_PER_SEC, +f.ground.twoWheel.toFixed(2));
    // A sustained slide, banked from the run-up like the wheel-pose stunts. The
    // threshold is deliberately at the edge of what today's physics can hold, so
    // this pays only for a real, held drift, never a snap-slide (see probe:drift).
    if (f.ground.drift >= F.DRIFT_TIME) add('drift', 'DRIFT', F.DRIFT + f.ground.drift * F.DRIFT_PER_SEC, +f.ground.drift.toFixed(2));
  }

  // ── The world reacting to you ──────────────────────────────────────────
  // Coins are deliberately *not* a facet. They are flat score swept up along an
  // authored line, so counting them would push every jump on the hero route a
  // step up the curve for doing nothing.
  if (f.nearMisses > 0) add('nearmiss', 'NEAR MISS', F.NEAR_MISS * f.nearMisses, f.nearMisses);

  // ── Bodywork held as a pose (§5.1) ─────────────────────────────────────
  for (const [slot, label] of Object.entries(POSE_NAME)) {
    const t = f.pose[slot] || 0;
    if (t >= S.POSE_MIN_TIME) add(`pose_${slot}`, label, t * S.POSE_PER_SEC, +t.toFixed(2));
  }

  // ── Purity: the assist is a resource, not a right ──────────────────────
  // It is a *multiplier*, not a facet. Counting it as both would pay twice for
  // the same restraint, and it would put every hands-off jump a facet closer
  // to the top of the curve for doing nothing.
  const purity = purityOf(f);

  const base = out.reduce((a, x) => a + x.value, 0);
  const m = facetMultiplier(out.length);
  return { facets: out, base, mult: m.mult, multName: m.name, purity };
}

const POSE_NAME = {
  DOOR_L: 'LEFT AERO', DOOR_R: 'RIGHT AERO', HOOD: 'SPLITTER OUT',
  TRUNK: 'DIFFUSER OUT', SPOILER: 'WING OUT',
};

/**
 * RAW / TOUCHED / FLOWN.
 *
 * The reference paid a bonus for using the wings sparingly and a bigger one
 * for not using them at all, which quietly turns the assist into a risk/reward
 * decision instead of a free button.
 *
 * The subtlety here: our bodywork both *creates* rotation and *kills* it, so
 * purity cannot simply count panel usage or the trick generator becomes the
 * thing that costs you. It counts only the **stabilising** verbs — the thrust
 * burst, both doors together as an air brake, and the wing.
 */
export function purityOf(f) {
  const P = TUNING.SCORE.PURITY;
  const seconds = +((f.brakeTime || 0) + (f.pose.SPOILER || 0)).toFixed(2);
  const bursts = f.thrustBursts || 0;
  if (bursts === 0 && seconds <= P.RAW_SECONDS) {
    return { id: 'raw', label: 'RAW', mult: P.RAW, seconds, bursts };
  }
  if (bursts <= P.TOUCHED_BURSTS && seconds <= P.TOUCHED_SECONDS) {
    return { id: 'touched', label: 'TOUCHED', mult: P.TOUCHED, seconds, bursts };
  }
  return { id: 'flown', label: 'FLOWN', mult: P.FLOWN, seconds, bursts };
}
