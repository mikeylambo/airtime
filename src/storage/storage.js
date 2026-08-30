/**
 * Persistence — localStorage now, Supabase later (§2 profile select).
 *
 * One namespaced key per concern so a corrupt blob can never take the whole
 * save down with it. Every read is defensive: a bad value falls back to the
 * default rather than throwing on boot.
 */

const NS = 'airtime';
const key = (k) => `${NS}:${k}`;

function read(k, fallback) {
  try {
    const raw = localStorage.getItem(key(k));
    if (raw == null) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch { return fallback; }
}

function write(k, v) {
  try { localStorage.setItem(key(k), JSON.stringify(v)); return true; }
  catch { return false; }
}

function drop(k) {
  try { localStorage.removeItem(key(k)); } catch { /* private mode */ }
}

export const Storage = { read, write, drop, key };

// ── Options (§2 Options screen) ───────────────────────────────────────────
export const DEFAULT_OPTIONS = {
  artStyle: 'afterglow',       // 'afterglow' | 'graybox' (legacy names remap)
  cameraStyle: 'cinematic',    // 'cinematic' | 'classic'
  traffic: 'reactive',         // 'reactive' | 'ambient'  (§4)
  musicVolume: 0.7,
  sfxVolume: 0.9,
  haptics: true,
  colorblindTrails: false,
  reduceEffects: false,        // release spec §A — ships the same day the look does
  showTelemetry: false,
  invertPitch: false,
  manualAir: false,
  mute: false,           // per-panel air controls for anyone who wants them
  // §A. Overrides only, never the whole map: a saved map from an older build
  // that is missing a verb would leave the car unsteerable, so anything absent
  // falls back to the default binding at load.
  bindings: {},
  // §A. The photosensitivity notice is shown once, before the first round, and
  // acknowledged. Storing the acknowledgement rather than a "don't show me"
  // preference means it cannot be dismissed by accident and never seen.
  seenPhotoWarning: false,
};

export function loadOptions() {
  const o = read('options', {});
  return { ...DEFAULT_OPTIONS, ...(o && typeof o === 'object' ? o : {}) };
}

export function saveOptions(o) { return write('options', o); }
