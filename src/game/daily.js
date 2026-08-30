/**
 * Daily seed and the leaderboard (§8, Signal pattern).
 *
 * The seed is the date, so everyone gets the same variant on the same day
 * without a server having to hand one out. The board is a local adapter today;
 * `submit` and `top` are the only two functions a Supabase table would have to
 * replace, and nothing else in the game knows the difference.
 */

import { Storage } from '../storage/storage.js';
import { simCurrent } from '../sim/version.js';

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Deterministic 32-bit hash of the day string — the run's variant seed. */
export function dailySeed(day = todayKey()) {
  let h = 2166136261;
  for (let i = 0; i < day.length; i++) {
    h ^= day.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The variant the seed produces. Deliberately small: §8 asks for a daily
 * *variant*, not a different arena, so a player's muscle memory still applies.
 */
export function dailyVariant(seed = dailySeed()) {
  const pick = (n, salt) => Math.floor(((seed ^ (salt * 2654435761)) >>> 0) % n);
  const arenas = ['park', 'city'];
  const traffic = ['reactive', 'ambient'];
  return {
    seed,
    arena: arenas[pick(arenas.length, 1)],
    traffic: traffic[pick(2, 2)],
    // Wind is a nudge, not a wall: enough to change a line, never to ruin one.
    wind: -0.6 + ((pick(1000, 3) / 1000) * 1.2),
    day: todayKey(),
  };
}

/**
 * The daily set (R11).
 *
 * Three challenges, chosen by the date, the same three for everybody. They are
 * drawn from the ladder that already exists rather than being a second kind of
 * objective — a daily that asks for something the game does not otherwise ask
 * for is a second game, and this one is capped-content on purpose.
 *
 * Deliberately *not* weighted toward the easy end. The point of a daily is
 * that on some days it asks you for something you are bad at, which is the
 * only mechanism in the design that reliably makes somebody drive an arena
 * they had written off.
 */
export function dailySet(challenges, day = todayKey()) {
  const seed = dailySeed(day);
  const pool = challenges.filter((c) => !c.mode);   // a daily never gates on a mode
  const picked = [];
  for (let k = 0; picked.length < 3 && k < 64; k++) {
    const i = ((seed ^ (k * 2654435761)) >>> 0) % pool.length;
    const c = pool[i];
    if (c && !picked.includes(c)) picked.push(c);
  }
  return { day, seed, challenges: picked };
}

// ── Leaderboard adapter ────────────────────────────────────────────────────
// Two functions, and a board id. R9 files a run onto every board it qualifies
// for (game/boards.js), so the adapter takes *which* board as well as which
// key — that is what lets a server index and filter them itself instead of
// pulling every score down and sorting on the client.

const KEY = 'board';

export const LocalBoard = {
  name: 'local',

  async submit(board, key, entry) {
    const all = Storage.read(KEY, {});
    const k = `${board}/${key}`;
    const list = all[k] || [];
    // One row per driver per board. A player who beats their own score
    // replaces it rather than filling the top ten with themselves.
    const mine = list.findIndex((e) => e.slot === entry.slot);
    if (mine >= 0) { if (entry.value > list[mine].value) list[mine] = entry; }
    else list.push(entry);
    list.sort((a, b) => b.value - a.value);
    all[k] = list.slice(0, 50);
    Storage.write(KEY, all);
    return all[k];
  },

  async top(board, key, n = 10) {
    const all = Storage.read(KEY, {});
    // §R: scores set under different physics are stored but never shown —
    // they are not comparable to a run made today.
    return (all[`${board}/${key}`] || []).filter(simCurrent).slice(0, n);
  },
};

/**
 * The adapter the game talks to. `useBoard` swaps in the Supabase one
 * (game/supabase-board.js) when there is a project to point at; nothing above
 * this line changes, and nothing else in the game knows the difference.
 */
export let Board = LocalBoard;
export function useBoard(adapter) { Board = adapter; }
