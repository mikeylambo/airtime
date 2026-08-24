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
import { loadOptions, saveOptions } from './storage/storage.js';
import { loadAll, saveAll, activeSlot, setActiveSlot, recordRun } from './storage/profiles.js';
import { resolveSetup } from './sim/cars.js';

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
    this.licences = [];
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
    const { park } = buildArenaView(scene, this.art);
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
    this.lastMode = MODES[0];
    this.lastArena = ARENAS[0];
    this.screens = new ScreenManager(this.screenRoot, {});
    buildFrame(this.screens, this);

    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    this.expose();
    return this;
  }

  get profile() { return this.profiles[this.profileIndex]; }

  saveProfiles() { saveAll(this.profiles); }

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
  async startRun(mode, arena) {
    this.lastMode = mode;
    this.lastArena = arena;
    this.mode = 'play';
    this.endPreview();
    // Rebuild the world with the garage setup so the run uses the car the
    // player actually built (§7).
    this.sim = await Sim.create(this.setup());
    this.applyLivery();
    this.inRun = true;
    this.sim.restartRun(mode.id);
    this.director.reset(this.sim.snapshot());
    this.director.setOverride(null);
    this.hud.shownScore = 0;
    this.hud.ticker = [];
    this.screens.go('run');
  }

  abandonRun() {
    this.inRun = false;
    this.screens.go('main');
  }

  endRun() {
    this.inRun = false;
    const summary = this.sim.run.summary();
    this.lastSummary = summary;
    recordRun(this.profile, this.lastArena.id, this.lastMode.id, summary);
    saveAll(this.profiles);
    this.hud.hideCountdown();
    this.screens.go('result', summary);
  }

  // ── Fixed-step simulation ────────────────────────────────────────────────
  stepFixed(dt) {
    let actions;
    if (this.mode === 'demo') actions = demoActions(this.demoT, NEUTRAL_ACTIONS, this.demoLaunchT);
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

    const edges = this.mode === 'demo'
      ? demoEdges(this.demoT, dt, this.demoLaunchT)
      : this.edges;
    this.sim.step(dt, actions, edges);
    this.edges = {};
    if (this.mode === 'demo') this.demoT += dt;

    for (const e of this.sim.drainEvents()) {
      if (e.type === 'launch') {
        this.director.onLaunch(e.launch, this.sim.snapshot());
        if (this.mode === 'demo' && e.launch.armed && this.demoLaunchT === null) this.demoLaunchT = this.demoT;
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

    // Outside a run the camera shows the car off (§2.1) instead of chasing it.
    let override = this._captureOverride || null;
    if (this.mode === 'play' && !this.inRun) {
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
      const dt = Math.min((now - this.last) / 1000, 0.25);
      this.last = now;

      if (this.mode === 'play') {
        const driving = this.inRun && this.sim.run.running;
        this.input.sample(dt, this.sim.airborne);
        if (driving) {
          if (this.input.pressed('thrust')) this.edges.thrust = true;
          if (this.input.pressed('reset')) this.edges.reset = true;
          if (this.input.pressed('cycleStyle')) this.setArtStyle(this.art.next());
          if (this.input.pressed('cycleCamera')) this.cycleCameraStyle();
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

  async beginCapture({ behavior = null, style = null, fps = 30, start = DEMO_CLIP.start } = {}) {
    this.stop();
    await this.restart();
    this.mode = 'demo';
    this.inRun = true;
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
      run: () => this.sim.run.summary(),
      setup: () => this.setup(),
      profile: () => this.profile,
      preview: () => this.previewJump(),
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
