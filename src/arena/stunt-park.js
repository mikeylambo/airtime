/**
 * Arena 1 — THE YARD (R3).
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
 * Content slots (§10): 15-25 ramps, 8-12 tagged landing targets.
 */

import { rampMesh, rampSlabs, rampSurface, rampLipHeight, rampExitAngle } from './ramp-geometry.js';
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

/** A ramp at `p` that launches toward the origin. */
const inward = (x, z) => Math.atan2(x, z);
const ring = (r, i, n, phase = 0) => {
  const a = phase + (i / n) * Math.PI * 2;
  return { x: Math.sin(a) * r, z: Math.cos(a) * r };
};

const ramp = (kind, x, z, opts = {}) => ({
  kind, id: opts.id || `${kind}_${Math.round(x)}_${Math.round(z)}`,
  pos: { x, y: opts.y || 0, z },
  yaw: opts.yaw ?? inward(x, z),
  height: opts.height ?? 4,
  length: opts.length ?? 12,
  halfWidth: opts.halfWidth ?? 5,
  radius: opts.radius ?? 8,
  exitAngle: opts.exitAngle,
  lipFrac: opts.lipFrac,
});

const slab = (id, x, y, z, hx, hy, hz, opts = {}) => ({
  id, pos: { x, y, z }, half: { x: hx, y: hy, z: hz }, yaw: opts.yaw || 0,
  kind: opts.kind || 'platform',
});

export function describePark() {
  const ramps = [];
  const structures = [];
  const targets = [];

  // ── The tower: the thing everything points at ───────────────────────────
  YARD.TOWER.forEach((t, i) => {
    structures.push(slab(`tower_${i}`, 0, t.y / 2, 0, t.half, t.y / 2, t.half, { kind: 'roof' }));
  });
  const top = YARD.TOWER[YARD.TOWER.length - 1];
  targets.push({
    id: 'tower', tier: 'rooftop', tagged: true,
    aim: { x: 0, y: top.y, z: 0 }, half: { x: top.half, y: 4, z: top.half },
  });
  // Roll-offs on all four faces, so the tower is a launch point too.
  for (let i = 0; i < 4; i++) {
    const p = ring(YARD.TOWER[0].half + 13, i, 4);
    ramps.push(ramp('wedge', p.x, p.z, {
      id: `tower_off_${i}`, height: 6.6, length: 26, halfWidth: 9,
      yaw: inward(p.x, p.z) + Math.PI,     // faces *out*: leave the tower
    }));
  }

  // ── Mid decks: catchers for the short hops ──────────────────────────────
  for (let i = 0; i < 4; i++) {
    const p = ring(YARD.MID, i, 4, Math.PI / 4);
    structures.push(slab(`mid_${i}`, p.x, 5, p.z, 15, 5, 15, { kind: 'roof' }));
    targets.push({
      id: `mid_${i}`, tier: 'rooftop', tagged: i < 2,
      aim: { x: p.x, y: 10, z: p.z }, half: { x: 15, y: 3.5, z: 15 },
    });
    // A kicker off the outer edge of each, aimed back at the tower.
    const q = ring(YARD.MID + 21, i, 4, Math.PI / 4);
    ramps.push(ramp('kicker', q.x, q.z, {
      id: `mid_up_${i}`, length: 15, halfWidth: 6, exitAngle: 0.50, lipFrac: 0.38,
    }));
  }

  // ── Inner ring: eight kickers, all facing the tower ─────────────────────
  for (let i = 0; i < 8; i++) {
    const p = ring(YARD.INNER, i, 8);
    const hero = i === 0;                  // the ramp the spawn straight feeds
    ramps.push(ramp('kicker', p.x, p.z, {
      id: hero ? 'hero' : `in_${i}`,
      length: hero ? 24 : 19,
      halfWidth: hero ? 8 : 6.5,
      exitAngle: hero ? 0.50 : 0.47,
      lipFrac: 0.40,
    }));
  }

  // ── Quarter pipes on the diagonals: ride up, come back ──────────────────
  for (let i = 0; i < 4; i++) {
    const p = ring(YARD.PIPES, i, 4, Math.PI / 4);
    ramps.push(ramp('quarterpipe', p.x, p.z, {
      id: `pipe_${i}`, radius: 11, halfWidth: 16,
      // A quarter pipe is ridden, not launched off: it rises outward so you
      // approach from inside, run up the wall and drop back in.
      yaw: inward(p.x, p.z) + Math.PI,
    }));
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
    // thing every run does is ride the perimeter instead of driving.
    const split = i === 0;
    // The corridor has to be wider than "technically a gap". At +/-38 with a
    // 16 m half-width the two faces reached in to x = +/-22, and a car leaving
    // spawn with any steering on it clipped the inner end of one and simply
    // stopped there — upright, on full throttle, run over. Six of the eight
    // cars did it. A vertical ramp end-face on the spawn line is a trap, not a
    // feature, so the corridor is now 76 m wide and nothing on the way out of
    // spawn is within reach of it.
    const halves = split ? [-52, 52] : [0];
    halves.forEach((off, k) => {
      const c = Math.cos(inward(p.x, p.z)), sn = Math.sin(inward(p.x, p.z));
      ramps.push(ramp('wedge', p.x + c * off, p.z - sn * off, {
        id: split ? `bank_0${k ? 'b' : 'a'}` : `bank_${i}`,
        height: 16, length: 34, halfWidth: split ? 14 : 30,
        // Inward, not outward. With the extra PI these fired *away* from the
        // park and every one of them was a deck-only ramp.
        yaw: inward(p.x, p.z),
      }));
    });
  }

  // ── Shelves at r=64: where the tower roll-offs land, so leaving the tower
  //    puts you somewhere rather than nowhere.
  //
  // Catchers only. They started with kickers of their own at r=92, which is
  // exactly the inner ring — two ramps in the same square metre, and the car
  // simply climbed the pile and rolled back down.
  for (let i = 0; i < 4; i++) {
    const p = ring(64, i, 4);
    structures.push(slab(`shelf_${i}`, p.x, 4, p.z, 11, 4, 11, { kind: 'roof' }));
    targets.push({
      id: `shelf_${i}`, tier: 'rooftop', tagged: i < 2,
      aim: { x: p.x, y: 8, z: p.z }, half: { x: 11, y: 3, z: 11 },
    });
  }

  // ── Billboards: narrow, high, between tower and inner ring ──────────────
  for (let i = 0; i < 2; i++) {
    const p = ring(70, i, 2, Math.PI / 4);
    structures.push(slab(`bb_leg_${i}`, p.x, 8, p.z, 1.2, 8, 1.2, { kind: 'leg' }));
    structures.push(slab(`bb_${i}`, p.x, 16.4, p.z, 9, 0.4, 3.4, { kind: 'billboard' }));
    targets.push({
      id: `bb_${i}`, tier: 'billboard', tagged: true,
      aim: { x: p.x, y: 16.8, z: p.z }, half: { x: 9, y: 2.5, z: 3.4 },
    });
  }

  // ── The pool, on the far mid deck ───────────────────────────────────────
  const pool = ring(YARD.MID, 2, 4, Math.PI / 4);
  structures.push(slab('pool_floor', pool.x, 10.3, pool.z, 10, 0.4, 10, { kind: 'pool' }));
  for (const [dx, dz, hx, hz] of [[0, -10.6, 10, 0.6], [0, 10.6, 10, 0.6], [-10.6, 0, 0.6, 10], [10.6, 0, 0.6, 10]]) {
    structures.push(slab(`pool_w_${dx}_${dz}`, pool.x + dx, 12, pool.z + dz, hx, 2, hz, { kind: 'poolwall' }));
  }
  targets.push({
    id: 'pool', tier: 'pool', tagged: true,
    aim: { x: pool.x, y: 11, z: pool.z }, half: { x: 10, y: 3.5, z: 10 },
  });

  // ── The mast: high, small, worth five times anything else ───────────────
  const mast = ring(34, 1, 4, Math.PI / 4);
  structures.push(slab('mast_leg', mast.x, 15, mast.z, 1.3, 15, 1.3, { kind: 'leg' }));
  structures.push(slab('mast', mast.x, 30.3, mast.z, 4, 0.35, 4, { kind: 'secret' }));
  targets.push({
    id: 'mast', tier: 'secret', tagged: true,
    aim: { x: mast.x, y: 30.7, z: mast.z }, half: { x: 4, y: 2.5, z: 4 },
  });

  // ── The garage ramp, parked well clear (§2.1 live preview) ──────────────
  ramps.push(ramp('kicker', -270, 0, {
    id: 'garage', length: 16, halfWidth: 6, exitAngle: 0.52, lipFrac: 0.40, yaw: 0,
  }));

  return {
    id: 'park',
    ground: TUNING.ARENA.GROUND_SIZE,
    spawn: { x: 0, y: 1.08, z: YARD.SPAWN_Z },
    ramps, structures, targets,
    coins: describeCoins(),
    lanes: describeLanes(),
    movers: [],
  };
}

/**
 * Traffic lanes (§4). A ring road outside the bank, plus the south straight,
 * so near-miss boost is available on the way in without cluttering the yard.
 */
export function describeLanes() {
  const R = YARD.BANK + 46;
  return [
    { id: 'south_in', from: { x: -13, z: 260 }, to: { x: -13, z: -260 }, oncoming: false },
    { id: 'south_out', from: { x: 13, z: -260 }, to: { x: 13, z: 260 }, oncoming: true },
    { id: 'ring_n', from: { x: -R, z: -R }, to: { x: R, z: -R }, oncoming: false },
    { id: 'ring_e', from: { x: R, z: -R }, to: { x: R, z: R }, oncoming: false },
    { id: 'ring_s', from: { x: R, z: R }, to: { x: -R, z: R }, oncoming: true },
    { id: 'ring_w', from: { x: -R, z: R }, to: { x: -R, z: -R }, oncoming: true },
  ];
}

function arc(from, to, apexY, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t + Math.sin(Math.PI * t) * apexY,
      z: from.z + (to.z - from.z) * t,
    });
  }
  return out;
}

/** Coin lines along the arcs the inner ring actually produces (§3.1). */
export function describeCoins() {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = ring(YARD.INNER - 12, i, 8);
    const b = ring(14, i, 8);
    pts.push(...arc({ x: a.x, y: 9, z: a.z }, { x: b.x, y: 20, z: b.z }, 9, 7));
  }
  return pts.map((p, i) => ({ id: `coin_${i}`, pos: p }));
}

export { rampMesh, rampSlabs, rampSurface, rampLipHeight, rampExitAngle };
