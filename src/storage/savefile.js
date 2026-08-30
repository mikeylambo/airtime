/**
 * §S — save export and import.
 *
 * Everything the game knows about a player lives in localStorage, which is the
 * most fragile place a save has ever lived: it does not survive a cleared
 * browser, a private window, a new machine, or a domain change, and it goes
 * without warning. A hundred and forty-eight challenges and eighteen Gauntlet
 * stages is a lot of hours to keep somewhere that a "clear browsing data" can
 * erase by accident.
 *
 * So: one file, out and back.
 *
 * **Every namespaced key, not a list of them.** The obvious implementation
 * enumerates the keys it knows about — options, profiles, boards, ghosts. That
 * implementation is wrong the first time somebody adds a key and forgets to
 * add it here, and the failure is silent and only shows up as *somebody
 * else's* lost progress. So the export sweeps the `airtime:` prefix and takes
 * whatever it finds. A new system is backed up the day it ships, by default.
 *
 * **The §R stamps ride along.** A save carries the schema version and the sim
 * identity it was made under. Progress is portable across physics changes —
 * a medal is a medal — but ghosts and clips are inputs that re-simulate, so a
 * save from different physics is imported *with those dropped*, and the import
 * says so, rather than filling the theater with runs that no longer happen.
 */

import { Storage } from './storage.js';
import { SCHEMA_VERSION, simVersion } from '../sim/version.js';

const MAGIC = 'AIRTIME-SAVE';
const PREFIX = 'airtime:';

/** Keys whose contents are re-simulated inputs, and so are physics-bound. */
const PHYSICS_BOUND = (k) => k === 'ghosts' || k.startsWith('ghosts:');

/** Every namespaced key currently in storage. */
function allKeys() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const raw = localStorage.key(i);
      if (raw && raw.startsWith(PREFIX)) out.push(raw.slice(PREFIX.length));
    }
  } catch { /* private mode: nothing to export, and that is the honest answer */ }
  return out.sort();
}

/** The whole save, as a plain object ready to be stringified. */
export function exportSave() {
  const data = {};
  for (const k of allKeys()) {
    const v = Storage.read(k, undefined);
    if (v !== undefined) data[k] = v;
  }
  return {
    magic: MAGIC,
    schema: SCHEMA_VERSION,
    sim: simVersion(),
    created: Date.now(),
    keys: Object.keys(data).length,
    data,
  };
}

export function exportSaveText() {
  return JSON.stringify(exportSave(), null, 1);
}

/** `airtime-save-2026-08-30.json` — dated, because people keep several. */
export function saveFilename(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `airtime-save-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}

/**
 * Read a save back.
 *
 * Never throws: this is fed by a file somebody picked off their desktop.
 *
 * @returns { ok: true, written, skipped, staleSim } | { ok: false, why }
 */
export function importSave(text, { apply = true } = {}) {
  let d;
  try { d = JSON.parse(String(text || '')); }
  catch { return { ok: false, why: 'that file is not a save (it is not even JSON)' }; }

  if (!d || d.magic !== MAGIC) return { ok: false, why: 'that file is not an AIRTIME save' };
  if (!d.data || typeof d.data !== 'object') return { ok: false, why: 'that save has nothing in it' };
  // A save from a *newer* build may contain shapes this one cannot read, and
  // writing it would corrupt a working profile rather than fail cleanly.
  if (typeof d.schema === 'number' && d.schema > SCHEMA_VERSION) {
    return { ok: false, why: `that save is from a newer build (schema ${d.schema} vs ${SCHEMA_VERSION})` };
  }

  const staleSim = d.sim !== simVersion();
  const written = [];
  const skipped = [];
  for (const [k, v] of Object.entries(d.data)) {
    // §R: a ghost is an input stream. Under different physics it re-simulates
    // into a different flight, so importing it would be importing a lie about
    // what somebody did.
    if (staleSim && PHYSICS_BOUND(k)) { skipped.push(k); continue; }
    if (apply && !Storage.write(k, v)) { skipped.push(k); continue; }
    written.push(k);
  }
  return { ok: true, written, skipped, staleSim, sim: d.sim, created: d.created };
}

/**
 * A one-line account of what an import did, for the screen to show.
 * Reads the result rather than re-deriving it, so it cannot disagree.
 */
export function describeImport(r) {
  if (!r.ok) return r.why;
  const n = r.written.length;
  const base = `${n} ${n === 1 ? 'entry' : 'entries'} restored`;
  if (!r.skipped.length) return `${base}.`;
  return r.staleSim
    ? `${base}; ${r.skipped.length} skipped — those runs were set under different physics.`
    : `${base}; ${r.skipped.length} could not be written.`;
}
