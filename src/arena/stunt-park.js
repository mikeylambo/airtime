/**
 * Arena 1 — THE YARD (R3), as a piece list.
 *
 * Build 1's park was a scatter: twenty ramps, one hero line, and fourteen of
 * them that could only ever put you back on the deck. tools/lines.mjs measured
 * it at 1/15. A stunt park has to be a *network* — an instrument you learn to
 * play, where a jump off any object lands you on or beside another one.
 *
 * So this is laid out by range rather than by eye. A car leaves a 28-degree
 * kicker at 40-50 m/s and travels 60-90 m, so everything sits on rings spaced
 * inside that envelope:
 *
 *   centre        a stepped tower — land on it from anywhere, leave in any direction
 *   r=52          mid decks, for short hops
 *   r=92          the inner kickers, all facing in
 *   r=138         quarter pipes on the diagonals, facing in
 *   r=168         the perimeter bank, which always returns you to the middle
 *
 * Everything points inward, so the park's default gravity is *toward the
 * middle*, and the player's job is to keep finding ways back out.
 *
 * Since the editor pivot (airtime-park-editor-v2.md) the description is a
 * **piece list** expanded by src/arena/pieces.js — the same format the v2
 * editor will edit. The expansion was verified byte-identical to the old
 * hand-rolled record, because array order feeds the solver (§R).
 *
 * Content slots (§10): 15-25 ramps, 8-12 tagged landing targets.
 */

import { rampMesh, rampSlabs, rampSurface, rampLipHeight, rampExitAngle } from './ramp-geometry.js';
import { expandPieces } from './pieces.js';
import TUNING from '../TUNING.js';

// §3.1 target tier multipliers, carried on the target records.
export const TIER = {
  road:      { mult: 1.0, label: 'ROAD' },
  rooftop:   { mult: 1.5, label: 'ROOFTOP' },
  billboard: { mult: 2.0, label: 'BILLBOARD' },
  moving:    { mult: 3.0, label: 'MOVING' },
  pool:      { mult: 3.0, label: 'POOL' },
  secret:    { mult: 5.0, label: 'SECRET' },
};

/** The rings the whole park is built on. */
export const YARD = {
  MID: 52,
  INNER: 92,
  PIPES: 138,
  BANK: 168,
  TOWER: [
    { half: 26, y: 6 },
    { half: 18, y: 12 },
    { half: 11, y: 18 },
  ],
  SPAWN_Z: 214,          // a long run-up into the south kicker
};

const inward = (x, z) => Math.atan2(x, z);
const ring = (r, i, n, phase = 0) => {
  const a = phase + (i / n) * Math.PI * 2;
  return { x: Math.sin(a) * r, z: Math.cos(a) * r };
};
const at = (piece, id, pos, yaw, params = {}) => ({ piece, id, pos, yaw, params });

/**
 * The Yard as pieces. Everything an editor cursor would have set is explicit
 * — positions, yaws, ids — and the layout maths above is just how this
 * particular park chose its numbers.
 */
export function describeParkPieces() {
  const pieces = [];

  // ── The tower: the thing everything points at ───────────────────────────
  YARD.TOWER.forEach((t, i) => {
    pieces.push(at('slab', `tower_${i}`, { x: 0, y: t.y / 2, z: 0 }, 0,
      { half: { x: t.half, y: t.y / 2, z: t.half }, kind: 'roof' }));
  });
  const top = YARD.TOWER[YARD.TOWER.length - 1];
  pieces.push(at('target', 'tower', { x: 0, y: top.y, z: 0 }, 0,
    { tier: 'rooftop', tagged: true, half: { x: top.half, y: 4, z: top.half } }));
  // Roll-offs on all four faces, so the tower is a launch point too.
  for (let i = 0; i < 4; i++) {
    const p = ring(YARD.TOWER[0].half + 13, i, 4);
    pieces.push(at('wedge', `tower_off_${i}`, { x: p.x, z: p.z },
      inward(p.x, p.z) + Math.PI,      // faces *out*: leave the tower
      { height: 6.6, length: 26, halfWidth: 9 }));
  }

  // ── Mid decks: catchers for the short hops ──────────────────────────────
  for (let i = 0; i < 4; i++) {
    const p = ring(YARD.MID, i, 4, Math.PI / 4);
    pieces.push(at('slab', `mid_${i}`, { x: p.x, y: 5, z: p.z }, 0,
      { half: { x: 15, y: 5, z: 15 }, kind: 'roof' }));
    pieces.push(at('target', `mid_${i}`, { x: p.x, y: 10, z: p.z }, 0,
      { tier: 'rooftop', tagged: i < 2, half: { x: 15, y: 3.5, z: 15 } }));
    // A kicker off the outer edge of each, aimed back at the tower.
    const q = ring(YARD.MID + 21, i, 4, Math.PI / 4);
    pieces.push(at('kicker', `mid_up_${i}`, { x: q.x, z: q.z }, inward(q.x, q.z),
      { length: 15, halfWidth: 6, exitAngle: 0.50, lipFrac: 0.38 }));
  }

  // ── Inner ring: eight kickers, all facing the tower ─────────────────────
  for (let i = 0; i < 8; i++) {
    const p = ring(YARD.INNER, i, 8);
    const hero = i === 0;                  // the ramp the spawn straight feeds
    pieces.push(at('kicker', hero ? 'hero' : `in_${i}`, { x: p.x, z: p.z }, inward(p.x, p.z), {
      length: hero ? 24 : 19,
      halfWidth: hero ? 8 : 6.5,
      exitAngle: hero ? 0.50 : 0.47,
      lipFrac: 0.40,
    }));
  }

  // ── Quarter pipes on the diagonals: ride up, come back ──────────────────
  for (let i = 0; i < 4; i++) {
    const p = ring(YARD.PIPES, i, 4, Math.PI / 4);
    // A quarter pipe is ridden, not launched off: it rises outward so you
    // approach from inside, run up the wall and drop back in.
    pieces.push(at('quarterpipe', `pipe_${i}`, { x: p.x, z: p.z },
      inward(p.x, p.z) + Math.PI, { radius: 11, halfWidth: 16 }));
  }

  // ── The perimeter bank: wide, and steep enough to *throw* you back in ────
  // Pitched at 25 degrees rather than 9, because the shallow version landed
  // you on bare deck 30 m short of the quarter pipes — a feature whose whole
  // job is returning you to the middle has to actually reach it (r=168 -> ~97,
  // which is the inner ring).
  for (let i = 0; i < 4; i++) {
    const p = ring(YARD.BANK, i, 4);
    // The south face is split, leaving a corridor on the axis: the spawn
    // straight has to reach the yard, and a solid ring means the very first
    // thing every run does is ride the perimeter instead of driving. The
    // corridor is 76 m wide because a vertical ramp end-face on the spawn
    // line is a trap, not a feature — six of the eight cars proved it.
    const split = i === 0;
    const halves = split ? [-52, 52] : [0];
    halves.forEach((off, k) => {
      const c = Math.cos(inward(p.x, p.z)), sn = Math.sin(inward(p.x, p.z));
      // Inward, not outward. With an extra PI these fired *away* from the
      // park and every one of them was a deck-only ramp.
      pieces.push(at('wedge', split ? `bank_0${k ? 'b' : 'a'}` : `bank_${i}`,
        { x: p.x + c * off, z: p.z - sn * off }, inward(p.x, p.z),
        { height: 16, length: 34, halfWidth: split ? 14 : 30 }));
    });
  }

  // ── Shelves at r=64: where the tower roll-offs land, so leaving the tower
  //    puts you somewhere rather than nowhere. Catchers only — they started
  //    with kickers of their own at r=92, which is exactly the inner ring.
  for (let i = 0; i < 4; i++) {
    const p = ring(64, i, 4);
    pieces.push(at('slab', `shelf_${i}`, { x: p.x, y: 4, z: p.z }, 0,
      { half: { x: 11, y: 4, z: 11 }, kind: 'roof' }));
    pieces.push(at('target', `shelf_${i}`, { x: p.x, y: 8, z: p.z }, 0,
      { tier: 'rooftop', tagged: i < 2, half: { x: 11, y: 3, z: 11 } }));
  }

  // ── Billboards: narrow, high, between tower and inner ring ──────────────
  for (let i = 0; i < 2; i++) {
    const p = ring(70, i, 2, Math.PI / 4);
    pieces.push(at('billboard', `bb_${i}`, { x: p.x, z: p.z }, 0, {
      legId: `bb_leg_${i}`, legY: 8, legHalf: { x: 1.2, y: 8, z: 1.2 },
      panelY: 16.4, panelHalf: { x: 9, y: 0.4, z: 3.4 },
      aimY: 16.8, targetHalf: { x: 9, y: 2.5, z: 3.4 }, tagged: true,
    }));
  }

  // ── The pool, on the far mid deck ───────────────────────────────────────
  const pool = ring(YARD.MID, 2, 4, Math.PI / 4);
  pieces.push(at('pool', 'pool', { x: pool.x, z: pool.z }, 0, {
    half: 10, floorY: 10.3, wallY: 12,
    aimY: 11, targetHalf: { x: 10, y: 3.5, z: 10 },
  }));

  // ── The mast: high, small, worth five times anything else ───────────────
  const mast = ring(34, 1, 4, Math.PI / 4);
  pieces.push(at('mast', 'mast', { x: mast.x, z: mast.z }, 0, {
    legId: 'mast_leg', legY: 15, legHalf: { x: 1.3, y: 15, z: 1.3 },
    topId: 'mast', topY: 30.3, topHalf: { x: 4, z: 4 },
    aimY: 30.7, targetHalf: { x: 4, y: 2.5, z: 4 },
  }));

  // ── The garage ramp, parked well clear (§2.1 live preview) ──────────────
  pieces.push(at('kicker', 'garage', { x: -270, z: 0 }, 0,
    { length: 16, halfWidth: 6, exitAngle: 0.52, lipFrac: 0.40 }));

  // ── Coin lines along the arcs the inner ring actually produces (§3.1) ───
  for (let i = 0; i < 8; i++) {
    const a = ring(YARD.INNER - 12, i, 8);
    const b = ring(14, i, 8);
    pieces.push(at('coinArc', `coins_${i}`, { x: a.x, z: a.z }, 0, {
      from: { x: a.x, y: 9, z: a.z }, to: { x: b.x, y: 20, z: b.z }, apexY: 9, n: 7,
    }));
  }

  // ── Traffic lanes (§4): a ring road outside the bank, plus the south
  //    straight, so near-miss boost is available on the way in without
  //    cluttering the yard.
  const R = YARD.BANK + 46;
  for (const [id, from, to, oncoming] of [
    ['south_in', { x: -13, z: 260 }, { x: -13, z: -260 }, false],
    ['south_out', { x: 13, z: -260 }, { x: 13, z: 260 }, true],
    ['ring_n', { x: -R, z: -R }, { x: R, z: -R }, false],
    ['ring_e', { x: R, z: -R }, { x: R, z: R }, false],
    ['ring_s', { x: R, z: R }, { x: -R, z: R }, true],
    ['ring_w', { x: -R, z: R }, { x: -R, z: -R }, true],
  ]) {
    pieces.push(at('lane', id, { x: from.x, z: from.z }, 0, { from, to, oncoming }));
  }

  return {
    id: 'park',
    lot: {
      ground: TUNING.ARENA.GROUND_SIZE,
      spawn: { x: 0, y: 1.08, z: YARD.SPAWN_Z },
      coinPrefix: 'coin_',
    },
    pieces,
  };
}

export function describePark() {
  return expandPieces(describeParkPieces());
}

export { rampMesh, rampSlabs, rampSurface, rampLipHeight, rampExitAngle };
