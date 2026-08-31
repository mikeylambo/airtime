/**
 * Flight recording and the bank (R1).
 *
 * Rotation is physics, not an input list. This integrates the car's own
 * angular velocity for the length of a flight and hands the result to
 * facets.js, which decides what was true about it. A player who does not know
 * they did a 540 while inverted with the tail out still gets paid for all
 * three.
 *
 * Ground stunts are tracked continuously and *bank into the next flight*, so
 * a wheelie on the run-up is worth something only if the jump it feeds gets
 * landed. Land it or lose it, all the way down.
 */

import TUNING from '../TUNING.js';
import { qInvRot } from './mathx.js';
import { SLOTS } from './panels.js';
import { computeFacets, purityOf } from './facets.js';

export class TrickTracker {
  constructor() {
    this.ground = { wheelie: 0, endo: 0, twoWheel: 0, drift: 0 };
    // A drift line that never launches banks on its own (see closeGroundLine).
    // peak is the most drift the current slide has held; idle is how long since
    // it last drifted, so the line can close once the slide is clearly over.
    this.groundLine = { peak: 0, idle: 0 };
    this.reset();
    this.coinsThisJump = 0;
  }

  reset() {
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.twistTime = 0;
    this.maxTilt = 0;
    this.pose = Object.fromEntries(SLOTS.map((s) => [s, 0]));
    this.brakeTime = 0;          // both doors out together = air brake
    this.airtime = 0;
    this.height = 0;
    this.distance = 0;
    this.launchY = 0;
    this.maxY = 0;
    this.launch = { x: 0, y: 0, z: 0 };
    this.coinsThisJump = 0;
    this.nearMisses = 0;
    this.thrustBursts = 0;
    this.active = false;
  }

  onLaunch(car) {
    // Ground stunts survive the reset: they were earned on the way in.
    const carried = { ...this.ground };
    this.reset();
    this.pendingGround = carried;
    this.ground = { wheelie: 0, endo: 0, twoWheel: 0, drift: 0 };
    // The launch consumes the bank into this flight, so any open ground line is
    // spent — it must not also resolve on its own.
    this.groundLine = { peak: 0, idle: 0 };
    this.active = true;
    this.launchY = car.position.y;
    this.maxY = car.position.y;
    this.launch = { ...car.position };
  }

  /** Integrate the flight. Called every fixed step while airborne. */
  update(dt, car, panels) {
    if (!this.active) return;
    const S = TUNING.SCORE;
    const w = qInvRot(car.rotation, car.angvel);
    this.pitch += w.x * dt;         // + = nose up
    this.yaw += w.y * dt;           // + = nose left
    this.roll += -w.z * dt;         // + = right side down

    // Twist is two axes turning at once — the facet that rewards mixing rather
    // than stacking one axis.
    const spinning = [w.x, w.y, w.z].filter((v) => Math.abs(v) > S.TWIST_RATE).length;
    if (spinning >= 2) this.twistTime += dt;

    this.maxTilt = Math.max(this.maxTilt, car.tiltAngle);
    this.airtime += dt;
    this.maxY = Math.max(this.maxY, car.position.y);
    this.height = this.maxY - this.launchY;
    this.distance = Math.hypot(car.position.x - this.launch.x, car.position.z - this.launch.z);

    let doors = 0;
    for (const s of SLOTS) {
      const p = panels.parts[s];
      if (p.attached && p.deploy > 0.5) {
        this.pose[s] += dt;
        if (s === 'DOOR_L' || s === 'DOOR_R') doors++;
      }
    }
    if (doors === 2) this.brakeTime += dt;
  }

  /**
   * Ground stunts (R1). Read straight off which wheels are down, so a wheelie
   * is a wheelie whether the player meant it or not.
   */
  updateGround(dt, car) {
    const F = TUNING.SCORE.FACET;
    if (car.wheelsInContact === 0) return;
    // The ground line's idle timer (time since the slide last ran) is tracked
    // before the speed gate below, so a drift that ends by the car slowing to a
    // near-stop still closes the line rather than freezing here — car.driftTime
    // is already zero below drift speed, so a slow car reads as "not drifting".
    if (car.driftTime > 0) this.groundLine.idle = 0;
    else this.groundLine.idle += dt;
    if (car.groundSpeed < F.GROUND_MIN_SPEED) return;
    // Drift is independent of the wheel-pose stunts — a slide can run with all
    // four wheels down — so it reads off the car's own drift condition (slip
    // angle + speed, per DRIVE) rather than a wheel-contact pattern. Like the
    // others it banks into the next flight and decays when the slide breaks, so
    // you cannot pocket a twitch.
    if (car.driftTime > 0) this.ground.drift += dt;
    else this.ground.drift *= 0.72;
    // Remember the most the slide held, so a line that decays before it closes
    // still banks the drift it actually earned, not the decayed remainder.
    this.groundLine.peak = Math.max(this.groundLine.peak, this.ground.drift);
    const pitch = car.pitchAngle;
    if (car.rearDown && !car.frontDown && pitch > F.WHEELIE_ANGLE) this.ground.wheelie += dt;
    else if (car.frontDown && !car.rearDown && pitch < -F.ENDO_ANGLE) this.ground.endo += dt;
    else if ((car.leftDown && !car.rightDown) || (car.rightDown && !car.leftDown)) this.ground.twoWheel += dt;
    else {
      // Falling out of a stunt ends it — you do not get to bank a wobble.
      this.ground.wheelie *= 0.72;
      this.ground.endo *= 0.72;
      this.ground.twoWheel *= 0.72;
    }
  }

  /**
   * Close a pure-ground LINE — a drift held on the wheels and never launched out
   * of. It resolves once the slide is clearly over (idle past the grace) with a
   * scorable drift held, banking the whole ground record (a slide that also
   * popped a wheelie pays for both). A launch consumes the bank first (onLaunch
   * clears groundLine), so this only ever fires when there was no jump.
   *
   * Gated on the *drift* peak specifically: wheelie/endo/two-wheel lines already
   * pay only into a jump, and this must not change that. On today's physics no
   * car sustains a drift to F.DRIFT_TIME, so this returns null every frame until
   * a tyre model can — the same dormancy the DRIFT facet has by design.
   *
   * @returns a ground-line snapshot (shape-compatible with resolveTrick), or null.
   */
  closeGroundLine() {
    const F = TUNING.SCORE.FACET;
    if (this.groundLine.peak < F.DRIFT_TIME || this.groundLine.idle < TUNING.SCORE.GROUND_LINE_GRACE) return null;
    // Score the peak the slide reached, plus whatever else was banked with it.
    const ground = { ...this.ground, drift: this.groundLine.peak };
    const flight = {
      yaw: 0, pitch: 0, roll: 0, twistTime: 0, maxTilt: 0,
      airtime: 0, height: 0, distance: 0, pose: {}, brakeTime: 0,
      thrustBursts: 0, coins: 0, nearMisses: 0, ground, gap: false, transfer: false,
    };
    const b = computeFacets(flight);
    this.ground = { wheelie: 0, endo: 0, twoWheel: 0, drift: 0 };
    this.groundLine = { peak: 0, idle: 0 };
    return { ...b, flight, airtime: 0, height: 0, coins: 0, groundLine: true };
  }

  collectCoin() { this.coinsThisJump++; }
  creditNearMiss(n = 1) { this.nearMisses += n; }
  creditThrust() { this.thrustBursts++; }

  /** What the flight is worth so far, before any landing multiplier. */
  get bank() { return this._breakdown().base; }

  _flight() {
    return {
      yaw: this.yaw, pitch: this.pitch, roll: this.roll,
      twistTime: this.twistTime, maxTilt: this.maxTilt,
      airtime: this.airtime, height: this.height, distance: this.distance,
      pose: this.pose, brakeTime: this.brakeTime,
      thrustBursts: this.thrustBursts,
      coins: this.coinsThisJump, nearMisses: this.nearMisses,
      ground: this.pendingGround || { wheelie: 0, endo: 0, twoWheel: 0, drift: 0 },
      gap: this.gap, transfer: this.transfer,
    };
  }

  _breakdown() { return computeFacets(this._flight()); }

  /**
   * Freeze the flight the moment the wheels touch. Landing quality is not
   * known until the settle window closes, and a car that bounces inside that
   * window fires a fresh launch which resets this tracker — so reading the
   * bank at resolve time would throw the whole flight away.
   */
  snapshot(context = {}) {
    this.gap = context.gap;
    this.transfer = context.transfer;
    const flight = this._flight();
    const b = computeFacets(flight);
    this.active = false;
    return { ...b, flight, airtime: this.airtime, height: this.height, coins: this.coinsThisJump };
  }
}

/**
 * Close a frozen flight against its landing.
 *
 * bank = facet values, multiplied by how many facets there were at once and by
 * how little help was taken. Then the landing decides whether any of it is
 * real (R1 keeps the reference's rule: land it or lose it).
 */
export function resolveTrick(snap, landing, tierMult, combo = 1) {
  const S = TUNING.SCORE;
  const coins = snap.coins * S.COIN_VALUE;
  const landed = landing.quality !== 'crash';

  const bank = Math.round(snap.base * snap.mult * snap.purity.mult);
  const payout = landed ? Math.round(bank * landing.multiplier * tierMult * combo) : 0;

  return {
    facets: snap.facets,
    facetCount: snap.facets.length,
    facetMult: snap.mult,
    facetName: snap.multName,
    purity: snap.purity,
    base: snap.base,
    bank,
    // Kept for the older readouts and the licence tests.
    tricks: snap.facets,
    trickTotal: snap.base,
    coins,
    landed,
    quality: landing.quality,
    landingMult: landing.multiplier,
    tier: landing.tier,
    tierMult,
    combo,
    airtime: snap.airtime,
    height: snap.height,
    // The flight itself, and the single number a player means by "a 900": the
    // most any one axis turned. R9's challenge ladder asks for these, and
    // recomputing them from facets afterwards would be reading the name off
    // the thing instead of the thing.
    flight: snap.flight,
    rotation: snap.flight
      ? Math.max(Math.abs(snap.flight.yaw), Math.abs(snap.flight.pitch), Math.abs(snap.flight.roll))
      : 0,
    payout,
    total: payout + coins,
  };
}

export default TrickTracker;
