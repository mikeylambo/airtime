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
    // A ramp you *drive*, not a ramp you leave. A spiral flyover is a road
    // that happens to be inclined, and counting it as a launch surface would
    // report ten shallow flights into the street as ten deck-only ramps.
    transit: P(p.transit, false),
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

  // ── R8: the city's own vocabulary ────────────────────────────────────────
  /**
   * A building: the shaft, and the roof you can land on. One gesture, because
   * a tower whose roof is not a target is scenery, and Vertical City has no
   * scenery — every solid thing in it is somewhere you could end up.
   */
  tower: {
    expand: (inst, out) => {
      const p = inst.params;
      const h = p.height;
      const { x, z } = inst.pos;
      out.structures.push(slabRec(inst.id, x, h / 2, z, p.half.x, h / 2, p.half.z, 'roof'));
      out.targets.push({
        id: inst.id, tier: P(p.tier, 'rooftop'), tagged: P(p.tagged, false),
        aim: { x, y: h, z },
        half: { x: p.half.x, y: P(p.targetHalfY, 3), z: p.half.z },
      });
    },
  },

  /**
   * A parking structure — decks stacked on columns, every one of them a
   * landing surface. This is the piece that makes the city an *altitude
   * selector*: the same footprint pays out at four heights, so overshooting
   * the top deck is landing on the one below rather than landing on nothing.
   */
  garage: {
    expand: (inst, out) => {
      const p = inst.params;
      const { x, z } = inst.pos;
      const top = p.levels[p.levels.length - 1];
      const ch = P(p.columnHalf, 1.6);
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        out.structures.push(slabRec(`${inst.id}_c${dx > 0 ? 'e' : 'w'}${dz > 0 ? 's' : 'n'}`,
          x + dx * (p.half.x - ch), top / 2, z + dz * (p.half.z - ch), ch, top / 2, ch, 'leg'));
      }
      p.levels.forEach((y, i) => {
        const id = `${inst.id}_d${i}`;
        out.structures.push(slabRec(id, x, y, z, p.half.x, P(p.deckHalfY, 0.5), p.half.z, 'roof'));
        out.targets.push({
          id, tier: P(p.tier, 'rooftop'), tagged: i === p.levels.length - 1,
          aim: { x, y: y + P(p.deckHalfY, 0.5), z },
          half: { x: p.half.x, y: 2.5, z: p.half.z },
        });
      });
    },
  },

  /**
   * A spiral flyover — the city's way up, built out of the ramp geometry the
   * game already has. Each segment is a wedge on a chord of the circle,
   * lifted by one segment's rise, so consecutive segments meet exactly: the
   * high end of one is the low end of the next. Every segment is `transit`,
   * because this is a road.
   */
  helix: {
    expand: (inst, out) => {
      const p = inst.params;
      const { x, z } = inst.pos;
      const R = p.radius, arc = p.arc;
      for (let i = 0; i < p.segments; i++) {
        const a0 = p.startAngle + i * arc, a1 = a0 + arc;
        const p0 = { x: x + Math.sin(a0) * R, z: z + Math.cos(a0) * R };
        const p1 = { x: x + Math.sin(a1) * R, z: z + Math.cos(a1) * R };
        const dx = p1.x - p0.x, dz = p1.z - p0.z;
        const len = Math.hypot(dx, dz);
        out.ramps.push(rampRec('wedge', {
          id: `${inst.id}_s${i}`,
          pos: { x: (p0.x + p1.x) / 2, y: p.y0 + i * p.rise, z: (p0.z + p1.z) / 2 },
          // A wedge climbs toward its own -Z, so the yaw is the bearing of the
          // chord, negated.
          yaw: Math.atan2(-dx / len, -dz / len),
          params: { height: p.rise, length: len, halfWidth: p.halfWidth, transit: true },
        }));
      }
    },
  },

  /**
   * A gantry crane (R10, Mega Works): two legs and a jib you can land on and
   * launch off. The jib is the point — a narrow platform forty metres up with
   * nothing under it, which is what makes the industrial arena read as
   * industrial rather than as a warehouse with ramps in it.
   */
  crane: {
    expand: (inst, out) => {
      const p = inst.params;
      const { x, z } = inst.pos;
      const h = p.height;
      const alongZ = P(p.alongZ, false);
      const span = p.span;
      for (const side of [-1, 1]) {
        out.structures.push(slabRec(`${inst.id}_leg${side < 0 ? 'a' : 'b'}`,
          x + (alongZ ? 0 : side * span), h / 2, z + (alongZ ? side * span : 0),
          2.2, h / 2, 2.2, 'leg'));
      }
      const hx = alongZ ? P(p.halfWidth, 6) : span + 2.2;
      const hz = alongZ ? span + 2.2 : P(p.halfWidth, 6);
      out.structures.push(slabRec(inst.id, x, h, z, hx, 0.7, hz, 'roof'));
      out.targets.push({
        id: inst.id, tier: P(p.tier, 'rooftop'), tagged: P(p.tagged, true),
        aim: { x, y: h + 0.7, z }, half: { x: hx, y: 3, z: hz },
      });
    },
  },

  /**
   * Street furniture — the things that exist to be destroyed (sim/props.js).
   * A prop is not part of the routing graph: nothing lands on it, nothing
   * launches off it, and the analyzer never sees it. It is kinematic until
   * something hits it hard enough, which is what makes a city affordable to
   * fill with them.
   */
  prop: {
    expand: (inst, out) => {
      const p = inst.params;
      out.props.push({
        id: inst.id, kind: P(p.kind, 'crate'),
        pos: { x: inst.pos.x, y: P(inst.pos.y, 0) + p.half.y, z: inst.pos.z },
        half: p.half, mass: p.mass,
      });
    },
  },

  /** A run of them along a line — a street of bollards is one gesture. */
  propLine: {
    expand: (inst, out) => {
      const p = inst.params;
      const n = Math.max(1, p.n);
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1);
        out.props.push({
          id: `${inst.id}_${i}`, kind: P(p.kind, 'bollard'),
          pos: {
            x: inst.pos.x + (p.to.x - inst.pos.x) * t,
            y: P(inst.pos.y, 0) + p.half.y,
            z: inst.pos.z + (p.to.z - inst.pos.z) * t,
          },
          half: p.half, mass: p.mass,
        });
      }
    },
  },

  /**
   * A skybridge: the mezzanine road between two podiums, and a landing
   * surface in its own right. Axis-aligned on purpose — target boxes are
   * axis-aligned everywhere in this codebase, so a diagonal bridge would be
   * a solid you can hit and a target you cannot score.
   */
  skybridge: {
    expand: (inst, out) => {
      const p = inst.params;
      const a = inst.pos, b = p.to;
      if (a.x !== b.x && a.z !== b.z) throw new Error(`skybridge '${inst.id}' is not axis-aligned`);
      const hx = Math.max(p.halfWidth, Math.abs(b.x - a.x) / 2);
      const hz = Math.max(p.halfWidth, Math.abs(b.z - a.z) / 2);
      const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
      const th = P(p.thickness, 0.7);
      out.structures.push(slabRec(inst.id, cx, p.y, cz, hx, th, hz, 'roof'));
      out.targets.push({
        id: inst.id, tier: P(p.tier, 'road'), tagged: P(p.tagged, false),
        aim: { x: cx, y: p.y + th, z: cz },
        half: { x: hx, y: 2.5, z: hz },
      });
    },
  },
};

/**
 * Piece list → the flat arena record everything reads.
 * @param desc { id, lot: { ground, spawn, coinPrefix }, pieces: [...] }
 */
export function expandPieces(desc) {
  const out = { ramps: [], structures: [], targets: [], coins: [], lanes: [], movers: [], props: [] };
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
