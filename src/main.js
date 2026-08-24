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
import { buildTrafficView } from './render/traffic-view.js';
import { CameraDirector, BEHAVIOR } from './render/camera-rig.js';
import { Hud } from './ui/hud.js';
import { ScreenManager } from './ui/screens.js';
import { buildFrame, MODES, ARENAS } from './ui/frame.js';
import { demoActions, demoEdges, DEMO_CLIP } from './demo-jump.js';
import { loopActions, loopEdges, LOOP_CLIP } from './loop-demo.js';
import { loadOptions, saveOptions } from './storage/storage.js';
import { loadAll, saveAll, activeSlot, setActiveSlot, recordRun } from './storage/profiles.js';
import { resolveSetup } from './sim/cars.js';
import { Recorder, Player } from './sim/replay.js';
import { loadClips, saveClip, wallClips } from './storage/clips.js';
import { LICENCES, evaluate, licenceRank } from './game/licences.js';
import { Board, dailyVariant, todayKey } from './game/daily.js';

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

    this.art = new ArtDirector(scene, renderer);
    this.arenaView = buildArenaView(scene, this.art, 'park');
    const park = this.arenaView.park;
    this.carView = buildCarView(scene, this.art);
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

    this.input = new Input(window);
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

  saveProfiles() { saveAll(this.profiles); }

  /**
   * Swap arenas. Physics and render both rebuild from the same record, so
   * there is exactly one place an arena is described (src/arena/index.js).
   */
  async useArena(id) {
    const sim = await Sim.create(this.setup(), id);
    if (this.arenaId !== id) {
      this.scene.remove(this.arenaView.group);
      this.art.unregisterUnder(this.arenaView.group);
      this.arenaView.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      this.arenaView = buildArenaView(this.scene, this.art, id);
      this.art.setStyle(this.art.style);       // re-material the new meshes
      this.director.park = this.arenaView.park;
      this.arenaId = id;
    }
    this.sim = sim;
    return sim;
  }

  /** The resolved garage setup the sim is built from (§7). */
  setup() { return resolveSetup(this.profile); }

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
  async startRun(mode, arena, opts = {}) {
    this.lastMode = mode;
    this.lastArena = arena;
    if (!opts.licence) this.licence = null;
    this.mode = 'play';
    this.endPreview();
    // Rebuild the world with the garage setup so the run uses the car the
    // player actually built (§7).
    await this.useArena(arena.id);
    this.applyLivery();
    this.inRun = true;
    this.playback = null;
    this.sim.restartRun(mode.id, opts.duration);
    // §6.1: record every run. A clip costs a few KB, so there is no reason to
    // decide in advance which runs are worth keeping.
    this.recorder = new Recorder({
      arena: arena.id, setup: this.setup(), profile: this.profile,
    });
    this.lastLaunchStep = 0;
    this.director.reset(this.sim.snapshot());
    this.director.setOverride(null);
    this.hud.shownScore = 0;
    this.hud.ticker = [];
    this.screens.go('run');
  }

  /** §6.1 auto-save, and §4's crash cam. */
  onLanded(e) {
    const r = e.result;
    if (!r.landed) {
      // §4: "crash is a replay moment, never a punishment screen."
      this.crash = TUNING.CAMERA.CRASH_SLOWMO_TIME;
    }
    if (!this.recorder || !this.inRun) return;
    if (r.total < TUNING.REPLAY.AUTOSAVE_SCORE) return;
    const clip = this.recorder.clip(this.lastLaunchStep, this.recorder.step, {
      total: r.total, quality: r.quality, tier: r.tier,
      airtime: +r.airtime.toFixed(2),
      tricks: r.tricks.map((t) => t.name),
      arena: this.lastArena.id, mode: this.lastMode.id,
    });
    this.replays = saveClip(this.profileIndex, clip);
  }

  // ── Replay theater (§6.1) ────────────────────────────────────────────────
  async playClip(clip, { behavior = null, fromStart = true } = {}) {
    const setup = resolveSetup({
      car: clip.meta.car, livery: clip.meta.livery,
      tune: clip.meta.tune || { weight: .5, suspension: .5, thrust: .5, aero: .5 },
      parts: clip.meta.parts || {},
    });
    await this.useArena(clip.meta.arena);
    this.sim = await Sim.create(setup, clip.meta.arena);
    this.sim.run.begin();
    this.playback = { clip, player: new Player(clip), paused: false, behavior, freeCam: null };
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
    for (const e of this.sim.drainEvents()) {
      if (e.type === 'launch') this.director.onLaunch(e.launch, this.sim.snapshot());
      else if (e.type === 'touchdown') this.director.onTouchdown();
    }
    return true;
  }

  seekPlayback(step) {
    const pb = this.playback;
    if (!pb) return;
    const target = Math.max(0, Math.min(step, pb.clip.end));
    // Re-simulating from zero is the only honest seek for a deterministic
    // replay, and at a few thousand steps it is instant.
    this.playClipFrom(target);
  }

  async playClipFrom(step) {
    const pb = this.playback;
    const clip = pb.clip;
    await this.playClip(clip, { behavior: pb.behavior, fromStart: true });
    while (this.playback.player.step < step) this.stepPlayback(DT);
  }

  stopPlayback() { this.playback = null; this.inRun = false; this.director.freeCam = null; }

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
    this.hud.hideCountdown();

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

    recordRun(this.profile, this.lastArena.id, this.lastMode.id, summary);
    saveAll(this.profiles);
    this.submitScore(summary);
    this.screens.go('result', summary);
  }

  /** §8 daily leaderboard. The adapter is local until there is a server. */
  async submitScore(summary) {
    if (!summary.score) return;
    try {
      await Board.submit({
        day: todayKey(), arena: this.lastArena.id, mode: this.lastMode.id,
        name: this.profile.name, car: this.profile.car,
        score: summary.score, medal: summary.medal, at: Date.now(),
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
        if (!more) this.playClipFrom(this.playback.clip.start);
      }
      return;
    }

    let actions;
    if (this.mode === 'loop') {
      const ctx = this.loopCtx;
      ctx.airborne = this.sim.airborne;
      ctx.launchT = this.demoLaunchT;
      ctx.boost = this.sim.boost.value;
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
    } else actions = this.inRun && this.sim.run.running ? this.input.actions : NEUTRAL_ACTIONS;

    const edges = this.mode === 'loop'
      ? loopEdges(this.demoT, dt, this.loopCtx)
      : this.mode === 'demo'
        ? demoEdges(this.demoT, dt, this.demoLaunchT)
        : this.edges;
    if (this.recorder && this.inRun && this.sim.run.running) this.recorder.record(actions, edges);
    this.sim.step(dt, actions, edges);
    this.edges = {};
    if (this.mode === 'demo' || this.mode === 'loop') this.demoT += dt;

    for (const e of this.sim.drainEvents()) {
      if (e.type === 'launch') {
        this.director.onLaunch(e.launch, this.sim.snapshot());
        if (e.launch.armed && this.recorder) this.lastLaunchStep = this.recorder.step;
        if ((this.mode === 'demo' || this.mode === 'loop') && e.launch.armed) {
          if (this.mode === 'loop') { this.demoLaunchT = this.demoT; this.loopCtx.thrusted = false; }
          else if (this.demoLaunchT === null) this.demoLaunchT = this.demoT;
        }
      } else if (e.type === 'touchdown') this.director.onTouchdown();
      else if (e.type === 'landed' && e.result) {
        if (e.landing.counted || e.result.tricks.length) this.hud.showLanding(e.result);
      } else if (e.type === 'reset') this.director.reset(this.sim.snapshot());
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
    this.carView.sync(this.sim.car, this.sim.panels);
    this.trafficView.sync(state.traffic);
    this.arenaView.syncMovers(state.movers);
    this.arenaView.syncCoins(this.sim.coinsTaken, state.time);

    // Outside a run the camera shows the car off (§2.1) instead of chasing it.
    let override = this._captureOverride || null;
    if (this.playback) override = this.playback.behavior;
    else if (this.mode === 'play' && !this.inRun) {
      override = this.preview ? BEHAVIOR.PREVIEW : BEHAVIOR.SHOWCASE;
    }
    this.director.setOverride(override);
    this.director.update(dt, state);

    const p = state.position;
    this.art.sunTarget.position.set(p.x, p.y, p.z);
    this.art.lights.sun.position.set(p.x - 180, p.y + 260, p.z + 140);

    if (this._nearMissFlash > 0) this._nearMissFlash -= dt;
    this.hud.update(dt, state, {
      camera: this.director.activeBehavior,
      style: this.art.style,
      telemetry: this.sim.telemetry,
      nearMiss: this._nearMissFlash > 0,
    });

    if (this.inRun && this.sim.run.state === RUN_STATE.COUNTDOWN) this.hud.countdown(this.sim.run.countdown);
    else this.hud.hideCountdown();

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
        this.screens.tick(dt, driving ? { any: menu.back, back: menu.back } : menu);
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
    if (k === 'traffic') TUNING.TRAFFIC.MODE = v;
    if (k === 'artStyle') this.art.setStyle(v);
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

  async beginCapture({ behavior = null, style = null, fps = 30, start = null, script = 'demo', arena = 'park' } = {}) {
    this.stop();
    await this.useArena(arena);
    this.director.reset(this.sim.snapshot());
    this.demoT = 0;
    this.demoLaunchT = null;
    this.accum = 0;
    this.loopCtx = { thrusted: false, airborne: false, launchT: null, boost: 0 };
    this.mode = script === 'loop' ? 'loop' : 'demo';
    if (start === null) start = script === 'loop' ? LOOP_CLIP.start : DEMO_CLIP.start;
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
      startRun: (m, a) => this.startRun(m || this.lastMode, a || this.lastArena),
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
