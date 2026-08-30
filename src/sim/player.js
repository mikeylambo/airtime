/**
 * One car and everything that belongs to it.
 *
 * Split-screen (§9) puts up to four of these in a single world, so anything
 * per-driver — bodywork, boost bar, thrust, airtime, the trick bank, the
 * score — lives here, and only the world itself (arena, traffic, moving
 * targets, coins, clock) stays on the Sim.
 */

import TUNING from '../TUNING.js';
import { Car } from './car.js';
import { Panels, SLOTS } from './panels.js';
import { BoostBar } from './boost.js';
import { TeaseThrust } from './thrust.js';
import { AirtimeTracker } from './airtime.js';
import { TrickTracker } from './tricks.js';
import { AeroAccumulator, applyAngularDrag, addBodyLift } from './aero.js';
import { Score } from './round.js';
import { qRot, qInvRot, qAxisAngle, WORLD_UP } from './mathx.js';
import { Wear } from './wear.js';
import { BrakeHeat } from './brakes.js';

export class Player {
  constructor(world, park, { setup = null, index = 0, round, spawn, movingTargetAt }) {
    this.index = index;
    this.world = world;
    this.setup = setup;
    this.spawn = spawn;

    this.car = new Car(world, setup);
    this.car.reset(spawn);
    // R7: deformation is per-run and physical, scuffing is per-session and
    // cosmetic (see sim/wear.js — the split is a §R requirement). The Wear
    // object outlives a run; only its panel half is reset by one.
    this.wear = new Wear();
    this.brakes = new BrakeHeat();
    this.panels = new Panels(world, this.car, setup, this.wear);
    this.panels.syncToChassis();

    this.boost = new BoostBar(setup);
    this.thrust = new TeaseThrust(this.car, this.boost, setup);
    this.airtimeTracker = new AirtimeTracker(world, park, movingTargetAt);
    this.tricks = new TrickTracker();
    // One accumulator each: the lift clamp of §5.1 is a fraction of *this*
    // car's weight, and sharing one would clamp four cars against one budget.
    this.aero = new AeroAccumulator();
    this.run = new Score(round, index);

    this.boosting = false;
    this.pendingTrick = null;
    this.lastLanding = null;
    this.lastLaunch = null;
    this.lastResult = null;
    this.recover = 0;
    this.stuck = 0;
    this.respawns = 0;
    // Altitude gained on the wheels, without ever leaving the ground. Reset
    // by any launch, so a roof reached by jumping never counts — which makes
    // it exactly the question "did you drive up something".
    this.groundClimb = 0;
    this.climbBase = null;
    this.coinsTaken = new Set();
    this.calledTarget = null;      // §9 Call Your Shot
    this.wasDeployed = {};
    for (const s of SLOTS) this.wasDeployed[s] = false;
  }

  get airborne() { return this.airtimeTracker.airborne; }
  get airtime() { return this.airtimeTracker.airtime; }
  get alive() { return this.run.alive; }

  reset() {
    this.car.reset(this.spawn);
    this.panels.restoreAll();
    this.panels.reset();
    this.boost.reset();
    this.thrust.reset();
    this.airtimeTracker.reset();
    this.tricks.reset();
    // Deformation lives for one run; scuffing lives for the session and is
    // only cleared by the garage (sim/wear.js).
    this.wear.reset();
    this.brakes.reset();
    this.recover = 0;
    this.stuck = 0;
    this.respawns = 0;
    this.groundClimb = 0;
    this.climbBase = null;
  }

  /**
   * Move the car, panels and all. Never call car.reset() on its own — the
   * panels are separate bodies on joints, and teleporting the chassis without
   * them leaves the hinges stretched across the arena.
   */
  place(pos = this.spawn, heading = TUNING.ARENA.SPAWN_HEADING) {
    this.car.reset(pos, heading);
    this.panels.syncToChassis();
    this.airtimeTracker.reset();
    this.tricks.reset();
  }

  /** Everything before world.step(): forces, motors, the vehicle controller. */
  preStep(dt, actions, edges, world) {
    const airborne = this.airtimeTracker.airborne;
    const A = TUNING.AERO;

    this.boosting = this.boost.update(dt, {
      car: this.car, actions, airborne, oncoming: this.oncoming,
    });
    this.car.update(dt, actions, this.boosting);
    this.panels.update(dt, actions, airborne);
    // R7 brake glow: a temperature, integrated from the work the brakes do.
    // Read-only — it never changes the braking force, which is why BRAKES is
    // not one of the sections the §R stamp hashes.
    this.brakes.update(dt, actions.brake || 0, this.car.groundSpeed,
      !airborne && this.car.wheelsInContact > 0);

    this.aero.begin();
    this.aero.addBoxPlates(
      this.car.body, this.car.rotation, this.car.position,
      this.setup ? this.setup.half : TUNING.CAR.HALF,
      A.CHASSIS_CD * (this.setup ? this.setup.chassisCd : 1), A.CHASSIS_SCALE,
      this.setup ? this.setup.cops : null
    );
    if (this.setup && this.setup.bodyLift > 0) {
      addBodyLift(this.aero, this.car.body, this.car.rotation, this.car.position,
        this.setup.half, A.BODY_LIFT * this.setup.bodyLift, this.setup.cops.lift);
    }
    for (const p of this.panels.list) {
      // R7: a bent panel is physically open whether or not it was asked to
      // be, so the air has to see it. Gating this on the *commanded* deploy
      // alone was the difference between deformation that changes how the
      // car flies and deformation that is a picture of damage.
      const open = Math.max(p.deploy, this.wear.hingeSag(p.slot));
      if (open < 0.02) continue;
      const target = A.APPLY_TO === 'chassis' ? this.car.body : p.body;
      this.aero.addPlate(
        p.body, p.body.rotation(), p.body.translation(), p.cfg.size,
        p.cfg.cd, A.PANEL_SCALE * this.panelGain(p.slot) * open, target
      );
    }
    this.aero.apply(dt, this.car.body.mass(), TUNING.SIM.GRAVITY);

    const finished = this.thrust.update(dt, {
      actions, airborne, pressedThrust: !!edges.thrust,
    });
    this.panels.applySpoiler(dt);
    applyAngularDrag(this.car.body, dt,
      this.setup ? this.setup.angDragScale : 1,
      this.setup ? this.setup.angDrag : null);
    return finished;
  }

  panelGain(slot) {
    if (this.setup) return this.setup.panels[slot].gain;
    return TUNING.PANELS[slot].gain ?? 1;
  }

  /**
   * Put the player back on the road after a crash, or after getting wedged.
   * Respawning at the arena spawn would cost most of a round in driving back,
   * so this drops you on the approach to the nearest ramp, already rolling.
   */
  respawn(park, rampSurface) {
    const R = TUNING.RESPAWN;
    const p = this.car.position;
    let best = null, bestD = Infinity;
    for (const r of park.ramps) {
      // A transit ramp is a road (the city's spiral flyover): dropping a
      // recovering player onto one points them up a spiral at 16 m/s.
      if (r.id === 'garage' || r.transit) continue;
      const d = Math.hypot(r.pos.x - p.x, r.pos.z - p.z);
      if (d < bestD) { bestD = d; best = r; }
    }

    let pos = { ...this.spawn };
    let heading = TUNING.ARENA.SPAWN_HEADING;
    if (best) {
      const s = Math.sin(best.yaw), c = Math.cos(best.yaw);
      const back = rampSurface(best).zMax + R.APPROACH;
      // Ramps live at altitude in Vertical City. Respawning at y=1.2 on the
      // approach to a rooftop kicker drops the player inside the building.
      pos = { x: best.pos.x + s * back, y: best.pos.y + 1.2, z: best.pos.z + c * back };
      heading = best.yaw;
    }
    this.place(pos, heading);
    const fwd = qRot(qAxisAngle(WORLD_UP, heading), { x: 0, y: 0, z: -1 });
    this.car.body.setLinvel({ x: fwd.x * R.SPEED, y: 0, z: fwd.z * R.SPEED }, true);
    this.panels.restoreAll();
    this.panels.reset();
    this.stuck = 0;
    this.recover = 0;
    this.respawns++;
    return { pos, ramp: best ? best.id : null };
  }

  /**
   * R7 scuffing: attribute an impact to a region of the bodywork. The
   * direction is the car's own velocity carried into its own frame — a car
   * landing flat scuffs its floor, one landing nose-first scuffs its nose,
   * and nothing has to be told which is which.
   */
  scuff(severity, velocity = null) {
    const v = velocity || this.car.linvel;
    const local = qInvRot(this.car.rotation, v);
    return this.wear.scuffFrom(local, severity);
  }

  snapshot() {
    const c = this.car;
    return {
      index: this.index,
      position: c.position, rotation: c.rotation,
      linvel: c.linvel, angvel: c.angvel,
      speed: c.speed, groundSpeed: c.groundSpeed,
      forward: c.forward, up: c.up,
      tiltAngle: c.tiltAngle, wheelsInContact: c.wheelsInContact,
      airborne: this.airtimeTracker.airborne,
      airtime: this.airtimeTracker.airtime,
      maxHeight: this.airtimeTracker.maxHeight,
      boost: this.boost.value, boosting: this.boosting,
      thrustMode: this.thrust.mode, thrustActive: this.thrust.active,
      thrustLast: this.thrust.lastMode, burstsThisJump: this.thrust.burstsThisJump,
      panels: this.panels.snapshot(),
      prediction: this.airtimeTracker.prediction,
      lastLanding: this.lastLanding, lastLaunch: this.lastLaunch,
      lastResult: this.lastResult,
      driftTime: c.driftTime, slipAngle: c.slipAngle,
      // R7: what the audio and the particles need to know about how hard the
      // car is being worked, without either of them reaching into the sim.
      rotationRate: Math.hypot(c.angvel.x, c.angvel.y, c.angvel.z),
      panelsOut: this.panels.list.reduce((n, q) => Math.max(n, q.deploy), 0),
      impactVel: this.lastLanding ? this.lastLanding.impactVel : 0,
      liftClamp: this.aero.liftScale ?? 1,
      score: this.run.score, combo: this.run.combo, chain: this.run.chain,
      alive: this.run.alive,
      bank: this.airtimeTracker.airborne ? this.tricks.bank : 0,
      liveFacets: this.airtimeTracker.airborne ? (() => {
        const b = this.tricks._breakdown();
        return { count: b.facets.length, name: b.multName, mult: b.mult, purity: b.purity,
                 labels: b.facets.map((f) => f.label) };
      })() : null,
      coinsThisJump: this.tricks.coinsThisJump,
      coinsTaken: this.coinsTaken.size,
      calledTarget: this.calledTarget,
      recover: this.recover, respawns: this.respawns,
      oncoming: !!this.oncoming,
    };
  }
}

export default Player;
