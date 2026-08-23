/**
 * The one bar (§5) — ground boost and air thrust draw from the same meter.
 *
 * "Spend it all on the launch and you have nothing to save the landing; hold
 * some back and you launch shorter. That tradeoff is the skill."
 *
 * Earn is §4. Traffic near-miss arrives with item 6; the earn terms it will
 * replace are marked PLACEHOLDER in TUNING so they are easy to find.
 */

import TUNING from '../TUNING.js';
import { clamp } from './mathx.js';

export class BoostBar {
  constructor() {
    this.value = TUNING.BOOST.START;
    this.boosting = false;
    this.chainArmed = false;      // this hold began with a full bar
    this.chainFired = false;
    this.spentThisRun = 0;
    this.earnedThisRun = 0;
  }

  reset() {
    this.value = TUNING.BOOST.START;
    this.boosting = false;
    this.chainArmed = false;
    this.chainFired = false;
  }

  /** True if a thrust burst can be paid for right now (§5). */
  canAffordThrust() { return this.value >= TUNING.BOOST.THRUST_COST; }

  spendThrust() {
    const B = TUNING.BOOST;
    if (!this.canAffordThrust()) return false;
    this.value = clamp(this.value - B.THRUST_COST, 0, B.MAX);
    this.spentThisRun += B.THRUST_COST;
    return true;
  }

  update(dt, { car, actions, airborne }) {
    const B = TUNING.BOOST;
    const wantBoost = !!actions.boost && !airborne;

    // ── Burnout-chain arming (§4): the hold must *begin* on a full bar ──────
    if (wantBoost && !this.boosting) {
      this.chainArmed = B.CHAIN_ENABLED && this.value >= B.CHAIN_START_MIN;
      this.chainFired = false;
    }

    let drained = 0;
    if (wantBoost && this.value > 0) {
      drained = Math.min(this.value, B.DRAIN_PER_SEC_GROUND * dt);
      this.value -= drained;
      this.spentThisRun += drained;
      this.boosting = true;
    } else {
      this.boosting = false;
    }

    // Drained the whole bar in one unbroken hold → it comes straight back.
    if (this.chainArmed && !this.chainFired && this.value <= 1e-4) {
      this.value = B.CHAIN_REFILL;
      this.chainFired = true;
      this.chainArmed = false;
    }
    if (!wantBoost) this.chainArmed = false;

    // ── Earn (§4) ──────────────────────────────────────────────────────────
    let earn = 0;
    if (car.driftTime > 0) earn += B.EARN_DRIFT_PER_SEC * dt;
    if (airborne) earn += B.EARN_AIRTIME_PER_SEC * dt;
    if (!airborne && car.groundSpeed > B.PLACEHOLDER_EARN_SPEED_MIN) {
      earn += B.PLACEHOLDER_EARN_SPEED_PER_SEC * dt;
    }
    if (earn > 0) {
      const before = this.value;
      this.value = clamp(this.value + earn, 0, B.MAX);
      this.earnedThisRun += this.value - before;
    }

    return this.boosting;
  }

  /** Near-miss credit — the hook item 6's traffic will call. */
  creditNearMiss(n = 1) {
    const B = TUNING.BOOST;
    this.value = clamp(this.value + B.PLACEHOLDER_EARN_NEARMISS * n, 0, B.MAX);
  }
}

export default BoostBar;
