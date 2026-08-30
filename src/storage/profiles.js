/**
 * Profiles (§2: "3 slots, localStorage now, Supabase later").
 *
 * Each slot carries everything §8 progresses: medals per arena per mode,
 * licence grades, unlocks, the garage wall of saved clips, and best scores.
 */

import { Storage } from './storage.js';

export const SLOTS = 3;

const blank = (i) => ({
  slot: i,
  name: `DRIVER ${i + 1}`,
  created: null,
  seconds: 0,
  runs: 0,
  best: {},              // `${arena}:${mode}` -> score
  medals: {},            // `${arena}:${mode}` -> 'bronze'|'silver'|'gold'|'platinum'
  licences: {},          // testId -> 'bronze'|'silver'|'gold'
  // Cars are never in here as a gate — the roster's law is that unlocking a
  // car is unlocking a technique, never a tier. What a ladder hands out is
  // places to drive and reasons to go back (game/challenges.js UNLOCKS).
  unlocked: { cars: 'all', arenas: ['park'], parts: [], liveries: ['stock'], modes: [], trials: [] },
  gaps: [],           // named gaps discovered, ever (R6)
  challenges: {},        // R9: challengeId -> when it was completed
  gauntlet: 0,           // R9: deepest Gauntlet attempt, ever
  friends: [],           // R9: names whose scores show on the FRIENDS board
  car: 'vector',
  livery: 'stock',
  tune: { weight: 0.5, suspension: 0.5, thrust: 0.5, aero: 0.5 },
  parts: { doors: 'stock', hood: 'stock', trunk: 'stock', spoiler: 'stock' },
  wall: [],              // §8 garage wall: saved replay ids
  landingRate: 0,
});

export function loadAll() {
  const raw = Storage.read('profiles', null);
  const out = [];
  for (let i = 0; i < SLOTS; i++) {
    const p = raw && raw[i] ? { ...blank(i), ...raw[i] } : blank(i);
    p.slot = i;
    out.push(p);
  }
  return out;
}

export function saveAll(list) { return Storage.write('profiles', list); }

export function activeSlot() { return Storage.read('activeSlot', null); }
export function setActiveSlot(i) { return Storage.write('activeSlot', i); }

export function medalRank(m) {
  return { platinum: 4, gold: 3, silver: 2, bronze: 1 }[m] || 0;
}

/** Total medals across everything — the currency §8 unlocks against. */
export function medalCount(p) {
  return Object.values(p.medals || {}).reduce((a, m) => a + medalRank(m), 0);
}

export function recordRun(profile, arena, mode, summary) {
  const key = `${arena}:${mode}`;
  profile.runs++;
  if (!profile.created) profile.created = Date.now();
  if (!profile.best[key] || summary.score > profile.best[key]) profile.best[key] = summary.score;
  if (summary.medal && medalRank(summary.medal) > medalRank(profile.medals[key])) {
    profile.medals[key] = summary.medal;
  }
  profile.landingRate = summary.landingRate;
  return profile;
}
