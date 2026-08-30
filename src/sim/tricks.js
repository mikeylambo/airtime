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
    this.ground = { wheelie: 0, endo: 0, twoWheel: 0 };
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
    this.ground = { wheelie: 0, endo: 0, twoWheel: 0 };
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
    if (car.wheelsInContact === 0 || car.groundSpeed < F.GROUND_MIN_SPEED) return;
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
      ground: this.pendingGround || { wheelie: 0, endo: 0, twoWheel: 0 },
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
