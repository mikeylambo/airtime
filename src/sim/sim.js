/**
 * Sim — the whole simulation, headless.
 *
 * No three.js anywhere below this line. main.js drives it at a fixed rate and
 * reads `snapshot()` to draw; tools/*.mjs drive the identical code in node to
 * measure the things Gate A claims. When the state-based replay of §6.1 lands,
 * it plugs in here: same seed, same fixed dt, same action stream.
 */

import TUNING from '../TUNING.js';
import { initRapier, createWorld, RAPIER } from './physics.js';
import { buildArena } from './arena-body.js';
import { Car } from './car.js';
import { Panels, SLOTS } from './panels.js';
import { BoostBar } from './boost.js';
import { TeaseThrust, THRUST_MODE } from './thrust.js';
import { AirtimeTracker } from './airtime.js';
import { Telemetry } from './telemetry.js';
import { AeroAccumulator, applyAngularDrag } from './aero.js';
import { add, qRot, v3, len } from './mathx.js';

export class Sim {
  static async create() {
    await initRapier();
    return new Sim();
  }

  constructor() {
    this.world = createWorld();
    const { park } = buildArena(this.world);
    this.park = park;

    this.car = new Car(this.world);
    this.car.reset();
    this.panels = new Panels(this.world, this.car);
    this.panels.syncToChassis();

    this.boost = new BoostBar();
    this.thrust = new TeaseThrust(this.car, this.boost);
    this.airtimeTracker = new AirtimeTracker(this.world, park);
    this.telemetry = new Telemetry();
    this.aero = new AeroAccumulator();

    this.time = 0;
    this.steps = 0;
    this.events = [];          // drained by main.js each render frame
    this.lastLanding = null;
    this.lastLaunch = null;
    this.boosting = false;
    this.wasDeployed = {};
    for (const s of SLOTS) this.wasDeployed[s] = false;
  }

  get airborne() { return this.airtimeTracker.airborne; }
  get airtime() { return this.airtimeTracker.airtime; }

  reset() {
    this.car.reset();
    this.panels.restoreAll();
    this.panels.reset();
    this.boost.reset();
    this.thrust.reset();
    this.airtimeTracker.reset();
    this.events.push({ type: 'reset' });
  }

  /**
   * One fixed step.
   * @param dt      fixed timestep, seconds
   * @param actions flat action object from src/input
   * @param edges   one-shot presses: { thrust, reset }
   */
  step(dt, actions, edges = {}) {
    const airborne = this.airtimeTracker.airborne;

    if (edges.reset) { this.reset(); return; }

    this.boosting = this.boost.update(dt, { car: this.car, actions, airborne });
    this.car.update(dt, actions, this.boosting);
    this.panels.update(dt, actions, airborne);

    // ── Aero: chassis + every attached panel, then the lift clamp ──────────
    const A = TUNING.AERO;
    this.aero.begin();
    this.aero.addBoxPlates(
      this.car.body, this.car.rotation, this.car.position,
      TUNING.CAR.HALF, A.CHASSIS_CD, A.CHASSIS_SCALE
    );
    // Panel drag scales with how far the part is actually deployed. A stowed
    // panel is flush with the bodywork and its area is already counted by the
    // chassis box above — charging for it twice, at 5.4x the chassis gain, was
    // enough to backflip the car on a neutral jump with no input at all.
    for (const p of this.panels.list) {
      if (p.deploy < 0.02) continue;
      const target = A.APPLY_TO === 'chassis' ? this.car.body : p.body;
      this.aero.addPlate(
        p.body, p.body.rotation(), p.body.translation(), p.cfg.size,
        p.cfg.cd, A.PANEL_SCALE * (p.cfg.gain ?? 1) * p.deploy, target
      );
    }
    this.aero.apply(dt, this.car.body.mass(), TUNING.SIM.GRAVITY);

    const finished = this.thrust.update(dt, {
      actions, airborne, pressedThrust: !!edges.thrust,
    });
    if (finished) this.telemetry.recordThrust(finished);

    this.panels.applySpoiler(dt);
    applyAngularDrag(this.car.body, dt);

    this.world.step();
    this.time += dt;
    this.steps++;

    // ── Events ─────────────────────────────────────────────────────────────
    const ev = this.airtimeTracker.update(dt, this.car);
    this.telemetry.tick(dt, this.airtimeTracker.airborne);

    for (const s of SLOTS) {
      const now = this.panels.parts[s].deploy > 0.5;
      if (now && !this.wasDeployed[s]) {
        this.telemetry.recordDeploy(s);
        this.events.push({ type: 'deploy', slot: s });
      }
      this.wasDeployed[s] = now;
    }

    if (ev.launch) {
      this.lastLaunch = ev.launch;
      this.thrust.onLaunch();
      this.events.push({ type: 'launch', launch: ev.launch });
    }
    if (ev.touchdown) {
      const torn = this.panels.checkTearOff();
      if (torn.length) {
        this.telemetry.recordTearOff(torn.length);
        this.events.push({ type: 'tearoff', slots: torn });
      }
      this.events.push({ type: 'touchdown' });
    }
    if (ev.landed) {
      this.lastLanding = ev.landed;
      this.telemetry.recordLanding(ev.landed);
      this.events.push({ type: 'landed', landing: ev.landed });
    }

    // Safety rail (TUNING.SIM.MAX_SPEED_CLAMP). Physics, not design: nothing
    // in the game can accelerate the car past this, so if it trips, a contact
    // has gone bad and clamping is strictly better than launching to orbit.
    const v = this.car.body.linvel();
    const sp = Math.hypot(v.x, v.y, v.z);
    if (sp > TUNING.SIM.MAX_SPEED_CLAMP) {
      const k = TUNING.SIM.MAX_SPEED_CLAMP / sp;
      this.car.body.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
      this.events.push({ type: 'speedClamp', speed: sp });
    }

    if (this.car.position.y < TUNING.ARENA.RESET_HEIGHT) this.reset();
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Everything the renderer and HUD need, as plain data. */
  snapshot() {
    const c = this.car;
    return {
      time: this.time,
      position: c.position,
      rotation: c.rotation,
      linvel: c.linvel,
      angvel: c.angvel,
      speed: c.speed,
      groundSpeed: c.groundSpeed,
      forward: c.forward,
      up: c.up,
      tiltAngle: c.tiltAngle,
      wheelsInContact: c.wheelsInContact,
      airborne: this.airtimeTracker.airborne,
      airtime: this.airtimeTracker.airtime,
      maxHeight: this.airtimeTracker.maxHeight,
      heightAboveGround: this.airtimeTracker.heightAboveGround(c),
      boost: this.boost.value,
      boosting: this.boosting,
      thrustMode: this.thrust.mode,
      thrustActive: this.thrust.active,
      thrustLast: this.thrust.lastMode,
      burstsThisJump: this.thrust.burstsThisJump,
      panels: this.panels.snapshot(),
      prediction: this.airtimeTracker.prediction,
      lastLanding: this.lastLanding,
      lastLaunch: this.lastLaunch,
      driftTime: c.driftTime,
      slipAngle: c.slipAngle,
      liftClamp: this.aero.liftScale ?? 1,
    };
  }
}

export default Sim;
