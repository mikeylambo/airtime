/**
 * State-based replay (§6.1).
 *
 * "Rapier is deterministic, so a replay is inputs + seed — a few KB."
 *
 * Nothing about the world is stored. A clip is the arena, the garage setup, the
 * seed and the action stream, and the theater re-simulates it. That is why the
 * same clip can be re-shot under any camera afterwards: it is not footage, it
 * is the run itself, played again.
 *
 * The stream is change-encoded — actions only change when the player's hands
 * move, so a 90 second run is a few hundred entries rather than 10,800.
 */

import TUNING from '../TUNING.js';

const KEYS = ['throttle', 'brake', 'steer', 'boost', 'handbrake',
  'stickX', 'stickY', 'doorL', 'doorR', 'hood', 'trunk', 'spoiler'];

// Quantise analog inputs to 1/32. A player's thumb does not resolve finer than
// that, and storing two decimal places made every frame of a steering sweep a
// new row — a 90 second run went from a few KB to a hundred.
const q = (v) => Math.round(v * 32) / 32;

function pack(a) {
  const out = [];
  for (const k of KEYS) out.push(typeof a[k] === 'boolean' ? (a[k] ? 1 : 0) : q(a[k] || 0));
  return out;
}

function same(a, b) {
  if (!a || !b) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function unpack(row) {
  const a = {};
  KEYS.forEach((k, i) => {
    const v = row[i];
    a[k] = (k === 'boost' || k === 'handbrake') ? !!v : v;
  });
  a.thrust = false;
  a.reset = false;
  a.cycleCamera = false;
  a.cycleStyle = false;
  return a;
}

export class Recorder {
  constructor({ arena, setup, seed = TUNING.SIM.SEED, profile = null }) {
    this.meta = {
      arena, seed,
      car: setup?.car?.id || 'dart',
      livery: setup?.livery?.id || 'stock',
      tune: profile?.tune ? { ...profile.tune } : null,
      parts: profile?.parts ? { ...profile.parts } : null,
      hz: TUNING.SIM.HZ,
      created: Date.now(),
    };
    this.frames = [];       // [step, packed]
    this.edges = [];        // [step, 'thrust'|'reset']
    this.step = 0;
    this.lastPacked = null;
  }

  record(actions, edges) {
    const p = pack(actions);
    if (!same(p, this.lastPacked)) {
      this.frames.push([this.step, p]);
      this.lastPacked = p;
    }
    if (edges && edges.thrust) this.edges.push([this.step, 'thrust']);
    if (edges && edges.reset) this.edges.push([this.step, 'reset']);
    this.step++;
  }

  /** A clip is a window into this run's stream, not a copy of it. */
  clip(fromStep, toStep, info) {
    const pre = Math.round(TUNING.REPLAY.PREROLL * TUNING.SIM.HZ);
    const post = Math.round(TUNING.REPLAY.POSTROLL * TUNING.SIM.HZ);
    const start = Math.max(0, fromStep - pre);
    const end = Math.min(this.step, toStep + post);
    return {
      id: `clip_${this.meta.created}_${fromStep}`,
      meta: this.meta,
      start, end,
      // Only the frames the window needs, plus the state entering it.
      frames: this.framesFor(start, end),
      edges: this.edges.filter(([s]) => s >= 0 && s <= end),
      info,
    };
  }

  framesFor(start, end) {
    const out = [];
    let carry = null;
    for (const f of this.frames) {
      if (f[0] < start) { carry = f; continue; }
      if (f[0] > end) break;
      out.push(f);
    }
    // Everything before the window still has to run to get the car there, so
    // the whole prefix is kept — it is only a few hundred rows.
    return carry ? [...this.frames.filter((f) => f[0] < start), ...out] : out;
  }

  get sizeBytes() { return JSON.stringify(this.frames).length; }
}

/** Feeds a recorded stream back into a sim, step for step. */
export class Player {
  constructor(clip) {
    this.clip = clip;
    this.step = 0;
    this.i = 0;
    this.current = unpack(clip.frames[0] ? clip.frames[0][1] : new Array(KEYS.length).fill(0));
    this.edgeI = 0;
  }

  get length() { return this.clip.end; }
  get done() { return this.step >= this.clip.end; }

  /** @returns {{actions, edges}} for this step. */
  next() {
    while (this.i < this.clip.frames.length && this.clip.frames[this.i][0] <= this.step) {
      this.current = unpack(this.clip.frames[this.i][1]);
      this.i++;
    }
    const edges = {};
    while (this.edgeI < this.clip.edges.length && this.clip.edges[this.edgeI][0] <= this.step) {
      edges[this.clip.edges[this.edgeI][1]] = true;
      this.edgeI++;
    }
    this.step++;
    return { actions: this.current, edges };
  }

  seek(step) {
    this.step = 0; this.i = 0; this.edgeI = 0;
    this.current = unpack(this.clip.frames[0] ? this.clip.frames[0][1] : new Array(KEYS.length).fill(0));
    return step;
  }
}
