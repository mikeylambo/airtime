/**
 * AIRTIME — bootstrap, the main loop, and the run/menu state machine.
 *
 * The simulation runs on a fixed timestep and the renderer is decoupled from
 * it, which is what lets tools/capture.mjs drive the same code frame by frame
 * and get the identical jump every time.
 *
 * The 3D world renders continuously, menus included: §2.1 asks for no loading
 * screens between menu nodes, and the cheapest way to keep that promise is to
 * never tear the world down.
 */

import './ui/ui.css';
import * as THREE from 'three';
import TUNING from './TUNING.js';
import { Sim } from './sim/sim.js';
import { RAPIER, WHEEL_RAY_GROUPS } from './sim/physics.js';
import { RUN_STATE } from './sim/run.js';
import { Input, NEUTRAL_ACTIONS } from './input/input.js';
import { createScene } from './render/scene.js';
import { ArtDirector, STYLES } from './render/art.js';
import { buildArenaView } from './render/arena-view.js';
import { buildCarView } from './render/car-view.js';
import { Fx } from './render/fx.js';
import { Trails } from './render/trails.js';
import { buildTrafficView } from './render/traffic-view.js';
import { CameraDirector, BEHAVIOR } from './render/camera-rig.js';
import { Viewports } from './render/viewports.js';
import { SplitHud } from './ui/split-hud.js';
import { Hud } from './ui/hud.js';
import { ScreenManager } from './ui/screens.js';
import { buildFrame, MODES, ARENAS } from './ui/frame.js';
import { demoActions, demoEdges, DEMO_CLIP } from './demo-jump.js';
import { loopActions, loopEdges, LOOP_CLIP } from './loop-demo.js';
import { loadOptions, saveOptions } from './storage/storage.js';
import { Audio } from './audio/audio.js';
import { loadAll, saveAll, activeSlot, setActiveSlot, recordRun } from './storage/profiles.js';
import { resolveSetup } from './sim/cars.js';
import { Recorder, Player } from './sim/replay.js';
import { loadClips, saveClip, wallClips } from './storage/clips.js';
import { LICENCES, evaluate, licenceRank } from './game/licences.js';
import { Board, dailyVariant, todayKey } from './game/daily.js';
import { simVersion } from './sim/version.js';
import { setColorblind, playerColorCss } from './render/theme.js';

const DT = 1 / TUNING.SIM.HZ;

class Game {
  constructor(canvas, hudRoot, screenRoot) {
    this.canvas = canvas;
    this.hudRoot = hudRoot;
    this.screenRoot = screenRoot;
    this.mode = 'play';            // 'play' | 'demo'
    this.demoT = 0;
    this.demoLaunchT = null;
    this.accum = 0;
    this.last = 0;
    this.running = false;
    this.edges = {};
    this.inRun = false;
    this.idle = 0;
    this.replays = [];
    this.timeScale = 1;
    this.crash = 0;
    this.licences = LICENCES;
    this.licence = null;
    this.lastSummary = null;
  }

  async init() {
    this.sim = await Sim.create();

    const { renderer, scene, camera, resize } = createScene(this.canvas);
    Object.assign(this, { renderer, scene, camera, resize });

    this.options = loadOptions();
    TUNING.CAMERA.STYLE = this.options.cameraStyle;
    TUNING.HUD.SHOW_TELEMETRY = this.options.showTelemetry;
    TUNING.TRAFFIC.MODE = this.options.traffic;
    // The colourblind option swaps the whole player palette (release spec
    // §A), so it is set before anything player-coloured is built.
    setColorblind(this.options.colorblindTrails);
    document.documentElement.style.setProperty('--p1', playerColorCss(0));

    this.art = new ArtDirector(scene, renderer);
    this.arenaView = buildArenaView(scene, this.art, 'park');
    const park = this.arenaView.park;
    this.carViews = [buildCarView(scene, this.art, 0)];
    // R7. Particles are a response to the simulation, so they live next to the
    // car views and are driven from the same snapshot and event stream.
    this.fx = new Fx(scene, this.art);
    // AFTERGLOW's smear: ribbons, persistent lines, ghosts, splashes.
    this.trails = new Trails(scene);
    this.trails.setOptions({
      reduceEffects: !!this.options?.reduceEffects,
      colorblind: !!this.options?.colorblindTrails,
    });
    this._fxRand = (() => { let s = 0x9e3779b9; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
    this.carView = this.carViews[0];
    this.trafficView = buildTrafficView(scene, this.art);
    this.art.setStyle(this.options.artStyle || TUNING.RENDER.STYLE);

    const down = { x: 0, y: -1, z: 0 };
    const probeGround = (x, z) => {
      const hit = this.sim.world.castRay(
        new RAPIER.Ray({ x, y: 400, z }, down), 800, true, undefined, WHEEL_RAY_GROUPS
      );
      return hit ? 400 - hit.timeOfImpact : 0;
    };
    this.director = new CameraDirector(camera, park, probeGround);
    this.director.reset(this.sim.snapshot());
    // Split-screen gets its own cameras; the solo path keeps using `director`.
    this.viewports = new Viewports(renderer, park, probeGround);
    this.splitHud = new SplitHud(document.getElementById('splithud'));
    this.splitRoot = document.getElementById('splithud');
    this.playerCount = 1;

    this.input = new Input(window);
    this.input.options = this.options;
    this.audio = new Audio();
    // Browsers will not start audio without a gesture.
    const wake = () => { this.audio.start(); this.audio.setVolume(this.options.sfxVolume ?? 0.9); };
    window.addEventListener('keydown', wake, { once: true });
    window.addEventListener('pointerdown', wake, { once: true });
    this.hud = new Hud(this.hudRoot);

    // ── Frame ─────────────────────────────────────────────────────────────
    this.profiles = loadAll();
    this.profileIndex = activeSlot() ?? 0;
    this.replays = loadClips(this.profileIndex);
    this.lastMode = MODES[0];
    this.lastArena = ARENAS[0];
    this.arenaId = 'park';
    this.screens = new ScreenManager(this.screenRoot, {});
    buildFrame(this.screens, this);

    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    this.expose();
    return this;
  }

  get profile() { return this.profiles[this.profileIndex]; }

  saveProfiles() { saveAll(this.profiles); this.setupDirty = true; }

  /**
   * One input, from anywhere, straight back into the air (R4).
   *
   * The reel, the result screen and the menus are all things standing between
   * "that run ended" and "I am driving again". Start collapses all of them.
   */
  restartNow() {
    this.reel = null;
    this._reelDone = false;
    this.stopPlayback();
    return this.startRun(this.lastMode, this.lastArena, {
      players: this.playerCount,
      duration: this.party ? TUNING.MODES.PARTY.TURN_SECONDS : undefined,
    });
  }

  /**
   * Swap arenas. Physics and render both rebuild from the same record, so
   * there is exactly one place an arena is described (src/arena/index.js).
   */
  async useArena(id, opts = {}) {
    // Seed the sim with what this profile has already found, so a gap only
    // reads as a discovery the first time it is ever crossed. Playback passes
    // its own setup — the clip's car, not whatever the garage says today.
    const sim = await Sim.create(opts.setup || this.setup(), id,
      { gapsKnown: this.profile.gaps || [], ...opts });
    if (this.arenaId !== id) {
      this.scene.remove(this.arenaView.group);
      this.art.unregisterUnder(this.arenaView.group);
      this.arenaView.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      this.arenaView = buildArenaView(this.scene, this.art, id);
      this.art.setStyle(this.art.style);       // re-material the new meshes
      this.director.park = this.arenaView.park;
      this.viewports.setCount(this.playerCount, this.arenaView.park);
      this.arenaId = id;
    }
    this.sim = sim;
    return sim;
  }

  /** The resolved garage setup the sim is built from (§7). */
  setup() { return resolveSetup(this.profile); }

  /** One car view per driver (§9). */
  setPlayerCount(n) {
    n = Math.max(1, Math.min(n, TUNING.MODES.PARTY.MAX_PLAYERS));
    while (this.carViews.length < n) this.carViews.push(buildCarView(this.scene, this.art, this.carViews.length));
    while (this.carViews.length > n) this.carViews.pop().dispose();
    this.carView = this.carViews[0];
    this.playerCount = n;
    this.viewports.setCount(n, this.arenaView.park);
    this.splitHud.setCount(n);
    this.onResize();
    return n;
  }

  // ── Garage live preview (§2.1) ───────────────────────────────────────────
  async previewJump() {
    this.preview = { pending: true };
    const sim = await Sim.create(this.setup());
    // The screen may have been left while the world was being rebuilt.
    if (!this.preview) return;
    this.sim = sim;
    this.sim.run.begin();
    this.sim.placeCar(TUNING.CAMERA.PREVIEW.START, 0);
    this.director.reset(this.sim.snapshot());
    // Skip most of the run-up so the loop is the jump, not the approach.
    this.preview = { t: 0 };
    this.advance(TUNING.CAMERA.PREVIEW.SKIP);
    this.applyLivery();
  }

  endPreview() { this.preview = null; }

  /** Livery is paint, so it lives entirely in the renderer (§7). */
  applyLivery() {
    const l = this.setup().livery;
    this.art.tint('body', l.body);
    this.art.tint('panel', l.panel);
  }

  selectProfile(i) {
    this.profileIndex = i;
    setActiveSlot(i);
    this.replays = loadClips(i);
    if (!this.profile.created) { this.profile.created = Date.now(); saveAll(this.profiles); }
  }

  dailyLabel() {
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return `${day} · ${this.lastArena.label} variant`;
  }

  dailyBest() { return this.profile.best[`${this.lastArena.id}:${this.lastMode.id}`] || 0; }

  onResize() { this.resize(window.innerWidth, window.innerHeight); }

  // ── Run lifecycle ────────────────────────────────────────────────────────
  /**
   * Start a run (R4).
   *
   * Rebuilding the world costs 11-70 ms and a frame hitch; restarting one that
   * is already standing costs 0.1 ms. Since the overwhelmingly common case is
   * "same arena, same car, go again", that path reuses the world entirely.
   */
  async startRun(mode, arena, opts = {}) {
    const t0 = performance.now();
    this.lastMode = mode;
    this.lastArena = arena;
    if (!opts.licence) this.licence = null;
    this.mode = 'play';
    this.endPreview();
    this.reel = null;
    this._reelDone = false;
    const players = Math.max(1, Math.min(opts.players || 1, TUNING.MODES.PARTY.MAX_PLAYERS));

    const reusable = this.sim && !this.setupDirty && !this.playback
      && this.arenaId === arena.id && this.sim.players.length === players;
    if (!reusable) {
      await this.useArena(arena.id, { players, mode: mode.id, duration: opts.duration });
      this.setPlayerCount(players);
      this.setupDirty = false;
    }
    this.applyLivery();
    this.inRun = true;
    this.playback = null;
    // §R: a real run rerolls under an explicit seed so its recording can put
    // the world back. Any value works — it is written into every clip's meta.
    this.sim.restartRun(mode.id, opts.duration,
      opts.seed ?? ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0));
    this.lastStartMs = performance.now() - t0;
    // §6.1: record every run. A clip costs a few KB, so there is no reason to
    // decide in advance which runs are worth keeping.
    this.recorder = new Recorder({
      arena: arena.id, setup: this.setup(), profile: this.profile,
      players, mode: mode.id,
      // §R: the reroll seed and round length are what replayStart needs to
      // put the world back exactly where this recording began.
      seed: this.sim.roundSeed, duration: this.sim.round.duration,
    });
    this.launchSteps = new Array(players).fill(0);
    this.lastLaunchStep = 0;
    this.roundClips = [];
    this.trails.beginRound();          // a fresh round wipes the painted arena
    this.director.reset(this.sim.snapshot());
    this.director.setOverride(null);
    this.hud.shownScore = 0;
    this.hud.ticker = [];
    this.screens.go('run');
  }

  /** Every event that should make a noise (§10). */
  _sound(e) {
    const A = this.audio;
    if (!A || !A.ready) return;
    // The bed reacts to the same events the one-shots do — ducking under a big
    // stick, swelling for a discovery — so they are fed from one place.
    A.onEvent(e);
    switch (e.type) {
      case 'launch': if (e.launch.armed) A.launch(e.launch.speed); break;
      case 'landed': A.landing(e.result, e.landing ? e.landing.impactVel : 10); break;
      case 'gap': A.gap(e.gap.first); break;
      case 'deploy': A.deploy(e.slot); break;
      case 'coin': A.coin(); break;
      case 'nearMiss': A.nearMiss(); break;
      case 'honk': A.honk(); break;
      case 'tearoff': A.crash(); break;
      default: break;
    }
  }

  /**
   * Events that throw something into the world (R7). Kept next to _sound
   * because they answer the same question — "what did the car just do" — and
   * a landing that shakes the camera but makes no noise is a bug in one of
   * the two.
   */
  _fx(e) {
    if (this.fx) this.fx.onEvent(e, this.sim.car, this._fxRand);
    const who = this.sim.players[e.player || 0];
    if (this.trails && who) this.trails.onEvent(e, who.car);
  }

  /** §6.1 auto-save, and §4's crash cam. */
  onLanded(e) {
    const r = e.result;
    const who = e.player || 0;
    if (!r.landed) {
      // §4: "crash is a replay moment, never a punishment screen."
      this.crash = TUNING.CAMERA.CRASH_SLOWMO_TIME;
    }
    if (!this.recorder || !this.inRun) return;
    if (r.total < TUNING.REPLAY.AUTOSAVE_SCORE) return;
    const clip = this.recorder.clip(
      (this.launchSteps && this.launchSteps[who]) || this.lastLaunchStep,
      this.recorder.step,
      {
        total: r.total, quality: r.quality, tier: r.tier,
        airtime: +r.airtime.toFixed(2),
        tricks: r.tricks.map((t) => t.name),
        arena: this.lastArena.id, mode: this.lastMode.id, player: who,
      },
      who
    );
    this.roundClips = this.roundClips || [];
    this.roundClips.push(clip);
    if (who === 0) this.replays = saveClip(this.profileIndex, clip);
  }

  // ── Replay theater (§6.1) ────────────────────────────────────────────────
  async playClip(clip, { behavior = null, fromStart = true } = {}) {
    const setup = resolveSetup({
      car: clip.meta.car, livery: clip.meta.livery,
      tune: clip.meta.tune || { weight: .5, suspension: .5, thrust: .5, aero: .5 },
      parts: clip.meta.parts || {},
    });
    const players = clip.meta.players || 1;
    // One world, built once (§R). The old path built it twice — useArena and
    // then a second Sim.create — and threw the first away.
    await this.useArena(clip.meta.arena, { players, mode: clip.meta.mode || 'stunt', setup });
    this.setPlayerCount(players);
    // The sim reads the traffic option live, so playback pins it to what the
    // recording saw and stopPlayback puts the player's choice back.
    if (this._trafficBefore === undefined) this._trafficBefore = TUNING.TRAFFIC.MODE;
    TUNING.TRAFFIC.MODE = clip.meta.traffic || this._trafficBefore;
    this.sim.replayStart(clip.meta);
    this.playback = {
      clip, player: new Player(clip), paused: false, behavior, freeCam: null,
      // What a rewind needs to rebuild the world without re-resolving it.
      setup, players,
      // The reel follows whoever earned the landing (§9).
      focus: clip.focus || 0,
    };
    this.inRun = true;
    this.mode = 'play';
    this.applyLivery();
    // Fast-forward the prefix without drawing: this is the re-simulation §6.1
    // is built on, and it is why the clip is inputs rather than footage.
    while (this.playback.player.step < clip.start) this.stepPlayback(DT);
    return this.playback;
  }

  stepPlayback(dt) {
    const pb = this.playback;
    if (!pb || pb.player.done) return false;
    const { actions, edges } = pb.player.next();
    this.sim.step(dt, actions, edges);
    const focus = this.playback ? this.playback.focus : 0;
    for (const e of this.sim.drainEvents()) {
      if ((e.player || 0) !== focus) continue;
      if (e.type === 'launch') this.director.onLaunch(e.launch, this.sim.snapshot());
      else if (e.type === 'touchdown') this.director.onTouchdown();
    }
    return true;
  }

  seekPlayback(step) {
    const pb = this.playback;
    if (!pb) return;
    const target = Math.max(0, Math.min(step, pb.clip.end));
    // Forward is just more of the same steps; backward re-simulates the
    // prefix in place. Either way the world is never rebuilt (§R).
    if (target >= pb.player.step) {
      while (this.playback && this.playback.player.step < target) this.stepPlayback(DT);
      return;
    }
    this.playClipFrom(target);
  }

  /**
   * Rewind. Re-simulating from zero in a *fresh* world is the only honest
   * seek: probe-replay measures a rebuilt world reproducing the recording to
   * 0.0 m and a reset-in-place world drifting by hundreds — Rapier's contact
   * warm-start caches survive any teleport. So a rewind costs one world
   * build (no arena view work, no double build), and forward seeks cost
   * nothing at all.
   */
  async playClipFrom(step) {
    const pb = this.playback;
    if (!pb) return;
    this.sim = await Sim.create(pb.setup, pb.clip.meta.arena,
      { players: pb.players, mode: pb.clip.meta.mode || 'stunt' });
    if (this.playback !== pb) return;      // the theater was left mid-build
    this.sim.replayStart(pb.clip.meta);
    pb.player.reset();
    const target = Math.max(0, Math.min(step, pb.clip.end));
    while (this.playback === pb && pb.player.step < target) this.stepPlayback(DT);
  }

  stopPlayback() {
    this.playback = null;
    this.inRun = false;
    this.director.freeCam = null;
    if (this._trafficBefore !== undefined) {
      TUNING.TRAFFIC.MODE = this._trafficBefore;
      this._trafficBefore = undefined;
    }
  }

  /** Start the free camera where the current shot already is — never a cut. */
  seedFreeCam() {
    const c = this.camera;
    const t = this.director.out.target;
    this.director.freeCam = {
      pos: { x: c.position.x, y: c.position.y, z: c.position.z },
      target: { x: t.x, y: t.y, z: t.z },
      fov: c.fov,
      yaw: Math.atan2(t.x - c.position.x, t.z - c.position.z),
      pitch: Math.asin(Math.max(-1, Math.min(1, (t.y - c.position.y) /
        (Math.hypot(t.x - c.position.x, t.y - c.position.y, t.z - c.position.z) || 1)))),
    };
  }

  /** WASD to fly, R/F for height, arrows already scrub, so mouse-free. */
  updateFreeCam(dt) {
    const f = this.director.freeCam;
    if (!f) return;
    const K = TUNING.CAMERA.FREE;
    const k = (c) => this.input.keys.has(c);
    const sp = K.SPEED * (k('ShiftLeft') ? K.BOOST : 1);
    f.yaw += ((k('KeyA') ? 1 : 0) - (k('KeyD') ? 1 : 0)) * K.TURN * dt;
    f.pitch = Math.max(-1.4, Math.min(1.4, f.pitch + ((k('KeyR') ? 1 : 0) - (k('KeyF') ? 1 : 0)) * K.TURN * dt));
    const fwd = { x: Math.sin(f.yaw) * Math.cos(f.pitch), y: Math.sin(f.pitch), z: Math.cos(f.yaw) * Math.cos(f.pitch) };
    const go = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
    f.pos.x += fwd.x * go * sp * dt;
    f.pos.y += fwd.y * go * sp * dt;
    f.pos.z += fwd.z * go * sp * dt;
    f.target = { x: f.pos.x + fwd.x * 20, y: f.pos.y + fwd.y * 20, z: f.pos.z + fwd.z * 20 };
  }

  /** §2.1: director keyframes, saved with the clip. */
  addKeyframe() {
    const c = this.camera;
    const t = this.director.out.target;
    this.director.keyframes = this.director.keyframes || [];
    this.director.keyframes.push({
      pos: { x: c.position.x, y: c.position.y, z: c.position.z },
      target: { x: t.x, y: t.y, z: t.z },
      fov: c.fov,
    });
    this._exportMsg = `keyframe ${this.director.keyframes.length} set`;
  }

  // ── Video export (§6.1: "one-tap render ... in 16:9 or 9:16") ────────────
  startExport(aspect) {
    if (this.recorderMedia) return;
    const pb = this.playback;
    if (!pb) return;
    const R = TUNING.REPLAY;
    const h = 720;
    const w = Math.round(h * aspect);
    this._restoreSize = [window.innerWidth, window.innerHeight];
    this.resize(w, h);
    this.canvas.style.width = `${Math.round(w / 2)}px`;
    this.canvas.style.height = `${Math.round(h / 2)}px`;

    const stream = this.canvas.captureStream(R.EXPORT_FPS);
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mimeType = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
    if (!mimeType) { this._exportMsg = 'export unsupported in this browser'; return; }

    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: R.EXPORT_BITRATE });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `airtime-${pb.clip.id}-${aspect > 1 ? '16x9' : '9x16'}.webm`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      this._exportMsg = `exported ${(blob.size / 1048576).toFixed(1)}MB`;
      this.recorderMedia = null;
      if (this._restoreSize) { this.onResize(); this.canvas.style.width = ''; this.canvas.style.height = ''; }
    };
    this.recorderMedia = rec;
    this._exportMsg = 'recording…';
    // Rewind so the export is the whole clip, not wherever the scrub was.
    this.playClipFrom(pb.clip.start).then(() => rec.start());
  }

  stopExport() {
    if (this.recorderMedia && this.recorderMedia.state === 'recording') this.recorderMedia.stop();
    this.recorderMedia = null;
  }

  exportStatus() {
    if (this.recorderMedia) return 'RECORDING — plays to the end, then downloads';
    return this._exportMsg || '';
  }



  /** §8 licence test: a short authored run with one question to answer. */
  async startLicence(test) {
    this.licence = test;
    const arena = ARENAS.find((a) => a.id === test.arena) || ARENAS[0];
    await this.startRun(this.lastMode, arena, { duration: test.seconds, licence: test });
  }

  abandonRun() {
    this.inRun = false;
    this.screens.go('main');
  }

  endRun() {
    this.inRun = false;
    const summary = this.sim.runSummary();
    this.lastSummary = summary;
    this.allSummaries = this.sim.allSummaries();
    this.hud.hideCountdown();

    // §9: the reel plays before anyone sees a number.
    if (!this._reelDone) {
      this._reelDone = true;
      return this.startReel(() => { this._reelDone = false; this.finishRun(summary); });
    }
    this._reelDone = false;
    return this.finishRun(summary);
  }

  finishRun(summary) {

    // §8 licence: the run answers one question, and the answer is the grade.
    if (this.licence) {
      const test = this.licence;
      const result = evaluate(test, summary);
      const had = this.profile.licences[test.id];
      if (result.grade && licenceRank(result.grade) > licenceRank(had)) {
        this.profile.licences[test.id] = result.grade;
      }
      saveAll(this.profiles);
      this.licence = null;
      return this.screens.go('licresult', { test, result });
    }

    // Pass-the-pad: the round is one turn, not the whole game (§9).
    if (this.party && this.party.kind === 'pad') return this.nextTurn(summary);

    if (this.playerCount > 1) {
      return this.screens.go('scoreboard', { all: this.allSummaries, kind: 'split' });
    }

    recordRun(this.profile, this.lastArena.id, this.lastMode.id, summary);
    saveAll(this.profiles);
    this.submitScore(summary);
    this.screens.go('result', summary);
  }

  // ── Pass-the-pad (§9): one controller, 45s turns, scoreboard between ─────
  startPassThePad(count) {
    this.party = { kind: 'pad', count, turn: 0, scores: [] };
    this.playTurn();
  }

  playTurn() {
    const p = this.party;
    this.startRun(this.lastMode, this.lastArena, {
      players: 1, duration: TUNING.MODES.PARTY.TURN_SECONDS,
    });
  }

  nextTurn(summary) {
    const p = this.party;
    p.scores.push({ ...summary, player: p.turn });
    p.turn++;
    if (p.turn >= p.count) {
      const scores = p.scores;
      this.party = null;
      return this.screens.go('scoreboard', { all: scores, kind: 'pad' });
    }
    this.screens.go('handover', { turn: p.turn, count: p.count, scores: p.scores });
  }

  /**
   * The highlight reel (§9).
   *
   * "Every round ends with the top three landings auto-replayed full-screen
   * under the full cinematic camera. This is the shared 'everyone watch this'
   * beat and the primary feeder for clips."
   *
   * Full-screen and un-restrained on purpose: the quarter-screen camera rule of
   * §6 exists because orbits do not survive a quartered picture, and the reel
   * is where the whole screen comes back.
   */
  async startReel(after) {
    const clips = (this.roundClips || [])
      .filter((c) => c.info.total >= TUNING.UI.REEL_MIN_SCORE)
      .sort((a, b) => b.info.total - a.info.total)
      .slice(0, TUNING.UI.REEL_CLIPS);
    // Solo, a reel of mediocre jumps is just downtime between attempts (R4).
    // In party it is the point, so it always plays.
    if (!clips.length || (this.playerCount === 1 && !this.party && !clips.some((c) => c.info.total >= TUNING.UI.REEL_SOLO_SCORE))) {
      return after();
    }

    this.reel = { clips, i: 0, after };
    this.splitRoot.classList.add('hidden');
    this.screens.go('reel', { clip: clips[0], index: 0, count: clips.length });
    await this.playClip(clips[0], { behavior: null });
  }

  async reelNext() {
    const r = this.reel;
    if (!r) return;
    r.i++;
    if (r.i >= r.clips.length) {
      const after = r.after;
      this.reel = null;
      this.stopPlayback();
      return after();
    }
    this.screens.go('reel', { clip: r.clips[r.i], index: r.i, count: r.clips.length });
    await this.playClip(r.clips[r.i], { behavior: null });
  }

  skipReel() {
    const r = this.reel;
    if (!r) return;
    const after = r.after;
    this.reel = null;
    this.stopPlayback();
    after();
  }

  /** §8 daily leaderboard. The adapter is local until there is a server. */
  async submitScore(summary) {
    if (!summary.score) return;
    try {
      await Board.submit({
        day: todayKey(), arena: this.lastArena.id, mode: this.lastMode.id,
        name: this.profile.name, car: this.profile.car,
        score: summary.score, medal: summary.medal, at: Date.now(),
        // §R: a score set under different physics is not comparable.
        sim: simVersion(),
      });
    } catch { /* a board being unavailable must never eat a run */ }
  }

  // ── Fixed-step simulation ────────────────────────────────────────────────
  stepFixed(dt) {
    if (this.playback) {
      if (!this.playback.paused) {
        const more = this.stepPlayback(dt);
        // An export runs to the end of the clip and then saves itself.
        if (!more && this.recorderMedia) this.stopExport();
        // The theater loops a clip; the reel moves on to the next one, so it
        // has to be allowed to finish.
        if (!more && !this.reel) this.playClipFrom(this.playback.clip.start);
      }
      return;
    }

    let actions;
    if (this.mode === 'loop') {
      const ctx = this.loopCtx;
      ctx.airborne = this.sim.airborne;
      ctx.launchT = this.demoLaunchT;
      ctx.boost = this.sim.boost.value;
      ctx.car = this.sim.car;
      ctx.park = this.sim.park;
      actions = loopActions(this.demoT, NEUTRAL_ACTIONS, ctx);
    } else if (this.mode === 'demo') actions = demoActions(this.demoT, NEUTRAL_ACTIONS, this.demoLaunchT);
    else if (this.preview && !this.preview.pending) {
      // The preview drives itself: throttle to the ramp, then hands off to
      // whatever the parts do in the air.
      this.preview.t += dt;
      actions = { ...NEUTRAL_ACTIONS, throttle: 1, boost: this.preview.t < 1.1 };
      if (this.preview.t > TUNING.CAMERA.PREVIEW.SECONDS) {
        this.preview.t = 0;
        this.sim.placeCar(TUNING.CAMERA.PREVIEW.START, 0);
        this.advance(TUNING.CAMERA.PREVIEW.SKIP);
      }
    } else if (this.mode === 'split') {
      // Every driver runs the same script on a different phase, so the four
      // viewports show four different runs rather than four identical ones.
      actions = this.sim.players.map((p, i) => {
        const c = this.splitCtx[i];
        c.airborne = p.airborne;
        c.launchT = c.launch;
        c.boost = p.boost.value;
        c.car = p.car;
        c.park = this.sim.park;
        return loopActions(this.demoT + i * 2.3, NEUTRAL_ACTIONS, c);
      });
    } else if (this.playerCount > 1) {
      actions = this.sim.players.map((p, i) =>
        this.inRun && this.sim.round.running ? this.input.actionsFor(i) : NEUTRAL_ACTIONS);
    } else actions = this.inRun && this.sim.run.running ? this.input.actions : NEUTRAL_ACTIONS;

    const edges = this.mode === 'split'
      ? this.sim.players.map((_, i) => loopEdges(this.demoT + i * 2.3, dt, this.splitCtx[i]))
      : this.mode === 'loop'
      ? loopEdges(this.demoT, dt, this.loopCtx)
      : this.mode === 'demo'
        ? demoEdges(this.demoT, dt, this.demoLaunchT)
        : this.edges;
    // The sim steps on what the recorder wrote down, not on the raw sticks —
    // otherwise a clip replays a run that never quite happened (§R).
    if (this.recorder && this.inRun && this.sim.run.running) {
      actions = this.recorder.record(actions, edges);
    }
    this.sim.step(dt, actions, edges);
    this.edges = {};
    if (this.mode === 'demo' || this.mode === 'loop' || this.mode === 'split') this.demoT += dt;

    for (const e of this.sim.drainEvents()) {
      this._sound(e);
      this._fx(e);
      if (e.type === 'launch') {
        this.director.onLaunch(e.launch, this.sim.snapshot());
        if (e.launch.armed && this.recorder) {
          this.lastLaunchStep = this.recorder.step;
          if (this.launchSteps) this.launchSteps[e.player || 0] = this.recorder.step;
        }
        if (this.mode === 'split' && e.launch.armed) {
          const c = this.splitCtx[e.player || 0];
          c.launch = this.demoT; c.thrusted = false;
        }
        if ((this.mode === 'demo' || this.mode === 'loop') && e.launch.armed) {
          if (this.mode === 'loop') { this.demoLaunchT = this.demoT; this.loopCtx.thrusted = false; }
          else if (this.demoLaunchT === null) this.demoLaunchT = this.demoT;
        }
      } else if (e.type === 'touchdown') this.director.onTouchdown();
      else if (e.type === 'landed' && e.result) {
        if (e.landing.counted || e.result.tricks.length) this.hud.showLanding(e.result);
      } else if (e.type === 'gap') {
        this.hud.showGap(e.gap);
        if (e.gap.first && e.player === 0) {
          if (!this.profile.gaps) this.profile.gaps = [];
          if (!this.profile.gaps.includes(e.gap.id)) {
            this.profile.gaps.push(e.gap.id);
            this.saveProfiles();
          }
        }
      }
      else if (e.type === 'reset') this.director.reset(this.sim.snapshot());
      else if (e.type === 'runOver') this.endRun();
      else if (e.type === 'nearMiss') this._nearMissFlash = 0.6;
    }
  }

  advance(seconds) {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) this.stepFixed(DT);
    return n * DT;
  }

  renderFrame(dt) {
    const state = this.sim.snapshot();
    for (let i = 0; i < this.carViews.length; i++) {
      const p = this.sim.players[i];
      if (!p) continue;
      // Cheap identity check: the setup object is swapped, not mutated, so a
      // reference compare is enough to know the instrument changed.
      if (this.carViews[i].shownSetup !== p.setup) {
        this.carViews[i].shownSetup = p.setup;
        this.carViews[i].setChassis(p.setup && p.setup.half, p.setup && p.setup.wheel,
          p.setup && p.setup.car && p.setup.car.id);
      }
      this.carViews[i].sync(p.car, p.panels);
    }
    this.trafficView.sync(state.traffic);
    this.arenaView.syncMovers(state.movers);
    this.arenaView.syncCoins(this.sim.coinsTaken, state.time);

    // The AFTERGLOW smear runs before the split-screen early-out — trails
    // live in the scene, so every viewport sees them.
    this.trails.enabled = this.art.style === 'afterglow';
    this.trails.setPlayerCount(this.playerCount);
    this.trails.update(dt, state, this.carViews, this.camera, this._fxRand);

    // Outside a run the camera shows the car off (§2.1) instead of chasing it.
    let override = this._captureOverride || null;
    if (this.playback) override = this.playback.behavior;
    else if (this.mode === 'play' && !this.inRun) {
      override = this.preview ? BEHAVIOR.PREVIEW : BEHAVIOR.SHOWCASE;
    }
    this.director.setOverride(override);
    // A replayed clip follows the driver who earned it, not always player one.
    const focus = this.playback ? (state.players[this.playback.focus] || state) : state;
    this.director.update(dt, focus);

    const p = state.position;
    this.art.sunTarget.position.set(p.x, p.y, p.z);
    this.art.lights.sun.position.set(p.x - 180, p.y + 260, p.z + 140);

    // ── Split-screen (§9) ─────────────────────────────────────────────────
    if (this.playerCount > 1 && !this.reel) {
      this.hudRoot.classList.add('hidden');
      this.splitRoot.classList.remove('hidden');
      this.splitHud.update(dt, state.players);
      // §6: per-viewport cameras run chase-pullback only.
      this.viewports.render(this.scene, dt, state.players, true);
      return;
    }
    this.splitRoot.classList.add('hidden');

    if (this._nearMissFlash > 0) this._nearMissFlash -= dt;

    this.fx.setViewport(this.renderer.domElement.height, this.camera.fov);
    this.fx.emit(dt, state, this._fxRand);
    this.fx.update(dt);

    this.audio.update(dt, state);
    this.hud.speedLines(state.groundSpeed || 0, state.airborne);
    this.hud.update(dt, state, {
      camera: this.director.activeBehavior,
      style: this.art.style,
      telemetry: this.sim.telemetry,
      nearMiss: this._nearMissFlash > 0,
    });

    if (this.inRun && this.sim.run.state === RUN_STATE.COUNTDOWN) {
      this.hud.countdown(this.sim.run.countdown);
      const beat = Math.ceil(this.sim.run.countdown);
      if (beat !== this._lastBeat) { this._lastBeat = beat; this.audio.countdown(beat <= 0); }
    } else { this.hud.hideCountdown(); this._lastBeat = null; }

    // Shake last, so it displaces whatever the director decided rather than
    // being smoothed away by it.
    if (this.fx.shake > 0.001) {
      const s = this.fx.shake * this.fx.shake * TUNING.FX.SHAKE_AMPLITUDE;
      const r = this._fxRand;
      this.camera.position.x += (r() - 0.5) * s;
      this.camera.position.y += (r() - 0.5) * s;
      this.camera.position.z += (r() - 0.5) * s;
    }

    this.renderer.render(this.scene, this.camera);
  }

  // ── Live loop ────────────────────────────────────────────────────────────
  start() {
    this.running = true;
    this.last = performance.now();
    const frame = (now) => {
      if (!this.running) return;
      requestAnimationFrame(frame);
      let dt = Math.min((now - this.last) / 1000, 0.25);
      this.last = now;

      // §4 crash cam: slow-mo on an unrecoverable impact.
      if (this.crash > 0) { this.crash -= dt; dt *= TUNING.CAMERA.CRASH_SLOWMO; }

      if (this.mode === 'play') {
        const driving = this.inRun && this.sim.run.running;
        this.input.sample(dt, this.sim.airborne);
        if (driving) {
          if (this.input.pressed('thrust')) this.edges.thrust = true;
          if (this.input.pressed('reset')) this.edges.reset = true;
          if (this.input.pressed('cycleStyle')) this.setArtStyle(this.art.next());
          if (this.input.pressed('cycleCamera')) this.cycleCameraStyle();
        }
        if (this.playback) {
          this.theaterKeys?.(this.input);
          this.updateFreeCam(dt);
        }
        const menu = this.input.sampleMenu(dt);
        this.idle = menu.any ? 0 : this.idle + dt;
        // R4: Start always means "again", wherever you are.
        const where = this.screens.current && this.screens.current.name;
        if (menu.start && (driving || this.reel || where === 'result' || where === 'run')) {
          this.restartNow();
        } else {
          this.screens.tick(dt, driving ? { any: menu.back, back: menu.back } : menu);
        }
      }

      this.accum += dt;
      let steps = 0;
      while (this.accum >= DT && steps < TUNING.SIM.MAX_STEPS_PER_FRAME) {
        this.stepFixed(DT);
        this.accum -= DT;
        steps++;
      }
      if (steps === TUNING.SIM.MAX_STEPS_PER_FRAME) this.accum = 0;

      this.renderFrame(dt);
    };
    requestAnimationFrame(frame);
  }

  stop() { this.running = false; }

  cycleCameraStyle() {
    TUNING.CAMERA.STYLE = TUNING.CAMERA.STYLE === 'cinematic' ? 'classic' : 'cinematic';
    this.applyOption('cameraStyle', TUNING.CAMERA.STYLE);
    return TUNING.CAMERA.STYLE;
  }

  setArtStyle(style) {
    this.art.setStyle(style);
    this.applyOption('artStyle', this.art.style);
    return this.art.style;
  }

  applyOption(k, v) {
    this.options[k] = v;
    saveOptions(this.options);
    if (k === 'cameraStyle') TUNING.CAMERA.STYLE = v;
    if (k === 'showTelemetry') TUNING.HUD.SHOW_TELEMETRY = v;
    if (k === 'sfxVolume' && this.audio) this.audio.setVolume(v);
    if (k === 'mute' && this.audio) this.audio.setMuted(v);
    // While playback has the traffic mode pinned to the clip's, the player's
    // new choice lands in the saved slot stopPlayback restores from.
    if (k === 'traffic') {
      if (this._trafficBefore !== undefined) this._trafficBefore = v;
      else TUNING.TRAFFIC.MODE = v;
    }
    if (k === 'artStyle') this.art.setStyle(v);
    if (k === 'reduceEffects' && this.trails) this.trails.setOptions({ reduceEffects: v });
    if (k === 'colorblindTrails') {
      // One switch, whole game: trails, trim, split HUD and the CSS accent
      // all follow the palette in the same frame.
      setColorblind(v);
      if (this.trails) this.trails.setOptions({ colorblind: v });
      for (const cv of this.carViews) cv.retrim();
      this.splitHud.recolor();
      document.documentElement.style.setProperty('--p1', playerColorCss(0));
    }
    if (this.input) this.input.options = this.options;
    return v;
  }

  // ── Deterministic capture (§6.1 plugs in here) ───────────────────────────
  async restart() {
    this.sim = await Sim.create();
    this.director.reset(this.sim.snapshot());
    this.demoT = 0;
    this.demoLaunchT = null;
    this.accum = 0;
  }

  async beginCapture({ behavior = null, style = null, fps = 30, start = null, script = 'demo', arena = 'park', players = 1 } = {}) {
    this.stop();
    await this.useArena(arena, { players, mode: 'stunt' });
    this.setPlayerCount(players);
    this.director.reset(this.sim.snapshot());
    this.demoT = 0;
    this.demoLaunchT = null;
    this.accum = 0;
    this.loopCtx = { thrusted: false, airborne: false, launchT: null, boost: 0 };
    this.splitCtx = Array.from({ length: players }, () => ({ thrusted: false, airborne: false, launch: null, boost: 0 }));
    this.mode = script === 'loop' ? 'loop' : script === 'split' ? 'split' : 'demo';
    if (start === null) start = (script === 'loop' || script === 'split') ? LOOP_CLIP.start : DEMO_CLIP.start;
    this.inRun = true;
    // Same entry point a real run uses, so the captured run is bit-for-bit the
    // one tools/probe-run.mjs measures — restartRun re-rolls traffic, and
    // skipping it quietly made the clip a different run to the probe.
    this.sim.restartRun('stunt');
    this.sim.run.begin();
    if (style) this.art.setStyle(style);      // forced, not saved as a preference
    this._captureOverride = behavior;
    this.director.setOverride(behavior);
    this.screens.go('run');

    this.advance(start);
    this.renderFrame(1 / fps);
    this.captureDt = 1 / fps;
    return true;
  }

  captureStep() {
    this.advance(this.captureDt);
    this.renderFrame(this.captureDt);
    return this.demoT;
  }

  endCapture() {
    this.mode = 'play';
    this.inRun = false;
    this._captureOverride = null;
    this.director.setOverride(null);
    this.captureDt = null;
  }

  expose() {
    window.AIRTIME = {
      TUNING,
      game: this,
      sim: () => this.sim,
      snapshot: () => this.sim.snapshot(),
      telemetry: () => this.sim.telemetry.summary(),
      run: () => this.sim.runSummary(),
      setup: () => this.setup(),
      profile: () => this.profile,
      preview: () => this.previewJump(),
      audio: () => this.audio,
      clips: () => this.replays,
      playClip: (c, o) => this.playClip(c, o),
      wall: () => wallClips(this.profileIndex),
      LICENCES,
      startLicence: (t) => this.startLicence(t),
      daily: () => dailyVariant(),
      board: () => Board,
      BEHAVIOR, STYLES, MODES, ARENAS,
      setStyle: (s) => this.setArtStyle(s),
      nextStyle: () => this.setArtStyle(this.art.next()),
      options: () => this.options,
      setOption: (k, v) => this.applyOption(k, v),
      goto: (s, d) => this.screens.go(s, d),
      startRun: (m, a, o) => this.startRun(m || this.lastMode, a || this.lastArena, o),
      startSplit: (n) => this.startRun(this.lastMode, this.lastArena, { players: n }),
      startPad: (n) => this.startPassThePad(n),
      reel: () => this.reel,
      setCameraOverride: (b) => this.director.setOverride(b),
      beginCapture: (o) => this.beginCapture(o),
      captureStep: () => this.captureStep(),
      endCapture: () => this.endCapture(),
      ready: true,
    };
  }
}

// ── Boot ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('view');
const hudRoot = document.getElementById('hud');
const screenRoot = document.getElementById('screens');
const boot = document.getElementById('boot');

const game = new Game(canvas, hudRoot, screenRoot);
game.init().then(() => {
  boot.classList.add('gone');
  hudRoot.classList.add('hidden');
  game.screens.go(new URLSearchParams(location.search).has('capture') ? 'run' : 'title');
  game.start();
}).catch((e) => {
  boot.querySelector('#boot-msg').textContent = `BOOT FAILED — ${e.message}`;
  console.error(e);
});
