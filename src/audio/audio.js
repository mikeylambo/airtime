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
import { Mixer } from './mix.js';
import { PA } from './pa.js';

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
    // The mix is a pure model (audio/mix.js) so it can be driven and measured
    // in node. Everything below only pushes its numbers onto Web Audio nodes.
    this.mix = new Mixer();
    // R7: the PA. Also a pure model (audio/pa.js) — what it produces is a
    // level, a rate and a formant, and everything below only pushes those
    // onto nodes.
    this.pa = new PA();
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

    // The bed — room and music — sits behind its own duck gain, so a landing
    // can pull it out from under itself without touching the car voices.
    const duck = ctx.createGain();
    duck.gain.value = 1;
    duck.connect(master);
    this.duck = duck;

    this._buildEngine();
    this._buildRoad();
    this._buildWind();
    this._buildStress();
    this._buildScrub();
    this._buildCrowd();
    this._buildPA();
    this._buildMusic();
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

  /**
   * Road: the surface under the tyres. Separate from the engine on purpose —
   * this is the voice whose disappearance *is* the launch. An engine that
   * merely gets quieter reads as lifting off the throttle; a road that stops
   * reads as the wheels leaving the ground.
   */
  _buildRoad() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 1.1;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(lp); lp.connect(g); g.connect(this.bus);
    src.start();
    this.roadVoice = { src, lp, g };
  }

  /**
   * Mechanical stress: hinges, bodywork and a chassis being asked to rotate.
   * Airborne only, and it tracks how violently the car is being flown, so a
   * wild flight sounds like it is costing the car something.
   */
  _buildStress() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    src.playbackRate.value = 0.4;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 180; bp.Q.value = 5.5;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(bp); bp.connect(g); g.connect(this.bus);
    src.start();
    this.stress = { src, bp, g };
  }

  /**
   * The room. Two noise layers — a low murmur that is always there and a
   * brighter roar that only arrives when something happened. Synthesised like
   * everything else, so there is no crowd sample to license or to loop
   * audibly.
   */
  _buildCrowd() {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0;
    for (const [freq, q, level, rate] of [[420, 0.7, 0.5, 0.35], [1150, 0.9, 0.32, 0.55]]) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise; src.loop = true; src.playbackRate.value = rate;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
      const lg = ctx.createGain(); lg.gain.value = level;
      src.connect(bp); bp.connect(lg); lg.connect(g);
      src.start();
    }
    g.connect(this.duck);
    this.crowd = { g };
  }

  /**
   * The PA (R7). Not an announcer — a room.
   *
   * A tannoy two hundred metres away: noise through a narrow bandpass at a
   * vowel-ish formant, gated by a syllable envelope, fed through a long
   * delay so it arrives late and bounces. Syllabic rather than semantic, and
   * that is the design rather than a placeholder for a voice pack: from
   * inside a car at seventy you know somebody announced something and you
   * could not repeat it, which is exactly the right amount of information.
   */
  _buildPA() {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0;

    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true; src.playbackRate.value = 0.9;
    // Telephone band. Everything outside it is what distance removes.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 300;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 4.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 3000;

    // The bounce: one long delay with a little feedback is a city block.
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.34;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    const wet = ctx.createGain(); wet.gain.value = 0.5;

    src.connect(hp); hp.connect(bp); bp.connect(lp); lp.connect(g);
    g.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet);
    g.connect(this.bus); wet.connect(this.bus);
    src.start();
    this.paVoice = { g, bp, gate: g };
  }

  /**
   * The bed: a slow pad of detuned saws under a lowpass, with an LFO on the
   * cutoff so it breathes. Deliberately featureless — its job is to be
   * something a landing can duck, and anything with a tune in it would start
   * competing with the car.
   */
  _buildMusic() {
    const ctx = this.ctx;
    const A = TUNING.AUDIO;
    const g = ctx.createGain(); g.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 1.2;

    for (const [mult, detune] of [[1, -7], [1.5, 5], [2, 12], [3, -3]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = A.MUSIC_HZ * mult;
      o.detune.value = detune;
      const og = ctx.createGain(); og.gain.value = mult >= 2 ? 0.18 : 0.34;
      o.connect(og); og.connect(lp);
      o.start();
    }
    // Breathing cutoff, slow enough that it never reads as a rhythm.
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.06;
    const lfoG = ctx.createGain(); lfoG.gain.value = 240;
    lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();

    lp.connect(g); g.connect(this.duck);
    this.music = { g, lp };
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

  /**
   * The landing. Not one hit — four, stacked in the order the car experiences
   * them, because "KRRR-THOOM" is a sequence and a single thump is a door
   * closing:
   *
   *   the crunch of contact, immediately
   *   the sub thump of mass arriving, under it
   *   the suspension packing down, a few milliseconds behind
   *   the tyres chirping as they take the sideways load
   */
  landing(result, impact = 10) {
    const heavy = clamp(impact / 22, 0.25, 1);
    this._hit({ gain: 0.40 * heavy, freq: 240, decay: 0.20 });
    this._tone({ gain: 0.52 * heavy, from: 130, to: 40, decay: 0.34 });
    this._hit({ gain: 0.20 * heavy, freq: 130, q: 3.5, type: 'bandpass', attack: 0.03, decay: 0.30 });
    this._hit({ gain: 0.16 * heavy, freq: 2100, q: 2.2, type: 'bandpass', attack: 0.02, decay: 0.16 });
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
  /**
   * Crossing a named gap. A discovery gets a rising three-note figure; a gap
   * you already know gets the first note only, so the arena tells you which
   * kind of thing just happened without the HUD having to.
   */
  gap(first = false) {
    if (!this.ctx) return;
    const notes = first ? [523.25, 659.25, 987.77] : [523.25];
    notes.forEach((f, i) => setTimeout(() => this._tone({
      gain: first ? 0.13 : 0.09, from: f, to: f * 1.01, decay: first ? 0.5 : 0.22, type: 'triangle',
    }), i * 105));
  }

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
    const m = this.mix.update(dt, state);

    this.engine.g.gain.value = A.ENGINE_GAIN * m.engine;
    this.engine.a.frequency.value = m.rpm;
    this.engine.b.frequency.value = m.rpm * 1.005;
    this.engine.sub.frequency.value = m.rpm * 0.5;
    this.engine.lp.frequency.value = m.cutoff;

    this.roadVoice.g.gain.value = A.ROAD_GAIN * m.road;
    this.roadVoice.lp.frequency.value = 190 + m.road * 320;

    this.wind.g.gain.value = A.WIND_GAIN * m.wind;
    this.wind.bp.frequency.value = m.windFreq;

    this.stress.g.gain.value = A.STRESS_GAIN * m.stress;
    this.stress.bp.frequency.value = m.stressFreq;

    this.scrub.g.gain.value = A.SCRUB_GAIN * m.scrub;
    this.scrub.bp.frequency.value = m.scrubFreq;

    // R7 PA: ducked *by* the car, never the other way round — a tannoy that
    // beats the engine is a menu, not a stadium.
    const load = Math.min(1, m.engine * 0.6 + m.wind * 0.5 + m.stress * 0.6);
    const pa = this.pa.update(dt, load);
    if (this.paVoice) {
      // The syllable gate: a raised cosine per syllable, so it reads as
      // speech rather than as a noise burst.
      const syl = this.pa.speaking
        ? 0.35 + 0.65 * (0.5 - 0.5 * Math.cos(this.pa.syllable * Math.PI * 2)) : 0;
      this.paVoice.g.gain.value = pa * syl;
      this.paVoice.bp.frequency.value = this.pa.formant;
    }

    this.crowd.g.gain.value = A.CROWD_GAIN * m.crowd;
    this.music.g.gain.value = A.MUSIC_GAIN * m.music;
    // The PA ducks the bed on top of whatever a landing already ducked it by.
    this.duck.gain.value = m.duck * this.pa.duck;
  }

  /**
   * Events that move the bed rather than just firing a one-shot. Routed
   * through the same call as the one-shots so the two cannot drift apart.
   */
  onEvent(e) {
    this.mix.onEvent(e);
    // The PA speaks for things worth announcing, and its own rules decide
    // whether it takes the call (audio/pa.js).
    if (e.type === 'gap' && e.gap) this.pa.say(e.gap.first ? 'gap' : 'chain');
    else if (e.type === 'landed' && e.result) {
      if (!e.result.landed) this.pa.say('crash');
      else if (e.result.tier === 'secret') this.pa.say('secret');
      else if (e.result.total >= TUNING.PA.HUGE) this.pa.say('huge');
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  setVolume(v) { if (this.master) this.master.gain.value = clamp(v, 0, 1); }
}

export default Audio;
