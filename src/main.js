/**
 * AIRTIME — bootstrap and the main loop.
 *
 * The simulation runs on a fixed timestep and the renderer is decoupled from
 * it, which is what makes tools/capture.mjs able to drive the exact same code
 * frame by frame and get the identical jump every time.
 */

import * as THREE from 'three';
import TUNING from './TUNING.js';
import { Sim } from './sim/sim.js';
import { RAPIER, WHEEL_RAY_GROUPS } from './sim/physics.js';
import { Input, NEUTRAL_ACTIONS } from './input/input.js';
import { createScene } from './render/scene.js';
import { ArtDirector, STYLES } from './render/art.js';
import { buildArenaView } from './render/arena-view.js';
import { buildCarView } from './render/car-view.js';
import { CameraDirector, BEHAVIOR } from './render/camera-rig.js';
import { Hud } from './ui/hud.js';
import { demoActions, demoEdges, DEMO_CLIP } from './demo-jump.js';

const DT = 1 / TUNING.SIM.HZ;

class Game {
  constructor(canvas, hudRoot) {
    this.canvas = canvas;
    this.hudRoot = hudRoot;
    this.mode = 'play';          // 'play' | 'demo'
    this.demoT = 0;
    this.demoLaunchT = null;
    this.accum = 0;
    this.last = 0;
    this.running = false;
    this.edges = {};
  }

  async init() {
    this.sim = await Sim.create();

    const { renderer, scene, camera, resize } = createScene(this.canvas);
    Object.assign(this, { renderer, scene, camera, resize });

    this.art = new ArtDirector(scene, renderer);
    const { park } = buildArenaView(scene, this.art);
    this.carView = buildCarView(scene, this.art);
    this.art.setStyle(TUNING.RENDER.STYLE);

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

    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    this.expose();
    return this;
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.resize(w, h);
  }

  // ── Fixed-step simulation ────────────────────────────────────────────────
  stepFixed(dt) {
    const actions = this.mode === 'demo'
      ? demoActions(this.demoT, NEUTRAL_ACTIONS, this.demoLaunchT)
      : this.input.actions;

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
      }
      else if (e.type === 'touchdown') this.director.onTouchdown();
      // Only real jumps get a banner; the settle at spawn is not a landing.
      else if (e.type === 'landed' && e.landing.counted) this.hud.showLanding(e.landing);
      else if (e.type === 'reset') this.director.reset(this.sim.snapshot());
    }
  }

  /** Advance `seconds` of simulation in fixed steps. */
  advance(seconds) {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) this.stepFixed(DT);
    return n * DT;
  }

  renderFrame(dt) {
    const state = this.sim.snapshot();
    this.carView.sync(this.sim.car, this.sim.panels);
    this.director.update(dt, state);

    // Keep the shadow frustum on the car rather than the world origin.
    const p = state.position;
    this.art.sunTarget.position.set(p.x, p.y, p.z);
    this.art.lights.sun.position.set(p.x - 180, p.y + 260, p.z + 140);

    this.hud.update(dt, state, this.director.activeBehavior, this.art.style, this.sim.telemetry);
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

      if (this.mode === 'play') {
        const a = this.input.sample(dt, this.sim.airborne);
        if (this.input.pressed('thrust')) this.edges.thrust = true;
        if (this.input.pressed('reset')) this.edges.reset = true;
        if (this.input.pressed('cycleStyle')) this.art.next();
        if (this.input.pressed('cycleCamera')) this.cycleCameraStyle();
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
    return TUNING.CAMERA.STYLE;
  }

  // ── Deterministic capture / demo (§6.1 is built on this seam) ────────────
  async restart() {
    this.sim = await Sim.create();
    this.director.reset(this.sim.snapshot());
    this.demoT = 0;
    this.demoLaunchT = null;
    this.accum = 0;
  }

  /**
   * Rewinds, runs the scripted jump forward to the clip's start without
   * drawing, then hands back a stepper that advances exactly one frame of
   * simulation and renders it. Same input script + same fixed dt = same jump,
   * so the three camera behaviours are genuinely shot on one take.
   */
  async beginCapture({ behavior = null, style = null, fps = 30, start = DEMO_CLIP.start } = {}) {
    this.stop();
    await this.restart();
    this.mode = 'demo';
    if (style) this.art.setStyle(style);
    this.director.setOverride(behavior);

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
      BEHAVIOR, STYLES,
      setStyle: (s) => this.art.setStyle(s),
      setCameraOverride: (b) => this.director.setOverride(b),
      cameraStyle: () => this.cycleCameraStyle(),
      beginCapture: (o) => this.beginCapture(o),
      captureStep: () => this.captureStep(),
      endCapture: () => this.endCapture(),
      runDemo: async (o = {}) => {
        await this.beginCapture({ ...o, start: 0 });
        this.mode = 'demo';
        this.start();
      },
      ready: true,
    };
  }
}

// ── Boot ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('view');
const hudRoot = document.getElementById('hud');
const boot = document.getElementById('boot');
const bootMsg = document.getElementById('boot-msg');

const game = new Game(canvas, hudRoot);
game.init().then(() => {
  bootMsg.textContent = 'PRESS START';
  boot.classList.add('ready');
  const go = () => {
    boot.classList.add('gone');
    game.start();
    window.removeEventListener('keydown', go);
    window.removeEventListener('pointerdown', go);
  };
  window.addEventListener('keydown', go);
  window.addEventListener('pointerdown', go);
  // A capture run drives the game itself and must not wait for a keypress.
  if (new URLSearchParams(location.search).has('capture')) {
    boot.classList.add('gone');
    game.renderFrame(1 / 60);
  }
}).catch((e) => {
  bootMsg.textContent = `BOOT FAILED — ${e.message}`;
  console.error(e);
});
