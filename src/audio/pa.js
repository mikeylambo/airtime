/**
 * The PA (R7's debt).
 *
 * The premium-feel pass owed "a PA", and the trap in that word is that it
 * means *an announcer*, which means voice acting, which means a recording
 * budget, a localisation problem, and a line the player will have heard four
 * hundred times by hour three. This build synthesises every sound it makes.
 *
 * So the PA here is what a PA actually sounds like from inside a car at
 * seventy: **not words — a room.** A tannoy two hundred metres away, band-
 * limited to a telephone, syllabic rather than semantic, arriving late and
 * bouncing off buildings. You know somebody announced something. You could not
 * repeat it. That is the correct amount of information, and it is the honest
 * version of the fiction rather than a placeholder for a voice pack.
 *
 * Like the mix, this is a pure model with no audio API in it: what it produces
 * is a level, a rate and a formant, and `audio.js` pushes those onto nodes.
 * The rules it encodes are all restraint:
 *
 * - It speaks for **events worth announcing**, not for every landing.
 * - It **never talks over itself**, and there is a floor between calls.
 * - It **ducks the crowd and the bed** while it speaks, and it is itself
 *   ducked by anything the car is doing — a PA that beats the engine is a
 *   menu, not a stadium.
 * - It is an **arena property**. A stunt park in a void has nobody to announce
 *   anything; a city has a PA on every block.
 */

import TUNING from '../TUNING.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const towards = (cur, want, tau, dt) =>
  cur + (want - cur) * (1 - Math.exp(-dt / Math.max(1e-4, tau)));

/** Why the PA spoke, in order of who wins when two land at once. */
export const CALLS = [
  { id: 'record', weight: 5, syllables: 7 },   // a personal best
  { id: 'gap', weight: 4, syllables: 6 },      // a named gap, discovered
  { id: 'secret', weight: 4, syllables: 5 },   // the x5 pad
  { id: 'huge', weight: 3, syllables: 6 },     // a very big stick
  { id: 'chain', weight: 2, syllables: 4 },    // a long chain
  { id: 'crash', weight: 1, syllables: 3 },    // sympathy, essentially
];

const CALL = Object.fromEntries(CALLS.map((c) => [c.id, c]));

export class PA {
  constructor() { this.reset(); }

  reset() {
    this.level = 0;         // 0..1, what audio.js drives the tannoy bus with
    this.syllable = 0;      // 0..1 within the current syllable, for the gate
    this.rate = 0;          // syllables per second while speaking
    this.formant = 700;     // Hz — the vowel-ish centre, wandering per call
    this.speaking = null;   // the call id, or null
    this._left = 0;         // syllables remaining
    this._t = 0;
    this._cooldown = 0;
    this.enabled = false;   // arenas turn it on
    this.calls = 0;
  }

  /** A stunt park in a void has no PA. A city does. */
  setArena(arenaId) {
    this.enabled = TUNING.PA.ARENAS.includes(arenaId);
    if (!this.enabled) { this.speaking = null; this.level = 0; }
  }

  /**
   * Ask for a call.
   * @returns true if the PA took it
   */
  say(id) {
    const P = TUNING.PA;
    const call = CALL[id];
    if (!this.enabled || !call) return false;
    // It never talks over itself, and never twice in a row without a gap: a
    // tannoy that reacts to everything stops being a room and becomes a
    // commentary track.
    if (this._cooldown > 0) return false;
    if (this.speaking && (CALL[this.speaking]?.weight || 0) >= call.weight) return false;
    this.speaking = id;
    this._left = call.syllables;
    this._t = 0;
    // Each call sits somewhere different in the vowel space, so two calls in a
    // round do not sound like the same tape.
    this.formant = P.FORMANT_LOW
      + ((call.weight * 2657 + this.calls * 977) % 1000) / 1000 * (P.FORMANT_HIGH - P.FORMANT_LOW);
    this.rate = P.RATE;
    this.calls++;
    return true;
  }

  /**
   * @param carLoad 0..1 — how busy the car is. The PA is ducked *by* the car,
   *        never the other way round.
   */
  update(dt, carLoad = 0) {
    const P = TUNING.PA;
    if (this._cooldown > 0) this._cooldown = Math.max(0, this._cooldown - dt);

    if (this.speaking) {
      this._t += dt * this.rate;
      while (this._t >= 1 && this._left > 0) { this._t -= 1; this._left--; }
      this.syllable = this._t;
      if (this._left <= 0) {
        this.speaking = null;
        this._cooldown = P.COOLDOWN;
      }
    } else {
      this.syllable = 0;
    }

    // Distance and a busy car both push it down; it never fully disappears
    // while speaking, or the fiction goes with it.
    const want = this.speaking
      ? P.LEVEL * (1 - P.CAR_DUCK * clamp(carLoad, 0, 1))
      : 0;
    this.level = towards(this.level, want, this.speaking ? P.ATTACK : P.RELEASE, dt);
    return this.level;
  }

  /** How much the PA ducks everything else while it is talking. */
  get duck() {
    return 1 - TUNING.PA.BED_DUCK * (this.level / Math.max(1e-4, TUNING.PA.LEVEL));
  }
}

export default PA;
