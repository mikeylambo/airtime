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
import { Traffic } from './traffic.js';
import { Movers } from './movers.js';
import { AeroAccumulator, applyAngularDrag } from './aero.js';
import { TrickTracker, resolveTrick } from './tricks.js';
import { Run, RUN_STATE } from './run.js';
import { TIER } from '../arena/stunt-park.js';
import { add, qRot, v3, len, qAxisAngle, WORLD_UP } from './mathx.js';
import { rampSurface } from '../arena/index.js';

export class Sim {
  static async create(setup = null, arenaId = 'park') {
    await initRapier();
    return new Sim(setup, arenaId);
  }

  constructor(setup = null, arenaId = 'park') {
    this.setup = setup;
    this.arenaId = arenaId;
    this.world = createWorld();
    const { park } = buildArena(this.world, arenaId);
    this.park = park;
    this.spawn = park.spawn || TUNING.ARENA.SPAWN;

    this.car = new Car(this.world, setup);
    this.car.reset(this.spawn);
    this.panels = new Panels(this.world, this.car, setup);
    this.panels.syncToChassis();

    this.boost = new BoostBar(setup);
    this.thrust = new TeaseThrust(this.car, this.boost, setup);
    this.traffic = new Traffic(this.world, park);
    this.movers = new Movers(this.world, park);
    // §4 traffic roofs and §6.2 moving targets are both "landed on something
    // that is moving"; the tracker just asks and takes whichever answers.
    this.airtimeTracker = new AirtimeTracker(this.world, park, (p) => {
      const mv = this.movers.targetAt(p);
      if (mv) return { id: mv.id, tier: mv.tier };
      const car = this.traffic.roofAt(p);
      return car ? { id: `traffic_${car.id}`, tier: 'moving' } : null;
    });
    this.telemetry = new Telemetry();
    this.aero = new AeroAccumulator();
    this.tricks = new TrickTracker();
    this.run = new Run('stunt');
    this.coinsTaken = new Set();

    this.time = 0;
    this.steps = 0;
    this.events = [];          // drained by main.js each render frame
    this.lastLanding = null;
    this.lastLaunch = null;
    this.boosting = false;
    this._runEnded = false;
    this.recover = 0;
    this.stuck = 0;
    this.respawns = 0;
    this.wasDeployed = {};
    for (const s of SLOTS) this.wasDeployed[s] = false;
  }

  get airborne() { return this.airtimeTracker.airborne; }
  get airtime() { return this.airtimeTracker.airtime; }

  reset() {
    this.car.reset(this.spawn);
    this.panels.restoreAll();
    this.panels.reset();
    this.boost.reset();
    this.thrust.reset();
    this.airtimeTracker.reset();
    this.tricks.reset();
    this.events.push({ type: 'reset' });
  }

  /**
   * Move the car somewhere, panels and all.
   *
   * Never call car.reset() on its own: the panels are separate bodies on
   * joints, so teleporting the chassis without them leaves the hinges stretched
   * across the arena and the solver rips the car apart at 300 m/s.
   */
  placeCar(pos = this.spawn, heading = TUNING.ARENA.SPAWN_HEADING) {
    this.car.reset(pos, heading);
    this.panels.syncToChassis();
    this.airtimeTracker.reset();
    this.tricks.reset();
  }

  /** A fresh run: clock, score and coins all back to the start. */
  restartRun(mode = 'stunt', duration = undefined) {
    this.run = new Run(mode, duration);
    this.coinsTaken.clear();
    this.traffic.reset();
    this.reset();
    this.events.push({ type: 'runStart', mode });
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

    this.movers.update(dt);
    const t = this.traffic.update(dt, this.car, this.boost);
    this.trafficSignal = t;
    if (t.nearMiss) this.events.push({ type: 'nearMiss', n: t.nearMiss });
    if (t.honk) this.events.push({ type: 'honk' });

    this.boosting = this.boost.update(dt, {
      car: this.car, actions, airborne, oncoming: t.oncoming,
    });
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
        p.cfg.cd, A.PANEL_SCALE * this._panelGain(p.slot) * p.deploy, target
      );
    }
    this.aero.apply(dt, this.car.body.mass(), TUNING.SIM.GRAVITY);

    const finished = this.thrust.update(dt, {
      actions, airborne, pressedThrust: !!edges.thrust,
    });
    if (finished) this.telemetry.recordThrust(finished);

    this.panels.applySpoiler(dt);
    applyAngularDrag(this.car.body, dt, this.setup ? this.setup.chassisAngDrag : null);

    this.world.step();
    this.time += dt;
    this.steps++;

    // ── Events ─────────────────────────────────────────────────────────────
    // §4: "traffic clipping you mid-air is a crash."
    if (TUNING.TRAFFIC.MIDAIR_CLIP_IS_CRASH && this.airtimeTracker.airborne && this._clippedByTraffic()) {
      const crash = this.airtimeTracker.forceCrash(this.car, 'traffic');
      if (crash) {
        const snap = this.pendingTrick || this.tricks.snapshot();
        this.pendingTrick = null;
        const result = resolveTrick(snap, crash, 1, this.run.nextCombo);
        this.run.addLanding(result);
        this.lastLanding = crash;
        this.lastResult = result;
        this.telemetry.recordLanding(crash);
        this.events.push({ type: 'landed', landing: crash, result, clipped: true });
        this.requestRespawn();
      }
    }

    const ev = this.airtimeTracker.update(dt, this.car);
    this.telemetry.tick(dt, this.airtimeTracker.airborne);
    this.run.update(dt);
    if (this.airtimeTracker.airborne) {
      this.tricks.update(dt, this.car, this.panels);
      this._collectCoins();
    }

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
      this.tricks.onLaunch(this.car);
      this.events.push({ type: 'launch', launch: ev.launch });
    }
    if (ev.touchdown) {
      // Freeze the flight on the *first* touch only. A bounce fires another
      // touchdown inside the same settle window, and overwriting here banked
      // the bounce instead of the flight that earned it.
      if (!this.pendingTrick) this.pendingTrick = this.tricks.snapshot();
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

      // §3.1: the bank is only worth anything once it is landed.
      const tierMult = (TIER[ev.landed.tier] || TIER.road).mult;
      const snap = this.pendingTrick || this.tricks.snapshot();
      this.pendingTrick = null;
      const result = resolveTrick(snap, ev.landed, tierMult, this.run.nextCombo);
      this.run.addLanding(result);
      this.lastResult = result;
      this.events.push({ type: 'landed', landing: ev.landed, result });
      if (!result.landed) this.requestRespawn();
    }

    if (this.run.over && !this._runEnded) {
      this._runEnded = true;
      this.events.push({ type: 'runOver', summary: this.runSummary() });
    }

    this._updateRecovery(dt);

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

  /** Per-panel aero gain, from the garage setup when there is one (§7). */
  _panelGain(slot) {
    if (this.setup) return this.setup.panels[slot].gain;
    return TUNING.PANELS[slot].gain ?? 1;
  }

  _clippedByTraffic() {
    let hit = false;
    this.world.contactPairsWith(this.car.collider, (other) => {
      if (hit || !this.traffic.isTrafficCollider(other)) return;
      this.world.contactPair(this.car.collider, other, (m) => {
        for (let i = 0; i < m.numContacts(); i++) {
          if (m.contactDist(i) < TUNING.AIRTIME.CHASSIS_CRASH_DEPTH) { hit = true; return; }
        }
      });
    });
    return hit;
  }

  /** Coins are flat score on authored lines (§3.1), collected in the air. */
  _collectCoins() {
    const r2 = TUNING.SCORE.COIN_RADIUS * TUNING.SCORE.COIN_RADIUS;
    const p = this.car.position;
    for (const c of this.park.coins) {
      if (this.coinsTaken.has(c.id)) continue;
      const dx = c.pos.x - p.x, dy = c.pos.y - p.y, dz = c.pos.z - p.z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      this.coinsTaken.add(c.id);
      this.tricks.collectCoin();
      this.events.push({ type: 'coin', id: c.id, pos: c.pos });
    }
  }

  /**
   * Put the player back on the road after a crash, or after getting wedged.
   *
   * Respawning at the arena spawn would cost most of a 90 second round in
   * driving back, so this drops you on the approach to the nearest ramp,
   * already rolling and pointed at it.
   */
  _updateRecovery(dt) {
    const R = TUNING.RESPAWN;
    if (!this.run.running) { this.recover = 0; this.stuck = 0; return; }

    // Wedged: upside down or on a wall, going nowhere.
    const wrongWayUp = this.car.tiltAngle > R.STUCK_TILT;
    const slow = this.car.speed < R.STUCK_SPEED;
    this.stuck = (wrongWayUp && slow) ? this.stuck + dt : 0;
    if (this.stuck > R.STUCK_TIME && this.recover <= 0) this.recover = R.DELAY;

    if (this.recover > 0) {
      this.recover -= dt;
      if (this.recover <= 0) this.respawn();
    }
  }

  /** Called by the crash path and by the stuck detector. */
  requestRespawn(delay = TUNING.RESPAWN.DELAY) {
    if (this.recover <= 0) this.recover = delay;
  }

  respawn() {
    const R = TUNING.RESPAWN;
    const p = this.car.position;

    // Nearest ramp, and the point on its approach the car should land back on.
    let best = null, bestD = Infinity;
    for (const r of this.park.ramps) {
      if (r.id === 'garage') continue;
      const d = Math.hypot(r.pos.x - p.x, r.pos.z - p.z);
      if (d < bestD) { bestD = d; best = r; }
    }

    let pos = { ...this.spawn };
    let heading = TUNING.ARENA.SPAWN_HEADING;
    if (best) {
      // A ramp faces -Z in its own frame, so its approach is +Z, rotated by yaw.
      const s = Math.sin(best.yaw), c = Math.cos(best.yaw);
      const back = rampSurface(best).zMax + R.APPROACH;
      pos = { x: best.pos.x + s * back, y: 1.2, z: best.pos.z + c * back };
      heading = best.yaw;
    }

    this.placeCar(pos, heading);
    // Rolling restart: standing still 60 m from a ramp is its own punishment.
    const fwd = qRot(qAxisAngle(WORLD_UP, heading), { x: 0, y: 0, z: -1 });
    this.car.body.setLinvel({ x: fwd.x * R.SPEED, y: 0, z: fwd.z * R.SPEED }, true);
    this.panels.restoreAll();
    this.panels.reset();
    this.stuck = 0;
    this.recover = 0;
    this.respawns++;
    this.events.push({ type: 'respawn', pos, ramp: best ? best.id : null });
  }

  /** The run summary, plus the run-level counters the licences read. */
  runSummary() {
    const t = this.telemetry.thrustBursts;
    return this.run.summary({
      thrustBursts: t.extend + t.correct + t.dive,
      coins: this.coinsTaken.size,
      nearMisses: this.traffic.nearMisses,
    });
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
      lastResult: this.lastResult || null,

      // Run + scoring (§3.1, §3)
      runState: this.run.state,
      countdown: this.run.countdown,
      timeLeft: this.run.timeLeft,
      score: this.run.score,
      combo: this.run.combo,
      chain: this.run.chain,
      bank: this.airtimeTracker.airborne ? this.tricks.bank : 0,
      liveTricks: this.airtimeTracker.airborne ? this.tricks._breakdown().tricks : [],
      coinsThisJump: this.tricks.coinsThisJump,
      coinsTaken: this.coinsTaken.size,
      recover: this.recover,
      respawns: this.respawns,
      traffic: this.traffic.snapshot(),
      movers: this.movers.snapshot(),
      arena: this.arenaId,
      nearMisses: this.traffic.nearMisses,
      oncoming: !!(this.trafficSignal && this.trafficSignal.oncoming),
      driftTime: c.driftTime,
      slipAngle: c.slipAngle,
      liftClamp: this.aero.liftScale ?? 1,
    };
  }
}

export default Sim;
