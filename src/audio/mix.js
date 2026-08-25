/**
 * The mix model (R7).
 *
 * The vision's claim about this game is that audio is half the premium
 * illusion, and specifically that it is the *handoff*: "leaving the ramp should
 * change the entire soundscape — engine and road rumble become wind and
 * mechanical stress." That is a claim about relative levels over time, which
 * means it can be measured — but not while it lives inside a Web Audio graph
 * that only exists in a browser tab.
 *
 * So the mix is a pure function of the simulation, computed here with no audio
 * API in sight, and `audio.js` does nothing but push these numbers onto nodes.
 * `npm run probe:audio` then drives a real 90-second run through this and
 * checks that the soundscape actually flips at the lip, flips back on landing,
 * and that the bed ducks under a big stick.
 *
 * Every voice is a normalised 0..1 weight. Absolute levels stay in TUNING so
 * the balance is still one file's problem.
 */

import TUNING from '../TUNING.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
/** Exponential approach — frame-rate independent, unlike a raw lerp. */
const towards = (cur, want, tau, dt) => cur + (want - cur) * (1 - Math.exp(-dt / Math.max(1e-4, tau)));

export class Mixer {
  constructor() {
    this.engine = 0;      // combustion, the voice of load
    this.road = 0;        // tyres on surface — the thing that vanishes at the lip
    this.wind = 0;        // airspeed
    this.stress = 0;      // chassis and hinges complaining, airborne only
    this.scrub = 0;       // lateral slip
    this.crowd = 0;       // the room
    this.music = 1;       // bed level before ducking
    this.duck = 1;        // multiplier applied to crowd + music
    this.rpm = 0;
    this.gear = 0;
    this.cutoff = 400;
    this.windFreq = 320;
    this.stressFreq = 180;
    this.scrubFreq = 1600;

    this._duckHold = 0;
    this._duckDepth = 1;
    this._crowdSwell = 0;
    this._air = 0;        // smoothed airborne-ness, 0 on the deck, 1 in flight
  }

  /**
   * A landing, a crash, a launch — anything that should move the bed rather
   * than just fire a one-shot. Called from the same event router as the
   * one-shots so the two cannot drift apart.
   */
  onEvent(e) {
    const A = TUNING.AUDIO;
    if (e.type === 'landed' && e.result) {
      if (e.result.landed) {
        // Duck depth scales with what the landing was worth, so a five-figure
        // stick pulls the room out from under itself and a hop does not.
        const size = clamp((e.result.total || 0) / A.DUCK_FULL_PAYOUT, 0, 1);
        const depth = 1 - size * (1 - A.DUCK_FLOOR);
        if (depth < this._duckDepth || this._duckHold <= 0) {
          this._duckDepth = depth;
          this._duckHold = A.DUCK_HOLD * (0.5 + size * 0.5);
        }
        this._crowdSwell = Math.max(this._crowdSwell, clamp(0.25 + size * 1.1, 0, 1.35));
      } else {
        // A crash gets the room too, but as a drop rather than a swell.
        this._crowdSwell = Math.max(this._crowdSwell, 0.5);
        this._duckDepth = Math.min(this._duckDepth, A.DUCK_FLOOR + 0.25);
        this._duckHold = Math.max(this._duckHold, A.DUCK_HOLD * 0.5);
      }
    }
    if (e.type === 'gap') {
      this._crowdSwell = Math.max(this._crowdSwell, e.gap && e.gap.first ? 1.2 : 0.6);
    }
  }

  /**
   * @param state a sim snapshot
   * @returns this, so callers can read the weights straight off it
   */
  update(dt, state) {
    const A = TUNING.AUDIO;
    const speed = state.groundSpeed || 0;
    const norm = clamp(speed / TUNING.DRIVE.TOP_SPEED, 0, 1.3);
    const airborne = !!state.airborne;

    // The handoff is a *fast* crossfade, not an instant cut and not a slow
    // dissolve. Instant reads as a dropout; slow and the lip stops being an
    // event. Asymmetric on purpose: the road vanishes the moment the wheels
    // leave, and comes back a touch more gently so a landing is not a click.
    this._air = towards(this._air, airborne ? 1 : 0, airborne ? A.HANDOFF_OUT : A.HANDOFF_IN, dt);
    const air = this._air;
    const ground = 1 - air;

    // Faked gearbox: pitch resets on each shift, which is what makes speed
    // audible without looking at the HUD.
    this.gear = Math.min(A.GEARS - 1, Math.floor(norm * A.GEARS));
    const within = clamp(norm * A.GEARS - this.gear, 0, 1);
    this.rpm = A.IDLE_HZ + within * (A.REDLINE_HZ - A.IDLE_HZ);

    // Engine load: on the deck it tracks throttle and speed; in the air it
    // drops to a distant idle, because nothing is loading it.
    const load = ground * clamp(0.25 + norm * 0.75, 0, 1) + air * A.AIR_ENGINE;
    const boost = state.boosting ? A.BOOST_LIFT : 1;
    this.engine = towards(this.engine, clamp(load, 0, 1.4) * boost, 0.05, dt);
    this.cutoff = 400 + load * 2400 + norm * 900 + (state.boosting ? 700 : 0);

    // Road: surface texture under the tyres. This is the voice that makes the
    // lip land — it is the loudest thing on the ground and gone in the air.
    this.road = towards(this.road, ground * clamp(norm * 1.25, 0, 1), 0.05, dt);

    // Wind: present at speed on the ground, dominant in the air.
    this.wind = towards(this.wind, clamp(norm * 0.55 + air * 0.9, 0, 1.35), 0.09, dt);
    this.windFreq = 320 + norm * 1500 + air * 620;

    // Mechanical stress: hinges, bodywork, a chassis being asked to rotate.
    // Only in the air, and it tracks how violently the car is being flown, so
    // a wild flight sounds like it is costing the car something.
    const spin = clamp((state.rotationRate || 0) / 6, 0, 1);
    const deployed = clamp(state.panelsOut || 0, 0, 1);
    this.stress = towards(this.stress, air * clamp(0.22 + spin * 0.6 + deployed * 0.45, 0, 1), 0.11, dt);
    this.stressFreq = 150 + spin * 260 + deployed * 120;

    // Scrub: tyres pointed somewhere other than they are going.
    const slip = clamp((state.slipAngle || 0) / 0.6, 0, 1) * ground;
    this.scrub = towards(this.scrub, slip * clamp(norm * 1.5, 0, 1), 0.06, dt);
    this.scrubFreq = 1400 + slip * 700;

    // The room. A bed that rises while the car is in the air — anticipation —
    // then whatever the last landing did to it.
    this._crowdSwell = Math.max(0, this._crowdSwell - dt / A.CROWD_DECAY);
    const anticipation = air * clamp((state.airtime || 0) / 2.5, 0, 1) * 0.55;
    this.crowd = towards(this.crowd, clamp(A.CROWD_BED + anticipation + this._crowdSwell, 0, 1.4), 0.16, dt);

    // Ducking. Hold flat at depth, then recover — a bed that starts climbing
    // back the same frame it dipped never reads as having got out of the way.
    if (this._duckHold > 0) {
      this._duckHold -= dt;
      this.duck = towards(this.duck, this._duckDepth, A.DUCK_ATTACK, dt);
    } else {
      this._duckDepth = 1;
      this.duck = towards(this.duck, 1, A.DUCK_RELEASE, dt);
    }

    this.music = A.MUSIC_BED;
    return this;
  }

  /** What the ear is actually hearing from the car, ground versus air. */
  groundVoices() { return this.engine + this.road; }
  airVoices() { return this.wind + this.stress; }
}

export default Mixer;
