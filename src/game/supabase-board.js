/**
 * The Supabase board adapter (R9).
 *
 * The whole point of the adapter shape is that this file is boring. `submit`
 * and `top` are the only two functions a server ever replaces, so a real
 * backend is one HTTP call each and *nothing else in the game changes* — not
 * the boards, not the qualification rules, not the result screen, not the
 * daily. `useBoard(createSupabaseBoard({...}))` at boot is the entire switch.
 *
 * No SDK. Two REST calls against PostgREST do not justify a dependency in a
 * project whose whole runtime is three of them, and the anon key with row
 * level security is exactly the shape this needs: anybody may post a score,
 * nobody may edit somebody else's.
 *
 * Identity without accounts: each profile slot mints a `driver` uuid on first
 * use and keeps it locally. That is enough to make "one row per driver per
 * board" work, and it is honestly all a scoreboard with no login can promise
 * — see `supabase/README.md` for the schema, the policies, and what it would
 * take to harden this against somebody posting a made-up number.
 */

import { simVersion } from '../sim/version.js';
import { Storage } from '../storage/storage.js';

const DRIVER_KEY = 'driverIds';

/** A stable id for this profile slot on this machine. */
export function driverId(slot) {
  const all = Storage.read(DRIVER_KEY, {}) || {};
  if (!all[slot]) {
    all[slot] = (globalThis.crypto?.randomUUID?.())
      || `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    Storage.write(DRIVER_KEY, all);
  }
  return all[slot];
}

/**
 * @param url      the project URL, e.g. https://xxxx.supabase.co
 * @param anonKey  the publishable/anon key
 * @param table    defaults to `airtime_scores` (see supabase/0001_boards.sql)
 * @param timeout  ms before a call gives up and the caller falls back
 */
export function createSupabaseBoard({ url, anonKey, table = 'airtime_scores', timeout = 4000 }) {
  const base = `${url.replace(/\/$/, '')}/rest/v1/${table}`;
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    'Content-Type': 'application/json',
  };

  const call = async (path, init) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(base + path, { ...init, headers: { ...headers, ...init?.headers }, signal: ctl.signal });
      if (!r.ok) throw new Error(`board ${r.status}: ${await r.text()}`);
      return r.status === 204 ? null : await r.json();
    } finally { clearTimeout(t); }
  };

  return {
    name: 'supabase',

    async submit(board, key, entry) {
      // Upsert on (board, key, driver): a player beating their own score
      // replaces it rather than filling the top ten with themselves, which is
      // the same rule the local adapter keeps, enforced by a unique index
      // rather than by an array search.
      await call('?on_conflict=board,key,driver', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          board, key, driver: driverId(entry.slot),
          name: entry.name, car: entry.car, arena: entry.arena, mode: entry.mode,
          day: entry.day, value: entry.value, score: entry.score,
          medal: entry.medal, stock: entry.stock, raw: entry.raw,
          best_stunt: entry.bestStunt, sim: entry.sim, schema: entry.schema,
        }),
      });
      return this.top(board, key, 50);
    },

    async top(board, key, n = 10) {
      // §R filters server-side: a score set under different physics is not
      // comparable to a run made today, and pulling it down only to hide it
      // would cost the player their place in the list for no reason.
      const q = new URLSearchParams({
        board: `eq.${board}`, key: `eq.${key}`, sim: `eq.${simVersion()}`,
        order: 'value.desc', limit: String(n),
        select: 'name,car,arena,mode,day,value,score,medal,stock,raw,best_stunt,sim,driver',
      });
      const rows = await call(`?${q}`, { method: 'GET' });
      // Back into the shape the rest of the game reads. `slot` is local, so a
      // remote row carries the driver id in its place and the "is this me"
      // check still works for the one driver it can work for.
      const mine = new Set([0, 1, 2].map(driverId));
      return (rows || []).map((r) => ({
        ...r, bestStunt: r.best_stunt,
        slot: mine.has(r.driver) ? [0, 1, 2].findIndex((s) => driverId(s) === r.driver) : null,
      }));
    },
  };
}

/**
 * Read the board out of the environment, so pointing the game at a project is
 * configuration rather than a code change. Returns null when unset, and the
 * caller keeps the local board — an offline build is the normal case, not an
 * error case.
 */
export function boardFromEnv(env = (import.meta.env || {})) {
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createSupabaseBoard({ url, anonKey, table: env.VITE_SUPABASE_TABLE || undefined });
}
