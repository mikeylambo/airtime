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
import { buildArena, targetAt } from './arena-body.js';
import { Player } from './player.js';
import { SLOTS } from './panels.js';
import { resolveTrick } from './tricks.js';
import { matchGap } from '../arena/gaps.js';
import { Round, RUN_STATE } from './round.js';
import { Telemetry } from './telemetry.js';
import { Traffic } from './traffic.js';
import { Movers } from './movers.js';
import { Props } from './props.js';
import { getMode } from './modes.js';
import { neutralActions } from './replay.js';
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
    // Gaps discovered this session. The profile holds the permanent record;
    // this is what makes the first crossing of a run read as a discovery.
    this.gapsKnown = new Set(opts.gapsKnown || []);
    this.world = createWorld();

    const { park } = buildArena(this.world, arenaId);
    this.park = park;
    this.spawn = park.spawn || TUNING.ARENA.SPAWN;

    this.traffic = new Traffic(this.world, park);
    this.movers = new Movers(this.world, park);
    this.props = new Props(this.world, park);
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
        // Line the grid up across the road so nobody starts behind.
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

  /**
   * A fresh round: clock, scores and coins all back to the start.
   *
   * §R: a round started with an explicit seed rerolls traffic reproducibly,
   * and the recorder writes that seed down so a clip can put the world back
   * exactly. Without a seed the reroll continues the sequence as it always
   * has — the capture rig and every probe run that way, and their bit-for-bit
   * agreement must not depend on knowing any of this exists.
   */
  restartRun(mode = 'stunt', duration = undefined, seed = undefined) {
    this.roundSeed = seed === undefined ? null : (seed >>> 0);
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
    this.moverNearMisses = 0;
    this.traffic.reset(this.roundSeed ?? undefined);
    this.movers.reset();
    this.props.reset();
    this.telemetry = new Telemetry();
    this._runEnded = false;
    this.modeState = null;
    if (this.mode.init) this.mode.init(this);
    this.events.push({ type: 'runStart', mode: this.mode.id, players: this.players.length });
  }

  /**
   * §R: put the world back where a recording started — the recorded reroll
   * seed, then the countdown played out hands-off, because the input stream
   * only begins when the round does.
   *
   * Only valid on a *fresh* world. Restarting a used one measures ~240 m of
   * trajectory divergence over 25 s (probe-replay): Rapier keeps contact and
   * joint warm-start caches that no amount of teleporting clears, so a
   * rewind has to rebuild the world, not reset it.
   */
  replayStart(meta = {}) {
    this.restartRun(meta.mode || 'stunt', meta.duration, meta.seed);
    const dt = 1 / TUNING.SIM.HZ;
    const neutral = this.players.map(() => neutralActions());
    while (!this.round.running) this.step(dt, neutral);
    this.drainEvents();
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

    const moverSignal = this.movers.update(dt, this.players);
    this.moverNearMisses = (this.moverNearMisses || 0)
      + moverSignal.nearMiss.reduce((a, n) => a + n, 0);
    const signal = this.traffic.update(dt, this.players);
    // A helicopter you nearly hit is a near miss like any other, so it lands
    // in the same signal and pays through the same facet.
    for (let i = 0; i < signal.nearMiss.length; i++) {
      if (moverSignal.nearMiss[i]) {
        signal.nearMiss[i] += moverSignal.nearMiss[i];
        this.players[i].boost.creditNearMiss(moverSignal.nearMiss[i]);
      }
    }
    // R7 breakables. Above a threshold they wake into dynamic bodies and are
    // thrown; below it nothing moves at all, because a bollard that twitches
    // when you brush it promises physics it is not running.
    for (const b of this.props.update(dt, this.players)) {
      this.events.push({ type: 'prop', ...b });
    }
    this.trafficSignal = signal;
    for (const p of this.players) p.oncoming = signal.oncoming[p.index];
    if (signal.nearMiss.some(Boolean)) {
      this.players.forEach((p, i) => { if (signal.nearMiss[i]) p.tricks.creditNearMiss(signal.nearMiss[i]); });
      this.events.push({ type: 'nearMiss', per: signal.nearMiss });
    }
    if (signal.honk) this.events.push({ type: 'honk' });

    for (const p of this.players) {
      const finished = p.preStep(dt, A(p.index), E(p.index), this.world);
      if (finished) {
        this.telemetry.recordThrust(finished);
        // Purity counts the stabilising verbs, and a burst is the loudest one.
        p.tricks.creditThrust();
      }
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
      p.climbBase = null;
    } else {
      p.tricks.updateGround(dt, p.car);
      // A drift held on the wheels and never launched out of is still a LINE —
      // it banks the moment the slide closes. Dormant until the physics can hold
      // a drift (gated on the drift facet); returns null every frame until then.
      const line = p.tricks.closeGroundLine();
      if (line) this._bankGroundLine(p, line);
      // A continuous climb on the wheels. The base resets the moment the car
      // is airborne, so twenty-eight metres of this means a spiral flyover
      // rather than a lucky landing on a roof.
      const y = p.car.position.y;
      if (p.climbBase === null || y < p.climbBase) p.climbBase = y;
      if (y - p.climbBase > p.groundClimb) p.groundClimb = y - p.climbBase;
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
      // Anything above the deck counts as launching high, for GAP.
      p.launchedHigh = ev.launch.position.y > TUNING.SCORE.FACET.GAP_LAUNCH_Y;
      p.thrust.onLaunch();
      p.tricks.onLaunch(p.car);
      if (this.mode.onLaunch) this.mode.onLaunch(p, ev.launch, this);
      this.events.push({ type: 'launch', player: p.index, launch: ev.launch });
    }
    if (ev.touchdown) {
      // Freeze the flight on the first touch only: a bounce fires another
      // touchdown inside the same settle window.
      if (!p.pendingTrick) {
        // GAP: left raised ground and arrived on raised ground. TRANSFER:
        // arrived somewhere authored that is not the deck.
        const t = this.movers.targetAt(p.car.position) || targetAt(this.park, p.car.position);
        p.pendingTrick = p.tricks.snapshot({
          gap: p.launchedHigh && !!t,
          transfer: !!t && t.tier !== 'road',
        });
      }
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
    // Where the flight began and where it ended, carried onto the result.
    // Modes and challenges both ask "what did you land on", and until now
    // only the raw landing record knew — which is why Call Your Shot's
    // multiplier compared `result.target` against a call and never once
    // matched.
    result.target = landing.target ?? null;
    result.from = landing.from || null;
    result.landedAt = landing.landedAt || null;
    if (this.mode.onLanded) result = this.mode.onLanded(p, result, this) || result;

    // A named gap pays only if you actually completed the flight. Crashing
    // across one is a story, not a score.
    if (result.landed && landing.from && landing.landedAt) {
      const gap = matchGap(this.arenaId, landing.from, landing.landedAt);
      if (gap) {
        const first = !this.gapsKnown.has(gap.id);
        this.gapsKnown.add(gap.id);
        if (!p.run.gaps) p.run.gaps = [];
        p.run.gaps.push({ id: gap.id, name: gap.name, first });
        const bonus = first ? TUNING.GAPS.FIRST_BONUS : TUNING.GAPS.BONUS;
        result.gap = { id: gap.id, name: gap.name, first, bonus };
        result.payout += bonus;
        result.total += bonus;
        this.events.push({ type: 'gap', player: p.index, gap: result.gap });
      }
    }

    // R7: paint. A crash scuffs hard, a heavy stick scuffs a little, and a
    // clean one leaves nothing — the severity is the impact the landing
    // record already measured.
    const sev = Math.min(1, (landing.impactVel || 0) / TUNING.FX.LANDING_SHAKE);
    p.scuff(result.landed ? sev * 0.45 : Math.max(0.5, sev), landing.landedAt
      ? { x: p.car.linvel.x, y: p.car.linvel.y, z: p.car.linvel.z } : null);

    p.run.addLanding(result);
    p.lastResult = result;
    this.events.push({ type: 'landed', player: p.index, landing, result, clipped });
    if (!result.landed) p.recover = TUNING.RESPAWN.DELAY;
  }

  /**
   * Bank a pure-ground LINE (a drift that never launched — tricks.closeGroundLine).
   * It has no aerial landing, so it resolves against a fixed ground-line
   * multiplier and skips the gap/tier/scuff machinery a jump goes through. It
   * still lands (extends the chain) so a ground line reads as one continuous
   * performance with the jumps around it.
   */
  _bankGroundLine(p, snap) {
    const landing = { quality: 'clean', multiplier: TUNING.SCORE.GROUND_LINE_MULT, tier: 'road' };
    const result = resolveTrick(snap, landing, 1, p.run.nextCombo);
    result.player = p.index;
    result.groundLine = true;
    p.run.addLanding(result);
    p.lastResult = result;
    this.events.push({ type: 'groundLine', player: p.index, result });
    return result;
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
      nearMisses: this.traffic.nearMisses + (this.moverNearMisses || 0),
      // Split out, because "did you pass the helicopter" is a different
      // question from "did you thread traffic", and R9 asks both.
      moverNearMisses: this.moverNearMisses || 0,
      respawns: p.respawns,
      // The most altitude gained without ever leaving the ground. In The Yard
      // this is a bank; in Vertical City it is the only way to answer "did
      // you drive the Coil" without teaching the sim what a Coil is.
      groundClimb: p.groundClimb || 0,
      gaps: p.run.gaps || [],
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
      props: this.props.snapshot(),
      arena: this.arenaId,
      coinsTaken: this.coinsTaken.size,
      nearMisses: this.traffic.nearMisses,
      heightAboveGround: this.p0.airtimeTracker.heightAboveGround(this.car),
      respawns: this.respawns,
    };
  }
}

export default Sim;
