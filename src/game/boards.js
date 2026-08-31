/**
 * The seven boards (R9, §"The competitive layer").
 *
 * "Not one scoreboard — seven: arena overall, vehicle-specific, stock setup,
 * best single stunt, RAW/no-wing, daily seed, friends."
 *
 * Seven boards is not seven leaderboards bolted together, it is one idea:
 * **a run is filed everywhere it qualifies.** A stock VECTOR run on today's
 * seed with every landing RAW lands on five of them at once, and the player
 * who is nowhere near the top of the arena board can be first in the world on
 * the one they actually care about. That is the whole retention argument for
 * a game with a capped amount of content.
 *
 * The adapter contract is still exactly two functions —
 *
 *     submit(board, key, entry) -> the board, sorted
 *     top(board, key, n)        -> the top n
 *
 * — because a server has to be able to index and filter these itself. Six of
 * the boards are stored; **friends is a lens**, not a table, because a friend
 * list is a fact about a client rather than about a score.
 */

import { Board } from './daily.js';
import { simCurrent } from '../sim/version.js';
import { medalRank } from '../storage/profiles.js';

/** A setup nobody has touched — the board for people who want the car, plain. */
export function isStock(profile) {
  const t = profile.tune || {};
  const p = profile.parts || {};
  const flat = ['weight', 'suspension', 'thrust', 'aero'].every((k) => (t[k] ?? 0.5) === 0.5);
  const plain = ['doors', 'hood', 'trunk', 'spoiler'].every((k) => (p[k] || 'stock') === 'stock');
  return flat && plain;
}

/**
 * A RAW run: every landing that scored did so without a stabiliser.
 *
 * Per-landing purity already exists (facets.js) and already pays. This is the
 * run-level version, and it is deliberately unforgiving — one thrust burst to
 * rescue one flight costs the whole run's place on this board, which is what
 * makes the board worth being on.
 */
export function isRaw(summary) {
  const scoring = (summary.landings || []).filter((l) => l.landed && l.counted !== false);
  return scoring.length > 0 && scoring.every((l) => l.purity && l.purity.id === 'raw');
}

export const bestStuntOf = (summary) =>
  (summary.landings || []).reduce((a, l) => Math.max(a, l.landed ? (l.total || 0) : 0), 0);

/**
 * Everything the boards need to know about a run, computed once.
 * @param ctx { profile, arena, mode, day, daily }
 */
export function entryFromRun(summary, ctx) {
  return {
    name: ctx.profile.name,
    slot: ctx.profile.slot,
    car: ctx.profile.car,
    arena: ctx.arena,
    mode: ctx.mode,
    day: ctx.day,
    score: summary.score,
    medal: summary.medal || null,
    bestStunt: bestStuntOf(summary),
    stock: isStock(ctx.profile),
    raw: isRaw(summary),
    // Was this run made on today's daily variant, or just on the same day?
    daily: !!ctx.daily,
    landingRate: summary.landingRate || 0,
    // §R travels with the row: a score set under different physics is stored
    // but never shown, because it is not comparable to a run made today.
    sim: summary.sim,
    schema: summary.schema,
    at: Date.now(),
  };
}

const arenaKey = (e) => `${e.arena}:${e.mode}`;

export const BOARDS = [
  {
    id: 'arena', label: 'ARENA', blurb: 'Every run, every car, every setup.',
    key: arenaKey, value: (e) => e.score, qualifies: () => true,
  },
  {
    id: 'car', label: 'BY VEHICLE', blurb: 'One car at a time. No car is better, so this is the only fair comparison.',
    key: (e) => `${e.arena}:${e.mode}:${e.car}`, value: (e) => e.score, qualifies: () => true,
  },
  {
    id: 'stock', label: 'STOCK SETUP', blurb: 'Nothing tuned, nothing fitted. The car as it comes.',
    key: arenaKey, value: (e) => e.score, qualifies: (e) => e.stock,
  },
  {
    id: 'stunt', label: 'BEST STUNT', blurb: 'One landing. Not a run — a moment.',
    key: arenaKey, value: (e) => e.bestStunt, qualifies: (e) => e.bestStunt > 0,
  },
  {
    id: 'raw', label: 'RAW', blurb: 'Every landing without a stabiliser. One burst and you are off it.',
    key: arenaKey, value: (e) => e.score, qualifies: (e) => e.raw,
  },
  {
    id: 'daily', label: 'DAILY RUN', blurb: "Today's seed. The date is the seed, so everybody gets the same one.",
    key: (e) => `${e.day}:${e.arena}:${e.mode}`, value: (e) => e.score, qualifies: (e) => e.daily,
  },
  {
    id: 'friends', label: 'FRIENDS', blurb: 'The arena board, with only the people you care about losing to on it.',
    key: arenaKey, value: (e) => e.score, qualifies: () => true,
    // A lens over the arena board rather than a table of its own: a friend
    // list is a fact about this client, and duplicating rows to express it
    // would mean two sources of truth for the same score.
    lensOf: 'arena',
  },
];

export const getBoard = (id) => BOARDS.find((b) => b.id === id) || BOARDS[0];

/** The boards this run belongs on. */
export function boardsFor(entry) {
  return BOARDS.filter((b) => !b.lensOf && b.qualifies(entry));
}

/**
 * File a finished run everywhere it qualifies.
 * @returns [{ board, rank, of }] — where it landed, for the result screen
 */
export async function submitRun(summary, ctx) {
  const entry = entryFromRun(summary, ctx);
  const out = [];
  for (const b of boardsFor(entry)) {
    const row = { ...entry, value: b.value(entry) };
    const list = await Board.submit(b.id, b.key(entry), row);
    const rank = list.findIndex((e) => e.slot === entry.slot && e.value === row.value);
    out.push({ board: b, entry: row, rank: rank < 0 ? null : rank + 1, of: list.length });
  }
  return out;
}

/**
 * Read one board. `friends` reads the board it is a lens on and filters.
 * @param ctx { arena, mode, day, car, friends }
 */
export async function readBoard(id, ctx, n = 10) {
  const b = getBoard(id);
  const src = b.lensOf ? getBoard(b.lensOf) : b;
  const key = src.key({ arena: ctx.arena, mode: ctx.mode, day: ctx.day, car: ctx.car });
  // Over-read for a lens: filtering ten rows down to the two friends in them
  // shows two rows, which reads as an empty board rather than a small one.
  const rows = await Board.top(src.id, key, b.lensOf ? Math.max(n * 5, 50) : n);
  if (!b.lensOf) return rows;
  const friends = new Set(ctx.friends || []);
  return rows.filter((e) => friends.has(e.name) || e.slot === ctx.slot).slice(0, n);
}

/**
 * A run's standing across all seven, for the progress screen. This is the
 * view that makes the argument: you are 41st overall and 1st on RAW.
 */
export async function standings(ctx, n = 10) {
  const out = [];
  for (const b of BOARDS) {
    const rows = await readBoard(b.id, ctx, n);
    const mine = rows.findIndex((e) => e.slot === ctx.slot);
    out.push({ board: b, rows, rank: mine < 0 ? null : mine + 1 });
  }
  return out;
}

/** Medals across the boards — the currency §8 unlocks against. */
export function boardMedals(rows, slot) {
  return rows.filter((e) => e.slot === slot).reduce((a, e) => a + medalRank(e.medal), 0);
}

export { simCurrent };
