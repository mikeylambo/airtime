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

// ── Leaderboard adapter ────────────────────────────────────────────────────
const KEY = 'board';

export const LocalBoard = {
  name: 'local',
  async submit(entry) {
    const all = Storage.read(KEY, {});
    const k = `${entry.day}:${entry.arena}:${entry.mode}`;
    const list = all[k] || [];
    const mine = list.findIndex((e) => e.name === entry.name);
    if (mine >= 0) { if (entry.score > list[mine].score) list[mine] = entry; }
    else list.push(entry);
    list.sort((a, b) => b.score - a.score);
    all[k] = list.slice(0, 50);
    Storage.write(KEY, all);
    return all[k];
  },
  async top(day, arena, mode, n = 10) {
    const all = Storage.read(KEY, {});
    // §R: scores set under different physics are stored but never shown —
    // they are not comparable to a run made today.
    return (all[`${day}:${arena}:${mode}`] || []).filter(simCurrent).slice(0, n);
  },
};

/**
 * Swap this for a Supabase-backed board when there is a project to point at.
 * Nothing above this line changes.
 */
export let Board = LocalBoard;
export function useBoard(adapter) { Board = adapter; }
