/**
 * Arena 2 — the city block (§10b), as a piece list.
 *
 * "Burnout-style, every rooftop/billboard/overpass placed as a ramp or landing
 * target." The block grid is generated from the arena seed — one `blockGrid`
 * piece rather than four hundred hand-placed boxes — but every *verb*: the
 * ramps that get you up, the targets worth landing on, the routes the moving
 * targets run, is an authored piece (src/arena/pieces.js).
 *
 * R8 will rebuild this arena as an instrument; when it does, the grid piece
 * dissolves into individual authored blocks. Until then the piece list keeps
 * it byte-identical to the record the game has always loaded.
 */

import { expandPieces } from './pieces.js';

export const CITY = {
  BLOCKS_X: 4,
  BLOCKS_Z: 5,
  BLOCK: 62,            // block footprint
  STREET: 26,           // street width between blocks
  MIN_H: 9,
  MAX_H: 26,
  SEED: 0xc17a,
};

const gridX = (i) => (i - (CITY.BLOCKS_X - 1) / 2) * (CITY.BLOCK + CITY.STREET);
const gridZ = (j) => (j - (CITY.BLOCKS_Z - 1) / 2) * (CITY.BLOCK + CITY.STREET);
const at = (piece, id, pos, yaw, params = {}) => ({ piece, id, pos, yaw, params });

export function describeCityPieces() {
  const pieces = [];

  // ── The blocks — one generated piece, see blockGrid in pieces.js ────────
  pieces.push(at('blockGrid', 'blocks', { x: 0, z: 0 }, 0, {
    seed: CITY.SEED,
    blocksX: CITY.BLOCKS_X, blocksZ: CITY.BLOCKS_Z,
    block: CITY.BLOCK, street: CITY.STREET,
    minH: CITY.MIN_H, maxH: CITY.MAX_H,
    // Two towers per block: [offsetX, offsetZ, halfW, halfD].
    towers: [[-15, -13, 14, 16], [14, 12, 15, 17]],
  }));

  // ── Overpasses: the fast way across, and a launch off the end ───────────
  const ovpW = gridX(CITY.BLOCKS_X - 1) + 40;
  for (let j = 1; j < CITY.BLOCKS_Z; j++) {
    const cz = gridZ(j) - (CITY.BLOCK + CITY.STREET) / 2;
    pieces.push(at('slab', `ovp_${j}`, { x: 0, y: 8, z: cz }, 0,
      { half: { x: ovpW, y: 0.8, z: 7 }, kind: 'roof' }));
    pieces.push(at('wedge', `ovp_on_${j}`, { x: -gridX(CITY.BLOCKS_X - 1) - 58, z: cz },
      -Math.PI / 2, { height: 8.8, length: 30, halfWidth: 7 }));
    pieces.push(at('target', `ovp_${j}`, { x: 0, y: 8.8, z: cz }, 0,
      { tier: 'road', tagged: j === 2, half: { x: ovpW, y: 3, z: 7 } }));
  }

  // ── Billboards: narrow, high, terrifying (§3.1 billboard tier) ──────────
  const bbSpots = [[-1, 0], [2, 1], [0, 3], [3, 4]];
  bbSpots.forEach(([i, j], n) => {
    pieces.push(at('billboard', `bb_${n}`, { x: gridX(i) + 30, z: gridZ(j) + 30 }, 0, {
      legId: `bbleg_${n}`, legY: 9, legHalf: { x: 1.1, y: 9, z: 1.1 },
      panelY: 18.6, panelHalf: { x: 10, y: 0.4, z: 3.6 },
      aimY: 19, targetHalf: { x: 10, y: 2.5, z: 3.6 }, tagged: true,
    }));
  });

  // ── A rooftop pool, because §3.1 prices one at x3 ───────────────────────
  const px = gridX(1), pz = gridZ(2);
  pieces.push(at('slab', 'poolbase', { x: px, y: 7, z: pz }, 0,
    { half: { x: 22, y: 7, z: 22 }, kind: 'roof' }));
  pieces.push(at('pool', 'pool', { x: px, z: pz }, 0, {
    half: 12, floorY: 14.4, wallY: 16.4, wallPrefix: 'poolw_',
    aimY: 15, targetHalf: { x: 12, y: 4, z: 12 },
  }));

  // ── The secret: a mast nobody lands on twice (§3.1 x5) ──────────────────
  pieces.push(at('mast', 'secret', { x: gridX(CITY.BLOCKS_X - 1) + 34, z: gridZ(0) - 34 }, 0, {
    legId: 'secret_leg', legY: 20, legHalf: { x: 1.4, y: 20, z: 1.4 },
    topId: 'secret', topY: 40.3, topHalf: { x: 4.4, z: 4.4 },
    aimY: 40.7, targetHalf: { x: 4.4, y: 2.5, z: 4.4 },
  }));

  // ── Coin lines down the west column, plus the run up to the pool ────────
  for (let j = 1; j < CITY.BLOCKS_Z; j++) {
    const cz = gridZ(j);
    pieces.push(at('coinArc', `coins_${j}`, { x: gridX(0), z: cz + 30 }, 0, {
      from: { x: gridX(0), y: 12, z: cz + 30 }, to: { x: gridX(0), y: 14, z: cz - 26 },
      apexY: 8, n: 8,
    }));
  }
  pieces.push(at('coinArc', 'coins_pool', { x: gridX(1), z: gridZ(3) + 30 }, 0, {
    from: { x: gridX(1), y: 10, z: gridZ(3) + 30 }, to: { x: gridX(1), y: 16, z: gridZ(2) },
    apexY: 12, n: 12,
  }));

  // ── Streets run between the blocks; traffic uses them (§4) ──────────────
  const span = gridZ(CITY.BLOCKS_Z - 1) + 130;
  for (let i = 0; i < CITY.BLOCKS_X; i++) {
    const x = gridX(i) + (CITY.BLOCK + CITY.STREET) / 2;
    pieces.push(at('lane', `st_${i}_a`, { x: x - 5, z: span }, 0,
      { from: { x: x - 5, z: span }, to: { x: x - 5, z: -span }, oncoming: false }));
    pieces.push(at('lane', `st_${i}_b`, { x: x + 5, z: -span }, 0,
      { from: { x: x + 5, z: -span }, to: { x: x + 5, z: span }, oncoming: true }));
  }
  for (let j = 0; j < CITY.BLOCKS_Z; j++) {
    const z = gridZ(j) + (CITY.BLOCK + CITY.STREET) / 2;
    const w = gridX(CITY.BLOCKS_X - 1) + 120;
    pieces.push(at('lane', `av_${j}_a`, { x: -w, z: z - 5 }, 0,
      { from: { x: -w, z: z - 5 }, to: { x: w, z: z - 5 }, oncoming: false }));
    pieces.push(at('lane', `av_${j}_b`, { x: w, z: z + 5 }, 0,
      { from: { x: w, z: z + 5 }, to: { x: -w, z: z + 5 }, oncoming: true }));
  }

  // ── §6.2 moving targets — all three at v1, each on an authored route ────
  const mspan = gridZ(CITY.BLOCKS_Z - 1) + 120;
  pieces.push(at('mover', 'train', { x: gridX(2) + 13, z: 0 }, 0, {
    kind: 'train', tier: 'moving',
    half: { x: 2.4, y: 1.9, z: 9.5 }, cars: 5, gap: 21,
    y: 11.4, speed: 17,
    from: { x: gridX(2) + 13, z: mspan }, to: { x: gridX(2) + 13, z: -mspan },
    loop: 'wrap',
  }));
  pieces.push(at('mover', 'heli', { x: gridX(0), z: gridZ(1) }, 0, {
    kind: 'heli', tier: 'secret',
    half: { x: 3.2, y: 0.4, z: 3.2 },
    // §6.2: hovers, then relocates every 30s.
    hold: 30, y: 34,
    stations: [
      { x: gridX(0), z: gridZ(1) }, { x: gridX(3), z: gridZ(3) },
      { x: gridX(1), z: gridZ(4) }, { x: gridX(2), z: gridZ(0) },
    ],
  }));
  pieces.push(at('mover', 'billboard', { x: gridX(3) + 26, z: gridZ(2) }, 0, {
    kind: 'billboard', tier: 'billboard',
    half: { x: 9, y: 0.4, z: 3.4 }, y: 21,
    // Rotating panel: only lands as billboard tier while face-up (§6.2).
    spin: 0.42,
    at: { x: gridX(3) + 26, z: gridZ(2) },
  }));

  return {
    id: 'city',
    lot: {
      ground: 900,
      // Line the spawn up with a block column: the up-ramps sit at the front
      // of every block, so driving straight down a column is a chain of
      // launches. Spawning in the street between columns means never meeting
      // a ramp at all.
      spawn: { x: gridX(2), y: 1.08, z: gridZ(CITY.BLOCKS_Z - 1) + 92 },
      coinPrefix: 'ccoin_',
    },
    pieces,
  };
}

export function describeCity() {
  const arena = expandPieces(describeCityPieces());
  // Tag a handful of roofs as landmarks: the tallest in the grid, so the
  // target-lock camera always has something worth framing. A post-pass, not
  // a piece — it reads the generated skyline, which no cursor placed.
  const roofs = arena.targets.filter((t) => t.tier === 'rooftop');
  roofs.sort((a, b) => b.aim.y - a.aim.y);
  for (const t of roofs.slice(0, 5)) t.tagged = true;
  return arena;
}
