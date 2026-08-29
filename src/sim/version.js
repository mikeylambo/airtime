/**
 * §R — the simulation's identity stamp (airtime-release-systems.md).
 *
 * Every clip, ghost and board entry re-simulates inputs, so all of them are
 * orphaned by any change that makes the same input stream produce a different
 * flight. Nothing here relies on a human remembering that: the stamp is a
 * hash of every physics-affecting TUNING section, so a suspension tweak
 * changes it automatically. The hand-bumped counter exists for the changes a
 * hash cannot see — physics *code*, not physics numbers.
 */

import TUNING from '../TUNING.js';

/** Bump when simulation code changes behaviour without touching TUNING. */
export const SIM_CODE_VERSION = 1;

/** Bump when the shape of a persisted record changes. */
export const SCHEMA_VERSION = 1;

// Sections the simulation actually reads. CAMERA/RENDER/FX/AUDIO/UI/HUD/
// REPLAY/TELEMETRY are presentation; INPUT shapes hands into actions *before*
// they are recorded, so a recorded stream is immune to it.
const SIM_SECTIONS = [
  'SIM', 'CAR', 'WHEEL', 'DRIVE', 'BOOST', 'THRUST', 'PANELS', 'AERO',
  'AIRTIME', 'TRAFFIC', 'SCORE', 'MODES', 'GAPS', 'RESPAWN', 'RUN', 'ARENA',
];

// Keys the game mutates at runtime as player options. They do affect the sim,
// which is exactly why they are recorded on each clip's meta instead of being
// part of the build-wide stamp.
const RUNTIME_KEYS = { TRAFFIC: ['MODE'] };

function fnv(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable stringify: object keys sorted, so key order can never fake a change. */
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
}

let cached = null;

/** The stamp, e.g. "1.k3fa9z". Cheap to call; computed once. */
export function simVersion() {
  if (cached) return cached;
  const parts = [];
  for (const s of SIM_SECTIONS) {
    const src = TUNING[s];
    if (!src) continue;
    const skip = RUNTIME_KEYS[s];
    const obj = skip
      ? Object.fromEntries(Object.entries(src).filter(([k]) => !skip.includes(k)))
      : src;
    parts.push(`${s}=${stable(obj)}`);
  }
  cached = `${SIM_CODE_VERSION}.${fnv(parts.join(';')).toString(36)}`;
  return cached;
}

/** Does this persisted record re-simulate under the current build? */
export function simCurrent(record) {
  const stamp = record && (record.sim || (record.meta && record.meta.sim));
  return stamp === simVersion();
}
