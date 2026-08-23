/**
 * Airtime detection, ballistic prediction and landing quality (item 3, §3.1).
 *
 * The launch event is what arms the camera (§6), so it carries the prediction
 * the director needs: how long the car will be up, and roughly where it comes
 * down. The prediction is a plain ballistic integration sampled against the
 * real collision world — it is used for framing only, never fed back into the
 * simulation.
 */

import TUNING from '../TUNING.js';
import { RAPIER, WHEEL_RAY_GROUPS } from './physics.js';
import { v3, clamp, dot, len, norm, WORLD_UP } from './mathx.js';
import { targetAt } from './arena-body.js';

export const LANDING = { PERFECT: 'perfect', CLEAN: 'clean', SLOPPY: 'sloppy', CRASH: 'crash' };
export const LANDING_MULT = { perfect: 3.0, clean: 2.0, sloppy: 1.0, crash: 0 };

/**
 * Integrate a ballistic arc against the world.
 * @returns {{airtime, apexTime, apexHeight, point, samples}}
 */
export function predictArc(world, p0, v0, gravity, dragK = 0, maxTime = 8, step = 1 / 30) {
  const samples = [];
  let apexHeight = p0.y;
  let apexTime = 0;
  const down = { x: 0, y: -1, z: 0 };

  // Integrated rather than solved, because a tumbling car sheds a lot of speed
  // to drag. The closed-form parabola overshot the real landing point by ~70 m
  // on the hero jump, which would have the target-lock camera framing bare deck.
  const p = { ...p0 };
  const v = { ...v0 };

  for (let t = step; t <= maxTime; t += step) {
    const sp = Math.hypot(v.x, v.y, v.z);
    const d = dragK * sp;
    v.x += -d * v.x * step;
    v.y += (gravity - d * v.y) * step;
    v.z += -d * v.z * step;
    p.x += v.x * step;
    p.y += v.y * step;
    p.z += v.z * step;
    samples.push({ ...p });
    if (p.y > apexHeight) { apexHeight = p.y; apexTime = t; }

    // Only start looking for ground once we are descending — otherwise the
    // ramp we just left counts as the landing.
    const vy = v.y;
    if (vy > 0) continue;

    const hit = world.castRay(new RAPIER.Ray(p, down), 400, true, undefined, WHEEL_RAY_GROUPS);
    const groundY = hit ? p.y - hit.timeOfImpact : -Infinity;
    if (p.y <= groundY + 0.6) {
      return { airtime: t, apexTime, apexHeight, point: { ...p, y: groundY }, samples };
    }
  }
  const last = samples[samples.length - 1] || { ...p0 };
  return { airtime: maxTime, apexTime, apexHeight, point: last, samples };
}

export class AirtimeTracker {
  constructor(world, park) {
    this.world = world;
    this.park = park;

    this.airborne = false;
    this.airtime = 0;
    this.offGroundTimer = 0;
    this.onGroundTimer = 0;

    this.launchHeight = 0;
    this.maxHeight = 0;
    this.launchSpeed = 0;
    this.prediction = null;

    this.pending = null;      // landing being evaluated across SETTLE_TIME
    this.lastLanding = null;
    this.chassisContactTime = 0;
    this.impactVelAtContact = 0;

    // Mean frontal area of the chassis across its three faces — a tumbling car
    // presents roughly this much. Used only by the prediction.
    const C = TUNING.CAR;
    const meanArea = (4 * C.HALF.y * C.HALF.z + 4 * C.HALF.x * C.HALF.z + 4 * C.HALF.x * C.HALF.y) / 3;
    this.dragK = (0.5 * TUNING.AERO.AIR_DENSITY * meanArea * TUNING.AERO.CHASSIS_CD) / C.MASS;
  }

  reset() {
    this.airborne = false;
    this.airtime = 0;
    this.offGroundTimer = 0;
    this.onGroundTimer = 0;
    this.pending = null;
    this.chassisContactTime = 0;
  }

  /** Height of the car above whatever is directly beneath it. */
  heightAboveGround(car) {
    const p = car.position;
    const hit = this.world.castRay(
      new RAPIER.Ray(p, { x: 0, y: -1, z: 0 }), 500, true, undefined, WHEEL_RAY_GROUPS
    );
    return hit ? hit.timeOfImpact : 500;
  }

  /**
   * Is the chassis box itself *actually* dug into the world? That is a crash,
   * not a landing.
   *
   * contactPairsWith alone is not enough: Rapier reports a pair as soon as the
   * broad phase pairs them, so simply driving past a ramp registered as a
   * chassis strike and every landing near one scored as a crash. Only a
   * negative contact distance counts.
   */
  chassisTouching(car, depth = TUNING.AIRTIME.CHASSIS_CONTACT_DEPTH) {
    let hit = false;
    this.world.contactPairsWith(car.collider, (other) => {
      if (hit) return;
      this.world.contactPair(car.collider, other, (manifold) => {
        const n = manifold.numContacts();
        for (let i = 0; i < n; i++) {
          if (manifold.contactDist(i) < depth) { hit = true; return; }
        }
      });
    });
    return hit;
  }

  update(dt, car) {
    const A = TUNING.AIRTIME;
    const events = { launch: null, landed: null, touchdown: false };
    const grounded = car.wheelsInContact > 0;

    if (grounded) {
      // Capture the closing speed on the *first* frame a wheel touches. The
      // touchdown event resolves LAND_GRACE later, by which point the
      // suspension has already eaten the impact and every landing looked
      // smooth — bounce detection could never fire.
      if (this.onGroundTimer === 0) this.impactVelAtContact = -car.linvel.y;
      this.onGroundTimer += dt;
      this.offGroundTimer = 0;
    } else { this.offGroundTimer += dt; this.onGroundTimer = 0; }

    // ── Launch ─────────────────────────────────────────────────────────────
    if (!this.airborne && this.offGroundTimer >= A.COYOTE_TIME) {
      this.airborne = true;
      this.airtime = this.offGroundTimer;
      const p = car.position;
      const v = car.linvel;
      this.launchHeight = p.y;
      this.maxHeight = p.y;
      this.launchSpeed = car.speed;

      const armed = car.speed >= A.LAUNCH_MIN_SPEED && v.y >= A.LAUNCH_MIN_UP_VEL;
      this.prediction = predictArc(this.world, p, v, TUNING.SIM.GRAVITY, this.dragK);
      events.launch = {
        armed,
        position: { ...p },
        velocity: { ...v },
        speed: car.speed,
        upVelocity: v.y,
        predictedAirtime: this.prediction.airtime,
        predictedApex: this.prediction.apexHeight,
        predictedLanding: this.prediction.point,
      };
    }

    if (this.airborne) {
      this.airtime += dt;
      this.maxHeight = Math.max(this.maxHeight, car.position.y);
    }

    // ── Beached: chassis down, wheels never arriving ───────────────────────
    // Landing on the roof puts no wheel in contact, so without this the
    // tracker would sit "airborne" forever and the run would never resolve.
    if (this.airborne) {
      this.chassisContactTime = this.chassisTouching(car) ? this.chassisContactTime + dt : 0;
      if (this.chassisContactTime >= A.CHASSIS_CRASH_TIME) {
        this.airborne = false;
        this.chassisContactTime = 0;
        events.touchdown = true;
        events.landed = {
          quality: LANDING.CRASH, multiplier: 0,
          angle: car.tiltAngle, angleDeg: (car.tiltAngle * 180) / Math.PI,
          wheels: car.wheelsInContact, bounced: false,
          airtime: this.airtime, height: this.maxHeight - this.launchHeight,
          impactVel: 0,
          target: null, tier: 'road',
          counted: this.airtime >= A.MIN_LOGGED_AIRTIME,
          beached: true,
        };
        this.lastLanding = events.landed;
        this.airtime = 0;
        return events;
      }
    } else this.chassisContactTime = 0;

    // ── Touchdown ──────────────────────────────────────────────────────────
    if (this.airborne && grounded && this.onGroundTimer >= A.LAND_GRACE) {
      this.airborne = false;
      events.touchdown = true;
      const v = car.linvel;
      const struck = this.chassisTouching(car, A.CHASSIS_CRASH_DEPTH) || car.tiltAngle > A.CRASH_ROOF_ANGLE;
      if (this.pending) {
        // A bounce inside the settle window is part of the same landing, not a
        // new one (§3.1 explicitly allows "two wheels then settle"). Replacing
        // the record here reported every bouncy stick as a 0.1 s hop and threw
        // away the airtime the player actually earned.
        this.pending.firstAngle = Math.min(this.pending.firstAngle, car.landingAngle);
        this.pending.firstWheels = Math.max(this.pending.firstWheels, car.wheelsInContact);
        this.pending.crashedOnContact = this.pending.crashedOnContact || struck;
        this.pending.bounces = (this.pending.bounces || 0) + 1;
      } else {
        this.pending = {
          airtime: this.airtime,
          height: this.maxHeight - this.launchHeight,
          impactVel: this.impactVelAtContact ?? -v.y,
          settle: A.SETTLE_TIME,
          firstAngle: car.landingAngle,
          firstWheels: car.wheelsInContact,
          crashedOnContact: struck,
          bounces: 0,
          position: { ...car.position },
        };
      }
      this.airtime = 0;
    }

    // ── Settle window: §3.1 allows "two wheels then settle" ────────────────
    if (this.pending) {
      this.pending.settle -= dt;
      if (this.chassisTouching(car, A.CHASSIS_CRASH_DEPTH) || car.tiltAngle > A.CRASH_ROOF_ANGLE) {
        this.pending.crashedOnContact = true;
      }
      if (this.pending.settle <= 0) {
        events.landed = this._resolve(car, this.pending);
        this.lastLanding = events.landed;
        this.pending = null;
      }
    }

    return events;
  }

  _resolve(car, p) {
    const A = TUNING.AIRTIME;
    const angle = Math.min(p.firstAngle, car.landingAngle);
    const wheels = Math.max(p.firstWheels, car.wheelsInContact);
    const bounced = p.impactVel > A.BOUNCE_VEL || (p.bounces || 0) > 0;

    let quality;
    if (p.crashedOnContact || angle > A.SLOPPY_ANGLE) quality = LANDING.CRASH;
    else if (angle <= A.PERFECT_ANGLE && wheels >= A.PERFECT_MIN_WHEELS && !bounced) quality = LANDING.PERFECT;
    else if (angle <= A.CLEAN_ANGLE && wheels >= A.CLEAN_MIN_WHEELS) quality = LANDING.CLEAN;
    else quality = LANDING.SLOPPY;

    const target = targetAt(this.park, p.position);
    return {
      quality,
      multiplier: LANDING_MULT[quality],
      angle,
      angleDeg: (angle * 180) / Math.PI,
      wheels,
      bounced,
      airtime: p.airtime,
      height: p.height,
      impactVel: p.impactVel,
      bounces: p.bounces || 0,
      target: target ? target.id : null,
      tier: target ? target.tier : 'road',
      counted: p.airtime >= A.MIN_LOGGED_AIRTIME,
    };
  }
}

export default AirtimeTracker;
