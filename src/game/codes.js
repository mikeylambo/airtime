/**
 * Run codes (R11).
 *
 * The replay architecture's quiet gift: a clip is inputs and a seed, so a run
 * is a few kilobytes of JSON, so **a run is a string you can paste to
 * somebody**. No upload, no account, no server, no video — and what they get
 * is not a recording of your run, it is your run, re-simulated on their
 * machine to the same metre (§R measured it at 0.0 m, bit-exact).
 *
 * That makes the cheapest content-creation feature in the plan also the most
 * native one. Video export exists too (main.js, MediaRecorder) and is what you
 * post; a code is what you send to somebody who is going to *try to beat it*,
 * because a code loads as a ghost.
 *
 * The format is deliberately boring: JSON, deflated where the platform offers
 * it, base64url. It carries the §R stamps, so a code from a different physics
 * build is refused with a reason rather than replayed into nonsense.
 */

import { simVersion, SCHEMA_VERSION, simCurrent } from '../sim/version.js';

const MAGIC = 'AT1';

const toB64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64 = (str) => {
  const b = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
};

/** CompressionStream is not everywhere; an uncompressed code is still a code. */
async function deflate(text) {
  const bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'undefined') return { z: 0, bytes };
  const cs = new CompressionStream('deflate-raw');
  const buf = await new Response(
    new Blob([bytes]).stream().pipeThrough(cs)
  ).arrayBuffer();
  return { z: 1, bytes: new Uint8Array(buf) };
}

async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('no DecompressionStream');
  const ds = new DecompressionStream('deflate-raw');
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new TextDecoder().decode(new Uint8Array(buf));
}

/**
 * A ghost record (game/ghosts.js) as a shareable code.
 * @returns `AT1.<z>.<base64url>`
 */
export async function encodeRun(record) {
  const payload = {
    v: SCHEMA_VERSION,
    sim: record.sim || simVersion(),
    name: record.name,
    score: record.score,
    medal: record.medal || null,
    arena: record.arena,
    mode: record.mode,
    car: record.car,
    created: record.created,
    clip: record.clip,
  };
  const { z, bytes } = await deflate(JSON.stringify(payload));
  return `${MAGIC}.${z}.${toB64(bytes)}`;
}

/**
 * @returns { ok: true, record } or { ok: false, why } — never a throw, because
 *          this is fed by a text box somebody pasted into.
 */
export async function decodeRun(code) {
  const trimmed = String(code || '').trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3 || parts[0] !== MAGIC) {
    return { ok: false, why: 'that is not a run code' };
  }
  let text;
  try {
    const bytes = fromB64(parts[2]);
    text = parts[1] === '1' ? await inflate(bytes) : new TextDecoder().decode(bytes);
  } catch {
    return { ok: false, why: 'that code is damaged' };
  }
  let d;
  try { d = JSON.parse(text); } catch { return { ok: false, why: 'that code is damaged' }; }
  if (!d || !d.clip || !d.clip.streams) return { ok: false, why: 'that code has no run in it' };
  // §R: a code from a different physics build would re-simulate into a
  // different flight, so it is refused with a reason rather than played.
  if (!simCurrent(d)) {
    return { ok: false, why: `that run was set under different physics (${d.sim} vs ${simVersion()})` };
  }
  return {
    ok: true,
    record: {
      id: `code_${d.created || Date.now()}`,
      name: d.name || 'A DRIVER',
      score: d.score || 0,
      medal: d.medal || null,
      arena: d.arena,
      mode: d.mode,
      car: d.car,
      created: d.created || Date.now(),
      sim: d.sim,
      clip: d.clip,
    },
  };
}

/** For the screen: how long a code will be, before making one. */
export const codeLength = (code) => code.length;
