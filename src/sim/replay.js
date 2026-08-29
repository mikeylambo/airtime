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
import { simVersion, SCHEMA_VERSION } from './version.js';

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

/** Hands off the wheel — what the sim sees during a countdown. */
export function neutralActions() {
  return unpack(new Array(KEYS.length).fill(0));
}

export class Recorder {
  constructor({ arena, setup, seed = TUNING.SIM.SEED, profile = null, players = 1,
                mode = 'stunt', duration = undefined }) {
    this.meta = {
      arena, seed, mode, players, duration,
      car: setup?.car?.id || 'vector',
      livery: setup?.livery?.id || 'stock',
      tune: profile?.tune ? { ...profile.tune } : null,
      parts: profile?.parts ? { ...profile.parts } : null,
      hz: TUNING.SIM.HZ,
      // §R: everything a re-simulation depends on that is not in the stream.
      // The traffic mode is a player option the sim reads live, and the stamp
      // is what tells a future build this stream still means the same flight.
      traffic: TUNING.TRAFFIC.MODE,
      sim: simVersion(),
      schema: SCHEMA_VERSION,
      created: Date.now(),
    };
    // One stream per driver: split-screen clips have to replay everybody,
    // because the cars share a world and shove each other around in it.
    this.streams = [];
    for (let i = 0; i < players; i++) this.streams.push({ frames: [], edges: [], last: null });
    this.step = 0;
  }

  /**
   * Record one step — and hand back the *canonical* actions, quantised
   * exactly as stored. The caller must feed those to the sim, not its raw
   * ones: playback can only ever replay what was written down, so if the
   * live sim stepped on un-quantised sticks the recording would be a run
   * that never quite happened, and every clip would drift from the truth
   * (§R — measured at hundreds of metres over 40 s before this).
   */
  record(actions, edges) {
    const A = (i) => (Array.isArray(actions) ? actions[i] || {} : actions);
    const E = (i) => (Array.isArray(edges) ? edges[i] || {} : edges);
    const canon = [];
    for (let i = 0; i < this.streams.length; i++) {
      const st = this.streams[i];
      const p = pack(A(i));
      if (!same(p, st.last)) { st.frames.push([this.step, p]); st.last = p; }
      canon.push(unpack(p));
      const e = E(i);
      if (e.thrust) st.edges.push([this.step, 'thrust']);
      if (e.reset) st.edges.push([this.step, 'reset']);
    }
    this.step++;
    return Array.isArray(actions) ? canon : canon[0];
  }

  /**
   * A clip is a window into this round's streams, not a copy of them.
   * @param focus which driver the camera should follow
   */
  clip(fromStep, toStep, info, focus = 0) {
    const pre = Math.round(TUNING.REPLAY.PREROLL * TUNING.SIM.HZ);
    const post = Math.round(TUNING.REPLAY.POSTROLL * TUNING.SIM.HZ);
    const start = Math.max(0, fromStep - pre);
    const end = Math.min(this.step, toStep + post);
    return {
      id: `clip_${this.meta.created}_${focus}_${fromStep}`,
      // A snapshot, never a live reference: a saved clip must not change when
      // the recorder (or a later clip) does (§R).
      meta: {
        ...this.meta,
        tune: this.meta.tune ? { ...this.meta.tune } : null,
        parts: this.meta.parts ? { ...this.meta.parts } : null,
      },
      start, end, focus,
      // The prefix has to be kept: a deterministic replay runs from step zero,
      // so the frames before the window are what get the car there at all.
      streams: this.streams.map((st) => ({
        frames: st.frames.filter((f) => f[0] <= end),
        edges: st.edges.filter((e) => e[0] <= end),
      })),
      info,
    };
  }

  get sizeBytes() { return JSON.stringify(this.streams).length; }
  get frames() { return this.streams[0].frames; }
}

/** Feeds recorded streams back into a sim, step for step. */
export class Player {
  constructor(clip) {
    this.clip = clip;
    this.streams = clip.streams || [{ frames: clip.frames || [], edges: clip.edges || [] }];
    this.reset();
  }

  reset() {
    this.step = 0;
    this.cursors = this.streams.map(() => ({ i: 0, e: 0 }));
    this.current = this.streams.map((st) =>
      unpack(st.frames[0] ? st.frames[0][1] : new Array(KEYS.length).fill(0)));
  }

  get length() { return this.clip.end; }
  get done() { return this.step >= this.clip.end; }

  /** @returns {{actions: object[], edges: object[]}} one entry per driver. */
  next() {
    const edges = this.streams.map(() => ({}));
    for (let i = 0; i < this.streams.length; i++) {
      const st = this.streams[i];
      const c = this.cursors[i];
      while (c.i < st.frames.length && st.frames[c.i][0] <= this.step) {
        this.current[i] = unpack(st.frames[c.i][1]);
        c.i++;
      }
      while (c.e < st.edges.length && st.edges[c.e][0] <= this.step) {
        edges[i][st.edges[c.e][1]] = true;
        c.e++;
      }
    }
    this.step++;
    return { actions: this.current, edges };
  }

  seek() { this.reset(); return 0; }
}
