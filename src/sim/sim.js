/**
 * Sim — the whole simulation, headless, for one to four cars.
 *
 * No three.js anywhere below this line. main.js drives it at a fixed rate and
 * reads `snapshot()` to draw; tools/*.mjs drive the identical code in node to
 * measure the things the gates claim.
 *
 * The Sim owns the world — arena, traffic, moving targets, coins, the clock —
 * and nothing else. Everything that belongs to a driver is on a Player, so
 * split-screen (§9) is four Players in one world rather than four worlds.
 */

import TUNING from '../TUNING.js';
import { initRapier, createWorld, RAPIER } from './physics.js';
import { buildArena } from './arena-body.js';
import { Player } from './player.js';
import { SLOTS } from './panels.js';
import { resolveTrick } from './tricks.js';
import { Round, RUN_STATE } from './round.js';
import { Telemetry } from './telemetry.js';
import { Traffic } from './traffic.js';
import { Movers } from './movers.js';
import { getMode } from './modes.js';
import { TIER } from '../arena/stunt-park.js';
import { rampSurface } from '../arena/index.js';

export { RUN_STATE };

export class Sim {
  static async create(setup = null, arenaId = 'park', opts = {}) {
    await initRapier();
    return new Sim(setup, arenaId, opts);
  }

  /**
   * @param setup    a resolved garage setup, or an array of them for split-screen
   * @param arenaId  'park' | 'city'
   * @param opts     { players, mode, duration }
   */
  constructor(setup = null, arenaId = 'park', opts = {}) {
    this.setup = Array.isArray(setup) ? setup[0] : setup;
    this.arenaId = arenaId;
    this.world = createWorld();

    const { park } = buildArena(this.world, arenaId);
    this.park = park;
    this.spawn = park.spawn || TUNING.ARENA.SPAWN;

    this.traffic = new Traffic(this.world, park);
    this.movers = new Movers(this.world, park);
    this.telemetry = new Telemetry();
    this.events = [];
    this.coinsTaken = new Set();

    const count = Math.max(1, Math.min(opts.players || 1, TUNING.MODES.PARTY.MAX_PLAYERS));
    this.mode = getMode(opts.mode || 'stunt');
    this.round = new Round(this.mode.id, opts.duration);

    const movingTargetAt = (p) => {
      const mv = this.movers.targetAt(p);
      if (mv) return { id: mv.id, tier: mv.tier };
      const car = this.traffic.roofAt(p);
      return car ? { id: `traffic_${car.id}`, tier: 'moving' } : null;
    };

    this.players = [];
    for (let i = 0; i < count; i++) {
      this.players.push(new Player(this.world, park, {
        setup: Array.isArray(setup) ? (setup[i] || setup[0]) : setup,
        index: i,
        round: this.round,
        // Line the grid up across the road, Rush-style, so nobody starts behind.
        spawn: this.gridSpawn(i, count),
        movingTargetAt,
      }));
    }

    this.time = 0;
    this.steps = 0;
    this._runEnded = false;
    this.modeState = null;
    if (this.mode.init) this.mode.init(this);
  }

  /** Starting grid: spread across the road, all on the same line. */
  gridSpawn(i, count) {
    const gap = TUNING.MODES.PARTY.GRID_GAP;
    const off = (i - (count - 1) / 2) * gap;
    return { x: this.spawn.x + off, y: this.spawn.y, z: this.spawn.z };
  }

  // ── Single-player conveniences ─────────────────────────────────────────
  // Everything below keeps the solo API natural: `sim.car`, `sim.run`, and so
  // on all mean player one, which is what every probe and the whole solo game
  // actually wants.
  get p0() { return this.players[0]; }
  get car() { return this.p0.car; }
  get panels() { return this.p0.panels; }
  get boost() { return this.p0.boost; }
  get thrust() { return this.p0.thrust; }
  get tricks() { return this.p0.tricks; }
  get aero() { return this.p0.aero; }
  get airtimeTracker() { return this.p0.airtimeTracker; }
  get run() { return this.p0.run; }
  get airborne() { return this.p0.airborne; }
  get airtime() { return this.p0.airtime; }
  get boosting() { return this.p0.boosting; }
  get lastLanding() { return this.p0.lastLanding; }
  get lastResult() { return this.p0.lastResult; }
  get respawns() { return this.players.reduce((a, p) => a + p.respawns, 0); }

  reset() {
    for (const p of this.players) p.reset();
    this.events.push({ type: 'reset' });
  }

  placeCar(pos = this.spawn, heading = TUNING.ARENA.SPAWN_HEADING) {
    this.p0.place(pos, heading);
  }

  /** A fresh round: clock, scores and coins all back to the start. */
  restartRun(mode = 'stunt', duration = undefined) {
    this.mode = getMode(mode);
    this.round = new Round(this.mode.id, duration);
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      p.run.round = this.round;
      p.run.index = i;
      p.run.reset();
      p.coinsTaken.clear();
      p.lives = undefined;
      p.calledTarget = null;
      p.launchCall = null;
      p.place(this.gridSpawn(i, this.players.length));
      p.reset();
    }
    this.coinsTaken.clear();
    this.traffic.reset();
    this.movers.reset();
    this.telemetry = new Telemetry();
    this._runEnded = false;
    this.modeState = null;
    if (this.mode.init) this.mode.init(this);
    this.events.push({ type: 'runStart', mode: this.mode.id, players: this.players.length });
  }

  /**
   * One fixed step.
   * @param dt      fixed timestep, seconds
   * @param actions a flat action object (solo) or an array, one per player
   * @param edges   one-shot presses, likewise
   */
  step(dt, actions, edges = {}) {
    const A = (i) => (Array.isArray(actions) ? actions[i] || {} : actions);
    const E = (i) => (Array.isArray(edges) ? edges[i] || {} : edges);

    if (E(0).reset) { this.reset(); return; }

    this.movers.update(dt);
    const signal = this.traffic.update(dt, this.players);
    for (const p of this.players) p.oncoming = signal.oncoming[p.index];
    if (signal.nearMiss.some(Boolean)) {
      this.events.push({ type: 'nearMiss', per: signal.nearMiss });
    }
    if (signal.honk) this.events.push({ type: 'honk' });

    for (const p of this.players) {
      const finished = p.preStep(dt, A(p.index), E(p.index), this.world);
      if (finished) this.telemetry.recordThrust(finished);
    }

    this.world.step();
    this.time += dt;
    this.steps++;

    this.round.update(dt);
    if (this.mode.update) this.mode.update(dt, this);

    for (const p of this.players) this._afterStep(dt, p, A(p.index));

    // §9 Last Car Standing can finish a round before the clock does.
    if (!this.round.over && this.mode.isOver && this.mode.isOver(this)) this.round.end();

    if (this.round.over && !this._runEnded) {
      this._runEnded = true;
      this.events.push({ type: 'runOver', summary: this.runSummary(), all: this.allSummaries() });
    }

    // Safety rail: nothing in the game can accelerate a car past this, so if it
    // trips a contact has gone bad and clamping beats launching to orbit.
    for (const p of this.players) {
      const v = p.car.body.linvel();
      const sp = Math.hypot(v.x, v.y, v.z);
      if (sp > TUNING.SIM.MAX_SPEED_CLAMP) {
        const k = TUNING.SIM.MAX_SPEED_CLAMP / sp;
        p.car.body.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
        this.events.push({ type: 'speedClamp', player: p.index, speed: sp });
      }
      if (p.car.position.y < TUNING.ARENA.RESET_HEIGHT) p.respawn(this.park, rampSurface);
    }
  }

  _afterStep(dt, p, actions) {
    // While a crash is playing out the car is not flying, and asking the
    // airtime tracker about it is how a car resting on its roof came to
    // resolve a fresh crash landing five times a second for the rest of the
    // round — 397 of them in one 90-second run.
    if (p.recover > 0) {
      p.airtimeTracker.reset();
      p.tricks.reset();
      p.pendingTrick = null;
      this._recovery(dt, p);
      return;
    }

    // §4: "traffic clipping you mid-air is a crash."
    if (TUNING.TRAFFIC.MIDAIR_CLIP_IS_CRASH && p.airtimeTracker.airborne && this._clipped(p)) {
      const crash = p.airtimeTracker.forceCrash(p.car, 'traffic');
      if (crash) this._bank(p, crash, true);
    }

    const ev = p.airtimeTracker.update(dt, p.car);
    p.run.update(dt);
    if (p.index === 0) this.telemetry.tick(dt, p.airtimeTracker.airborne);

    if (p.airtimeTracker.airborne) {
      p.tricks.update(dt, p.car, p.panels);
      this._collectCoins(p);
    }

    for (const s of SLOTS) {
      const now = p.panels.parts[s].deploy > 0.5;
      if (now && !p.wasDeployed[s]) {
        if (p.index === 0) this.telemetry.recordDeploy(s);
        this.events.push({ type: 'deploy', player: p.index, slot: s });
      }
      p.wasDeployed[s] = now;
    }

    if (ev.launch) {
      p.lastLaunch = ev.launch;
      p.thrust.onLaunch();
      p.tricks.onLaunch(p.car);
      if (this.mode.onLaunch) this.mode.onLaunch(p, ev.launch, this);
      this.events.push({ type: 'launch', player: p.index, launch: ev.launch });
    }
    if (ev.touchdown) {
      // Freeze the flight on the first touch only: a bounce fires another
      // touchdown inside the same settle window.
      if (!p.pendingTrick) p.pendingTrick = p.tricks.snapshot();
      const torn = p.panels.checkTearOff();
      if (torn.length) {
        if (p.index === 0) this.telemetry.recordTearOff(torn.length);
        this.events.push({ type: 'tearoff', player: p.index, slots: torn });
      }
      this.events.push({ type: 'touchdown', player: p.index });
    }
    if (ev.landed) this._bank(p, ev.landed, false);

    this._recovery(dt, p);
  }

  /** Resolve a finished flight into score, through whatever the mode says. */
  _bank(p, landing, clipped) {
    p.lastLanding = landing;
    if (p.index === 0) this.telemetry.recordLanding(landing);

    const tierMult = clipped ? 1 : (TIER[landing.tier] || TIER.road).mult;
    const snap = p.pendingTrick || p.tricks.snapshot();
    p.pendingTrick = null;
    let result = resolveTrick(snap, landing, tierMult, p.run.nextCombo);
    result.player = p.index;
    if (this.mode.onLanded) result = this.mode.onLanded(p, result, this) || result;

    p.run.addLanding(result);
    p.lastResult = result;
    this.events.push({ type: 'landed', player: p.index, landing, result, clipped });
    if (!result.landed) p.recover = TUNING.RESPAWN.DELAY;
  }

  _recovery(dt, p) {
    const R = TUNING.RESPAWN;
    if (!this.round.running) { p.recover = 0; p.stuck = 0; return; }
    const wrongWayUp = p.car.tiltAngle > R.STUCK_TILT;
    const slow = p.car.speed < R.STUCK_SPEED;
    p.stuck = (wrongWayUp && slow) ? p.stuck + dt : 0;
    if (p.stuck > R.STUCK_TIME && p.recover <= 0) p.recover = R.DELAY;
    if (p.recover > 0) {
      p.recover -= dt;
      if (p.recover <= 0) {
        // Eliminated players stay where they crashed; there is nothing to
        // come back to (§9 Last Car Standing).
        if (p.run.alive) {
          const r = p.respawn(this.park, rampSurface);
          this.events.push({ type: 'respawn', player: p.index, ...r });
        }
      }
    }
  }

  _clipped(p) {
    let hit = false;
    this.world.contactPairsWith(p.car.collider, (other) => {
      if (hit || !this.traffic.isTrafficCollider(other)) return;
      this.world.contactPair(p.car.collider, other, (m) => {
        for (let i = 0; i < m.numContacts(); i++) {
          if (m.contactDist(i) < TUNING.AIRTIME.CHASSIS_CRASH_DEPTH) { hit = true; return; }
        }
      });
    });
    return hit;
  }

  /** Coins are flat score on authored lines (§3.1). First come, first served. */
  _collectCoins(p) {
    const r2 = TUNING.SCORE.COIN_RADIUS * TUNING.SCORE.COIN_RADIUS;
    const pos = p.car.position;
    for (const c of this.park.coins) {
      if (this.coinsTaken.has(c.id)) continue;
      const dx = c.pos.x - pos.x, dy = c.pos.y - pos.y, dz = c.pos.z - pos.z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      this.coinsTaken.add(c.id);
      p.coinsTaken.add(c.id);
      p.tricks.collectCoin();
      this.events.push({ type: 'coin', player: p.index, id: c.id, pos: c.pos });
    }
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  runSummary(i = 0) {
    const p = this.players[i];
    const t = this.telemetry.thrustBursts;
    return p.run.summary({
      thrustBursts: t.extend + t.correct + t.dive,
      coins: p.coinsTaken.size,
      nearMisses: this.traffic.nearMisses,
    });
  }

  allSummaries() { return this.players.map((_, i) => this.runSummary(i)); }

  /** Everything the renderer and HUD need, as plain data. */
  snapshot() {
    const p0 = this.p0.snapshot();
    return {
      ...p0,
      time: this.time,
      players: this.players.map((p) => p.snapshot()),
      playerCount: this.players.length,
      runState: this.round.state,
      countdown: this.round.countdown,
      timeLeft: this.round.timeLeft,
      mode: this.mode.id,
      zone: this.modeState && this.modeState.zone ? this.modeState.zone : null,
      traffic: this.traffic.snapshot(),
      movers: this.movers.snapshot(),
      arena: this.arenaId,
      coinsTaken: this.coinsTaken.size,
      nearMisses: this.traffic.nearMisses,
      heightAboveGround: this.p0.airtimeTracker.heightAboveGround(this.car),
      respawns: this.respawns,
    };
  }
}

export default Sim;
