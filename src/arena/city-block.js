/**
 * Arena 2 — the city block (§10b).
 *
 * "Burnout-style, every rooftop/billboard/overpass placed as a ramp or landing
 * target." The block grid is generated from the arena seed so it is one
 * description rather than four hundred hand-placed boxes, but every *verb* —
 * the ramps that get you up, the targets worth landing on, the routes the
 * moving targets run — is authored.
 */

import { makeRng } from '../sim/mathx.js';

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

const ramp = (kind, x, z, opts = {}) => ({
  kind, id: opts.id || `${kind}_${Math.round(x)}_${Math.round(z)}`,
  pos: { x, y: opts.y || 0, z },
  yaw: opts.yaw || 0,
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

export function describeCity() {
  const rng = makeRng(0xc17a);
  const ramps = [];
  const structures = [];
  const targets = [];

  // ── The blocks ──────────────────────────────────────────────────────────
  for (let i = 0; i < CITY.BLOCKS_X; i++) {
    for (let j = 0; j < CITY.BLOCKS_Z; j++) {
      const cx = gridX(i), cz = gridZ(j);
      // Two towers per block, so roofs sit at different heights and a jump
      // between them is a real decision.
      for (const [ox, oz, w, d] of [[-15, -13, 14, 16], [14, 12, 15, 17]]) {
        const h = CITY.MIN_H + rng() * (CITY.MAX_H - CITY.MIN_H);
        const id = `blk_${i}_${j}_${ox > 0 ? 'b' : 'a'}`;
        structures.push(slab(id, cx + ox, h / 2, cz + oz, w, h / 2, d, { kind: 'roof' }));
        // Ordinary roofs score as rooftop tier but are not *tagged*: §10 wants
        // 8-12 authored targets per arena, and the camera should lock onto the
        // handful that are worth a shot, not onto every building in the city.
        targets.push({
          id, tier: 'rooftop', tagged: false,
          aim: { x: cx + ox, y: h, z: cz + oz },
          half: { x: w, y: 3, z: d },
        });
      }
      // A low podium: the easy roof, and the ramp up onto the block.
      structures.push(slab(`pod_${i}_${j}`, cx, 2.6, cz + 26, 20, 2.6, 7, { kind: 'roof' }));
      ramps.push(ramp('kicker', cx, cz + 42, {
        id: `up_${i}_${j}`, length: 15, halfWidth: 7, exitAngle: 0.55, lipFrac: 0.36,
      }));
    }
  }

  // ── Overpasses: the fast way across, and a launch off the end ───────────
  for (let j = 0; j < CITY.BLOCKS_Z; j++) {
    const cz = gridZ(j) - (CITY.BLOCK + CITY.STREET) / 2;
    if (j === 0) continue;
    structures.push(slab(`ovp_${j}`, 0, 8, cz, gridX(CITY.BLOCKS_X - 1) + 40, 0.8, 7, { kind: 'roof' }));
    ramps.push(ramp('wedge', -gridX(CITY.BLOCKS_X - 1) - 58, cz, {
      id: `ovp_on_${j}`, height: 8.8, length: 30, halfWidth: 7, yaw: -Math.PI / 2,
    }));
    targets.push({
      id: `ovp_${j}`, tier: 'road', tagged: j === 2,
      aim: { x: 0, y: 8.8, z: cz }, half: { x: gridX(CITY.BLOCKS_X - 1) + 40, y: 3, z: 7 },
    });
  }

  // ── Billboards: narrow, high, terrifying (§3.1 billboard tier) ──────────
  const bbSpots = [[-1, 0], [2, 1], [0, 3], [3, 4]];
  bbSpots.forEach(([i, j], n) => {
    const x = gridX(i) + 30, z = gridZ(j) + 30;
    structures.push(slab(`bbleg_${n}`, x, 9, z, 1.1, 9, 1.1, { kind: 'leg' }));
    structures.push(slab(`bb_${n}`, x, 18.6, z, 10, 0.4, 3.6, { kind: 'billboard' }));
    targets.push({ id: `bb_${n}`, tier: 'billboard', tagged: true, aim: { x, y: 19, z }, half: { x: 10, y: 2.5, z: 3.6 } });
  });

  // ── A rooftop pool, because §3.1 prices one at x3 ───────────────────────
  const px = gridX(1), pz = gridZ(2);
  structures.push(slab('poolbase', px, 7, pz, 22, 7, 22, { kind: 'roof' }));
  structures.push(slab('pool_floor', px, 14.4, pz, 12, 0.4, 12, { kind: 'pool' }));
  for (const [dx, dz, hx, hz] of [[0, -12.6, 12, 0.6], [0, 12.6, 12, 0.6], [-12.6, 0, 0.6, 12], [12.6, 0, 0.6, 12]]) {
    structures.push(slab(`poolw_${dx}_${dz}`, px + dx, 16.4, pz + dz, hx, 2, hz, { kind: 'poolwall' }));
  }
  targets.push({ id: 'pool', tier: 'pool', tagged: true, aim: { x: px, y: 15, z: pz }, half: { x: 12, y: 4, z: 12 } });

  // ── The secret: a mast nobody lands on twice (§3.1 x5) ──────────────────
  const sx = gridX(CITY.BLOCKS_X - 1) + 34, sz = gridZ(0) - 34;
  structures.push(slab('secret_leg', sx, 20, sz, 1.4, 20, 1.4, { kind: 'leg' }));
  structures.push(slab('secret', sx, 40.3, sz, 4.4, 0.35, 4.4, { kind: 'secret' }));
  targets.push({ id: 'secret', tier: 'secret', tagged: true, aim: { x: sx, y: 40.7, z: sz }, half: { x: 4.4, y: 2.5, z: 4.4 } });

  // Tag a handful of roofs as landmarks: the tallest in each corner of the
  // grid, so the target-lock camera always has something worth framing.
  const roofs = targets.filter((t) => t.tier === 'rooftop');
  roofs.sort((a, b) => b.aim.y - a.aim.y);
  for (const t of roofs.slice(0, 5)) t.tagged = true;

  return {
    id: 'city',
    ground: 900,
      // Line the spawn up with a block column: the up-ramps sit at the front of
    // every block, so driving straight down a column is a chain of launches.
    // Spawning in the street between columns means never meeting a ramp at all.
  spawn: { x: gridX(2), y: 1.08, z: gridZ(CITY.BLOCKS_Z - 1) + 92 },
    ramps, structures, targets,
    coins: describeCityCoins(),
    lanes: describeCityLanes(),
    movers: describeMovers(),
  };
}

/** Streets run between the blocks; traffic uses them (§4). */
function describeCityLanes() {
  const lanes = [];
  const span = gridZ(CITY.BLOCKS_Z - 1) + 130;
  for (let i = 0; i < CITY.BLOCKS_X; i++) {
    const x = gridX(i) + (CITY.BLOCK + CITY.STREET) / 2;
    lanes.push({ id: `st_${i}_a`, from: { x: x - 5, z: span }, to: { x: x - 5, z: -span }, oncoming: false });
    lanes.push({ id: `st_${i}_b`, from: { x: x + 5, z: -span }, to: { x: x + 5, z: span }, oncoming: true });
  }
  for (let j = 0; j < CITY.BLOCKS_Z; j++) {
    const z = gridZ(j) + (CITY.BLOCK + CITY.STREET) / 2;
    const w = gridX(CITY.BLOCKS_X - 1) + 120;
    lanes.push({ id: `av_${j}_a`, from: { x: -w, z: z - 5 }, to: { x: w, z: z - 5 }, oncoming: false });
    lanes.push({ id: `av_${j}_b`, from: { x: w, z: z + 5 }, to: { x: -w, z: z + 5 }, oncoming: true });
  }
  return lanes;
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

function describeCityCoins() {
  const pts = [];
  for (let j = 1; j < CITY.BLOCKS_Z; j++) {
    const cz = gridZ(j);
    pts.push(...arc({ x: gridX(0), y: 12, z: cz + 30 }, { x: gridX(0), y: 14, z: cz - 26 }, 8, 8));
  }
  pts.push(...arc({ x: gridX(1), y: 10, z: gridZ(3) + 30 }, { x: gridX(1), y: 16, z: gridZ(2) }, 12, 12));
  return pts.map((p, i) => ({ id: `ccoin_${i}`, pos: p }));
}

/**
 * §6.2 moving targets — all three at v1. Each has an authored route and a
 * predictable cycle, so a player can time it rather than guess.
 */
function describeMovers() {
  const span = gridZ(CITY.BLOCKS_Z - 1) + 120;
  return [
    {
      id: 'train', kind: 'train', tier: 'moving',
      half: { x: 2.4, y: 1.9, z: 9.5 }, cars: 5, gap: 21,
      y: 11.4, speed: 17,
      from: { x: gridX(2) + 13, z: span }, to: { x: gridX(2) + 13, z: -span },
      loop: 'wrap',
    },
    {
      id: 'heli', kind: 'heli', tier: 'secret',
      half: { x: 3.2, y: 0.4, z: 3.2 },
      // §6.2: hovers, then relocates every 30s.
      hold: 30, y: 34,
      stations: [
        { x: gridX(0), z: gridZ(1) }, { x: gridX(3), z: gridZ(3) },
        { x: gridX(1), z: gridZ(4) }, { x: gridX(2), z: gridZ(0) },
      ],
    },
    {
      id: 'billboard', kind: 'billboard', tier: 'billboard',
      half: { x: 9, y: 0.4, z: 3.4 }, y: 21,
      // Rotating panel: only lands as billboard tier while face-up (§6.2).
      spin: 0.42,
      at: { x: gridX(3) + 26, z: gridZ(2) },
    },
  ];
}
