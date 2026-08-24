/**
 * Trick detection and the bank (§3.1, item 5).
 *
 * Pillar 3: "Rotation is physics, not an input list. The game names the trick
 * *after* it happens." Nothing here is triggered by a button. The tracker
 * integrates the car's own angular velocity in its own frame for the length of
 * a flight, and at touchdown reads off how many complete turns happened about
 * each axis. A player who does not know they did a 540 still gets paid for one.
 *
 * Bank cashes only on a landed stick. A crash loses it — but the crash itself
 * is spectacle, not a penalty screen (§3).
 */

import TUNING from '../TUNING.js';
import { qInvRot, clamp } from './mathx.js';
import { SLOTS } from './panels.js';

const TAU = Math.PI * 2;

const POSE_NAME = {
  DOOR_L: 'LEFT DOOR', DOOR_R: 'RIGHT DOOR', HOOD: 'HOOD UP',
  TRUNK: 'TAIL FLAP', SPOILER: 'WING OUT',
};

const SPIN_NAME = (n) => `${n * 360}`;
const FLIP_NAME = (n, back) => {
  const d = back ? 'BACKFLIP' : 'FRONTFLIP';
  return n === 1 ? d : `${['', '', 'DOUBLE', 'TRIPLE', 'QUAD'][Math.min(n, 4)] || `${n}x`} ${d}`;
};
const ROLL_NAME = (n) =>
  n === 1 ? 'BARREL ROLL' : `${['', '', 'DOUBLE', 'TRIPLE', 'QUAD'][Math.min(n, 4)] || `${n}x`} BARREL ROLL`;

/** Complete turns in `rad`, with a little grace so a near-miss still pays. */
function turns(rad) {
  return Math.floor((Math.abs(rad) + TUNING.SCORE.ROTATION_GRACE) / TAU);
}

/** §3.1: base, then +EXTRA_ROTATION of base for every rotation past the first. */
function rotationValue(base, n) {
  return n < 1 ? 0 : base * (1 + TUNING.SCORE.EXTRA_ROTATION * (n - 1));
}

export class TrickTracker {
  constructor() {
    this.reset();
    this.coinsThisJump = 0;
  }

  reset() {
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.pose = Object.fromEntries(SLOTS.map((s) => [s, 0]));
    this.airtime = 0;
    this.height = 0;
    this.launchY = 0;
    this.maxY = 0;
    this.coinsThisJump = 0;
    this.active = false;
  }

  onLaunch(car) {
    this.reset();
    this.active = true;
    this.launchY = car.position.y;
    this.maxY = car.position.y;
  }

  /** Integrate rotation and pose time. Called every fixed step while airborne. */
  update(dt, car, panels) {
    if (!this.active) return;
    const w = qInvRot(car.rotation, car.angvel);
    this.pitch += w.x * dt;         // + = nose up
    this.yaw += w.y * dt;           // + = nose left
    this.roll += -w.z * dt;         // + = right side down
    this.airtime += dt;
    this.maxY = Math.max(this.maxY, car.position.y);
    this.height = this.maxY - this.launchY;

    for (const s of SLOTS) {
      const p = panels.parts[s];
      if (p.attached && p.deploy > 0.5) this.pose[s] += dt;
    }
  }

  collectCoin() { this.coinsThisJump++; }

  /**
   * What the flight is worth so far, before any landing multiplier. Shown live
   * on the HUD so the player can see the bank they are about to risk.
   */
  get bank() { return this._breakdown().bank; }

  _breakdown() {
    const S = TUNING.SCORE;
    const tricks = [];

    const spins = turns(this.yaw);
    if (spins >= 1) {
      tricks.push({ kind: 'spin', n: spins, name: SPIN_NAME(spins),
        value: Math.round(rotationValue(S.SPIN_BASE, spins)) });
    }
    const flips = turns(this.pitch);
    if (flips >= 1) {
      tricks.push({ kind: 'flip', n: flips, name: FLIP_NAME(flips, this.pitch > 0),
        value: Math.round(rotationValue(S.FLIP_BASE, flips)) });
    }
    const rolls = turns(this.roll);
    if (rolls >= 1) {
      tricks.push({ kind: 'roll', n: rolls, name: ROLL_NAME(rolls),
        value: Math.round(rotationValue(S.ROLL_BASE, rolls)) });
    }

    // Held poses are tricks too — steering the air and scoring are one act.
    for (const s of SLOTS) {
      const t = this.pose[s];
      if (t < S.POSE_MIN_TIME) continue;
      tricks.push({ kind: 'pose', slot: s, seconds: t, name: POSE_NAME[s],
        value: Math.round(t * S.POSE_PER_SEC) });
    }

    const trickTotal = tricks.reduce((a, t) => a + t.value, 0);
    const airBonus = Math.round(Math.min(this.airtime * S.AIRTIME_BONUS_PER_SEC, S.AIRTIME_BONUS_CAP));
    const heightBonus = Math.round(Math.min(Math.max(0, this.height) * S.HEIGHT_BONUS_PER_M, S.HEIGHT_BONUS_CAP));

    return {
      tricks, trickTotal, airBonus, heightBonus,
      bank: trickTotal + airBonus + heightBonus,
    };
  }

  /**
   * Freeze the flight the moment the wheels touch.
   *
   * Landing quality is not known until the settle window closes (§3.1 allows
   * "two wheels then settle"), and a car that bounces inside that window fires
   * a fresh launch which resets this tracker. Reading the bank at *resolve*
   * time therefore threw away the whole flight — every big jump banked the
   * 0.1 s bounce that followed it instead.
   */
  snapshot() {
    const b = this._breakdown();
    this.active = false;
    return { ...b, airtime: this.airtime, height: this.height, coins: this.coinsThisJump };
  }
}

/**
 * Close a frozen flight against its landing.
 * @param snap     from TrickTracker.snapshot(), taken at touchdown
 * @param landing  from AirtimeTracker, once the settle window has closed
 * @param tierMult §3.1 target tier multiplier
 * @param combo    run-level chain multiplier
 */
export function resolveTrick(snap, landing, tierMult, combo = 1) {
  const S = TUNING.SCORE;
  const coins = snap.coins * S.COIN_VALUE;
  const landed = landing.quality !== 'crash';

  // The whole game (§3.1): the bank is nothing until it is landed.
  const payout = landed ? Math.round(snap.bank * landing.multiplier * tierMult * combo) : 0;

  return {
    tricks: snap.tricks,
    trickTotal: snap.trickTotal,
    airBonus: snap.airBonus,
    heightBonus: snap.heightBonus,
    bank: snap.bank,
    coins,                        // flat, outside the bank — routes pay twice
    landed,
    quality: landing.quality,
    landingMult: landing.multiplier,
    tier: landing.tier,
    tierMult,
    combo,
    airtime: snap.airtime,
    height: snap.height,
    payout,
    total: payout + coins,
  };
}

export default TrickTracker;
