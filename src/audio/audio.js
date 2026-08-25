/**
 * Audio — synthesised, not sampled.
 *
 * A stunt game with no engine note, no wind at launch and no landing hit is
 * missing most of its feel, and you cannot tune air control deaf: the cut from
 * road noise to wind is *how a launch reads*, and the landing hit is how you
 * know a stick was clean. So this ships alongside the air-control work rather
 * than after it.
 *
 * Everything here is generated with Web Audio — oscillators, filtered noise,
 * envelopes. No files, no licensing, no loading. It is driven straight off the
 * simulation, so the engine is telling you the truth about the car.
 *
 * §10: "engine cuts to wind at launch; a rising tone tracks hang time; each
 * part deploy has its own whoosh; landing is a single stick hit weighted by
 * landing tier; crash gets the crunch."
 */

import TUNING from '../TUNING.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** One second of white noise, reused by every noise voice. */
function noiseBuffer(ctx) {
  const n = ctx.sampleRate;
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export class Audio {
  constructor() {
    this.ready = false;
    this.enabled = true;
    this.ctx = null;
    this.muted = false;
  }

  /** Browsers will not start audio without a gesture; call this from one. */
  start() {
    if (this.ready || !this.enabled) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.noise = noiseBuffer(ctx);

    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    this.master = master;

    // A little compression keeps a landing hit from clipping the engine.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    comp.connect(master);
    this.bus = comp;

    this._buildEngine();
    this._buildWind();
    this._buildScrub();
    this.ready = true;
    if (ctx.state === 'suspended') ctx.resume();
  }

  // ── Continuous voices ────────────────────────────────────────────────────

  /**
   * The engine: two detuned saws an octave apart plus a sub, through a
   * lowpass that opens with load. Frequency follows a faked gearbox so the
   * pitch resets on each shift and speed stays readable without the HUD.
   */
  _buildEngine() {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 0.8;

    const a = ctx.createOscillator(); a.type = 'sawtooth';
    const b = ctx.createOscillator(); b.type = 'sawtooth'; b.detune.value = -14;
    const sub = ctx.createOscillator(); sub.type = 'square';
    const subG = ctx.createGain(); subG.gain.value = 0.35;

    a.connect(lp); b.connect(lp); sub.connect(subG); subG.connect(lp);
    lp.connect(g); g.connect(this.bus);
    a.start(); b.start(); sub.start();
    this.engine = { a, b, sub, g, lp };
  }

  /** Wind: filtered noise whose band opens with speed. The launch cue. */
  _buildWind() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(bp); bp.connect(g); g.connect(this.bus);
    src.start();
    this.wind = { src, bp, g };
  }

  /** Tyre scrub: noise through a resonant band, gated on slip. */
  _buildScrub() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 2.5;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(bp); bp.connect(g); g.connect(this.bus);
    src.start();
    this.scrub = { src, bp, g };
  }

  // ── One-shots ────────────────────────────────────────────────────────────

  /** A filtered noise burst with a percussive envelope. */
  _hit({ gain = 0.5, freq = 300, q = 1, type = 'lowpass', attack = 0.002, decay = 0.25 }) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.6 + Math.random() * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f); f.connect(g); g.connect(this.bus);
    src.start(t); src.stop(t + attack + decay + 0.05);
  }

  /** A pitched body: the thump under a landing, the sting on a cash-out. */
  _tone({ gain = 0.3, from = 220, to = 110, decay = 0.3, type = 'sine', delay = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g); g.connect(this.bus);
    o.start(t); o.stop(t + decay + 0.05);
  }

  /** Wheels leaving the ramp: the road drops out and the wind takes over. */
  launch(speed) {
    this._hit({ gain: 0.22, freq: 900, type: 'highpass', decay: 0.5 });
    this._tone({ gain: 0.16, from: 90, to: 220, decay: 0.5, type: 'triangle' });
  }

  /** §10: "landing is a single stick hit weighted by landing tier." */
  landing(result, impact = 10) {
    const heavy = clamp(impact / 22, 0.25, 1);
    this._hit({ gain: 0.42 * heavy, freq: 220, decay: 0.22 });
    this._tone({ gain: 0.5 * heavy, from: 130, to: 44, decay: 0.3 });
    if (!result) return;
    if (!result.landed) return this.crash();

    // The cash-out climbs with the facet count, so a big stack *sounds* big.
    const n = clamp(result.facetCount || 1, 1, 10);
    for (let i = 0; i < n; i++) {
      this._tone({
        gain: 0.13, type: 'triangle', delay: i * 0.055,
        from: 440 * Math.pow(2, i / 12), to: 660 * Math.pow(2, i / 12), decay: 0.16,
      });
    }
    if (n >= 6) this._tone({ gain: 0.3, from: 70, to: 35, decay: 0.7, delay: n * 0.055 });
  }

  crash() {
    this._hit({ gain: 0.75, freq: 1400, type: 'lowpass', q: 0.6, decay: 0.55 });
    this._tone({ gain: 0.5, from: 160, to: 30, decay: 0.6, type: 'square' });
  }

  /** §10: "each part deploy has its own whoosh." */
  deploy(slot) {
    const f = { DOOR_L: 700, DOOR_R: 760, HOOD: 520, TRUNK: 470, SPOILER: 980 }[slot] || 700;
    this._hit({ gain: 0.16, freq: f, type: 'bandpass', q: 1.6, decay: 0.16 });
  }

  thrust() {
    this._hit({ gain: 0.3, freq: 400, type: 'bandpass', q: 0.9, attack: 0.01, decay: 0.4 });
    this._tone({ gain: 0.2, from: 180, to: 420, decay: 0.35, type: 'sawtooth' });
  }

  coin() { this._tone({ gain: 0.1, from: 1180, to: 1760, decay: 0.09, type: 'triangle' }); }
  nearMiss() { this._hit({ gain: 0.2, freq: 1800, type: 'bandpass', q: 3, decay: 0.28 }); }
  honk() { this._tone({ gain: 0.12, from: 420, to: 400, decay: 0.28, type: 'square' }); }
  countdown(go) { this._tone({ gain: 0.28, from: go ? 880 : 440, to: go ? 1320 : 440, decay: go ? 0.5 : 0.14, type: 'square' }); }

  // ── Per-frame ────────────────────────────────────────────────────────────

  /**
   * @param state a sim snapshot
   */
  update(dt, state) {
    if (!this.ready || this.muted) return;
    const A = TUNING.AUDIO;
    const t = this.ctx.currentTime;
    const k = (cur, want, tau) => cur + (want - cur) * (1 - Math.exp(-dt / tau));

    const speed = state.groundSpeed;
    const norm = clamp(speed / TUNING.DRIVE.TOP_SPEED, 0, 1.3);

    // Faked gearbox: the pitch resets on each shift, which is what makes speed
    // audible rather than a single rising whine.
    const gear = Math.min(A.GEARS - 1, Math.floor(norm * A.GEARS));
    const within = clamp(norm * A.GEARS - gear, 0, 1);
    const rpm = A.IDLE_HZ + within * (A.REDLINE_HZ - A.IDLE_HZ);

    // §10: the engine cuts to wind at launch.
    const load = state.airborne ? A.AIR_ENGINE : clamp(0.25 + norm * 0.75, 0, 1);
    const eg = this.engine.g.gain;
    eg.value = k(eg.value, A.ENGINE_GAIN * load * (state.boosting ? 1.25 : 1), 0.05);
    this.engine.a.frequency.value = rpm;
    this.engine.b.frequency.value = rpm * 1.005;
    this.engine.sub.frequency.value = rpm * 0.5;
    this.engine.lp.frequency.value = 400 + load * 2400 + norm * 900;

    // Wind rises with speed and takes over completely in the air.
    const wind = clamp(norm * 0.8 + (state.airborne ? 0.5 : 0), 0, 1.2);
    const wg = this.wind.g.gain;
    wg.value = k(wg.value, A.WIND_GAIN * wind, 0.12);
    this.wind.bp.frequency.value = 320 + norm * 1500 + (state.airborne ? 500 : 0);

    // Scrub while the tyres are pointed somewhere other than they are going.
    const slip = clamp((state.slipAngle || 0) / 0.6, 0, 1) * (state.airborne ? 0 : 1);
    const sg = this.scrub.g.gain;
    sg.value = k(sg.value, A.SCRUB_GAIN * slip * clamp(norm * 1.5, 0, 1), 0.06);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  setVolume(v) { if (this.master) this.master.gain.value = clamp(v, 0, 1); }
}

export default Audio;
