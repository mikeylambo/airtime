/**
 * The piece system (airtime-park-editor-v2.md, the do-now refactor).
 *
 * An arena is a **piece list** — `{ piece, id, pos, yaw, params }` — over a
 * lot, and `expandPieces()` turns the list into the flat record that physics,
 * render, the camera and every probe already read. Both shipped arenas build
 * through this expansion, so the v2 editor will edit the exact format the
 * game already loads rather than a parallel one.
 *
 * Two rules keep the expansion honest:
 *
 * - **Order is meaning.** Pieces expand in list order and append; the flat
 *   arrays feed Rapier in insertion order and insertion order feeds the
 *   solver, so reordering a piece list is a physics change (§R). The
 *   refactor was verified to reproduce both arenas byte for byte.
 * - **Everything explicit.** No piece infers its yaw or derives an id — the
 *   authored lists carry what an editor cursor would have set.
 */

import { simVersion, SCHEMA_VERSION } from '../sim/version.js';
import { makeRng } from '../sim/mathx.js';

const P = (v, d) => (v === undefined ? d : v);

/** One ramp record, exactly as ramp-geometry.js reads it. */
function rampRec(kind, inst, d = {}) {
  const p = inst.params || {};
  return {
    kind,
    id: inst.id,
    pos: { x: inst.pos.x, y: P(inst.pos.y, 0), z: inst.pos.z },
    yaw: P(inst.yaw, 0),
    height: P(p.height, 4),
    length: P(p.length, 12),
    halfWidth: P(p.halfWidth, 5),
    radius: P(p.radius, 8),
    exitAngle: p.exitAngle,
    lipFrac: p.lipFrac,
  };
}

function slabRec(id, x, y, z, hx, hy, hz, kind = 'platform', yaw = 0) {
  return { id, pos: { x, y, z }, half: { x: hx, y: hy, z: hz }, yaw, kind };
}

/**
 * The palette. Each piece expands into fragments of the flat arena record.
 * `out` is { ramps, structures, targets, coins, lanes, movers }.
 */
export const PIECES = {
  // ── Launch surfaces ──────────────────────────────────────────────────────
  kicker: { expand: (inst, out) => out.ramps.push(rampRec('kicker', inst)) },
  wedge: { expand: (inst, out) => out.ramps.push(rampRec('wedge', inst)) },
  quarterpipe: { expand: (inst, out) => out.ramps.push(rampRec('quarterpipe', inst)) },

  // ── A box in the world: platform, roof, leg, anything solid ─────────────
  slab: {
    expand: (inst, out) => {
      const p = inst.params;
      out.structures.push(slabRec(inst.id, inst.pos.x, inst.pos.y, inst.pos.z,
        p.half.x, p.half.y, p.half.z, P(p.kind, 'platform'), P(inst.yaw, 0)));
    },
  },

  // ── A landing zone the scorer and the camera know about ─────────────────
  target: {
    expand: (inst, out) => {
      const p = inst.params;
      out.targets.push({
        id: inst.id, tier: p.tier, tagged: p.tagged,
        aim: { x: inst.pos.x, y: inst.pos.y, z: inst.pos.z },
        half: { x: p.half.x, y: p.half.y, z: p.half.z },
      });
    },
  },

  // ── Compound targets, one editor gesture each ────────────────────────────
  billboard: {
    expand: (inst, out) => {
      const p = inst.params;
      const { x, z } = inst.pos;
      out.structures.push(slabRec(p.legId, x, p.legY, z, p.legHalf.x, p.legHalf.y, p.legHalf.z, 'leg'));
      out.structures.push(slabRec(inst.id, x, p.panelY, z, p.panelHalf.x, p.panelHalf.y, p.panelHalf.z, 'billboard'));
      out.targets.push({
        id: inst.id, tier: 'billboard', tagged: P(p.tagged, true),
        aim: { x, y: p.aimY, z },
        half: { x: p.targetHalf.x, y: p.targetHalf.y, z: p.targetHalf.z },
      });
    },
  },

  pool: {
    expand: (inst, out) => {
      const p = inst.params;
      const { x, z } = inst.pos;
      const w = p.half;                       // floor half-extent (square)
      const wp = P(p.wallPrefix, 'pool_w_');
      out.structures.push(slabRec(p.floorId || 'pool_floor', x, p.floorY, z, w, 0.4, w, 'pool'));
      for (const [dx, dz, hx, hz] of [[0, -(w + 0.6), w, 0.6], [0, w + 0.6, w, 0.6],
                                      [-(w + 0.6), 0, 0.6, w], [w + 0.6, 0, 0.6, w]]) {
        out.structures.push(slabRec(`${wp}${dx}_${dz}`, x + dx, p.wallY, z + dz, hx, 2, hz, 'poolwall'));
      }
      out.targets.push({
        id: inst.id, tier: 'pool', tagged: true,
        aim: { x, y: p.aimY, z },
        half: { x: p.targetHalf.x, y: p.targetHalf.y, z: p.targetHalf.z },
      });
    },
  },

  /** High, small, worth five times anything else — the mast/secret perch. */
  mast: {
    expand: (inst, out) => {
      const p = inst.params;
      const { x, z } = inst.pos;
      out.structures.push(slabRec(p.legId, x, p.legY, z, p.legHalf.x, p.legHalf.y, p.legHalf.z, 'leg'));
      out.structures.push(slabRec(p.topId, x, p.topY, z, p.topHalf.x, 0.35, p.topHalf.z, 'secret'));
      out.targets.push({
        id: inst.id, tier: 'secret', tagged: true,
        aim: { x, y: p.aimY, z },
        half: { x: p.targetHalf.x, y: p.targetHalf.y, z: p.targetHalf.z },
      });
    },
  },

  // ── Authored lines and traffic ───────────────────────────────────────────
  /** A coin line along an arc. Coin ids are assigned lot-wide, in list order. */
  coinArc: {
    expand: (inst, out) => {
      const p = inst.params;
      const n = p.n;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        out.coins.push({
          pos: {
            x: p.from.x + (p.to.x - p.from.x) * t,
            y: p.from.y + (p.to.y - p.from.y) * t + Math.sin(Math.PI * t) * p.apexY,
            z: p.from.z + (p.to.z - p.from.z) * t,
          },
        });
      }
    },
  },

  lane: {
    expand: (inst, out) => {
      const p = inst.params;
      out.lanes.push({ id: inst.id, from: p.from, to: p.to, oncoming: p.oncoming });
    },
  },

  /** A moving target — the params are the mover record (§6.2). */
  mover: {
    expand: (inst, out) => out.movers.push({ id: inst.id, ...inst.params }),
  },

  /**
   * The city's generated block grid, deliberately ONE piece: tower heights
   * come from a sequential RNG, so splitting it into per-block pieces would
   * change every roof in the city. When R8 rebuilds the city as an
   * instrument, its blocks become individual pieces; until then the grid is
   * a single generated object with a seed, which is also exactly what a
   * "generated terrain" editor piece looks like.
   */
  blockGrid: {
    expand: (inst, out) => {
      const p = inst.params;
      const rng = makeRng(p.seed);
      const pitch = p.block + p.street;
      const gx = (i) => (i - (p.blocksX - 1) / 2) * pitch;
      const gz = (j) => (j - (p.blocksZ - 1) / 2) * pitch;
      for (let i = 0; i < p.blocksX; i++) {
        for (let j = 0; j < p.blocksZ; j++) {
          const cx = gx(i), cz = gz(j);
          // Two towers per block, so roofs sit at different heights and a
          // jump between them is a real decision.
          for (const [ox, oz, w, d] of p.towers) {
            const h = p.minH + rng() * (p.maxH - p.minH);
            const id = `blk_${i}_${j}_${ox > 0 ? 'b' : 'a'}`;
            out.structures.push(slabRec(id, cx + ox, h / 2, cz + oz, w, h / 2, d, 'roof'));
            // Ordinary roofs score as rooftop tier but are not *tagged*: the
            // camera should lock onto the handful worth a shot, not onto
            // every building in the city.
            out.targets.push({
              id, tier: 'rooftop', tagged: false,
              aim: { x: cx + ox, y: h, z: cz + oz },
              half: { x: w, y: 3, z: d },
            });
          }
          // A low podium: the easy roof, and the ramp up onto the block.
          out.structures.push(slabRec(`pod_${i}_${j}`, cx, 2.6, cz + 26, 20, 2.6, 7, 'roof'));
          out.ramps.push(rampRec('kicker', {
            id: `up_${i}_${j}`, pos: { x: cx, z: cz + 42 }, yaw: 0,
            params: { length: 15, halfWidth: 7, exitAngle: 0.55, lipFrac: 0.36 },
          }));
        }
      }
    },
  },
};

/**
 * Piece list → the flat arena record everything reads.
 * @param desc { id, lot: { ground, spawn, coinPrefix }, pieces: [...] }
 */
export function expandPieces(desc) {
  const out = { ramps: [], structures: [], targets: [], coins: [], lanes: [], movers: [] };
  for (const inst of desc.pieces) {
    const piece = PIECES[inst.piece];
    if (!piece) throw new Error(`unknown piece '${inst.piece}'`);
    piece.expand(inst, out);
  }
  const prefix = desc.lot.coinPrefix || 'coin_';
  out.coins = out.coins.map((c, i) => ({ id: `${prefix}${i}`, pos: c.pos }));
  return {
    id: desc.id,
    ground: desc.lot.ground,
    spawn: desc.lot.spawn,
    ...out,
  };
}

// ── Sharing (the park-code substrate; the editor arrives in v2) ────────────

/** Compact JSON with the §R stamps a shared park must carry. */
export function serializeArena(desc) {
  return JSON.stringify({
    schema: SCHEMA_VERSION, sim: simVersion(),
    id: desc.id, name: desc.name, lot: desc.lot, pieces: desc.pieces,
  });
}

/** @returns the piece-list description, or null if it cannot be trusted. */
export function parseArena(json) {
  try {
    const d = JSON.parse(json);
    if (!d || !Array.isArray(d.pieces) || !d.lot) return null;
    for (const inst of d.pieces) if (!PIECES[inst.piece]) return null;
    return d;
  } catch { return null; }
}
