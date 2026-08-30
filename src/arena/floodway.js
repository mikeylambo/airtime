/**
 * Arena 4 — FLOODWAY (R10).
 *
 * **Floodway has a direction.** It is the only arena in the game that does.
 * Three terraces step down from twenty-four metres to the deck, and the flow
 * *serpentines*: the top channel runs west to east, the middle runs east to
 * west, the bottom runs west to east again, joined at the ends by spillways
 * you drive down. Every launch on a terrace points the way the water goes.
 *
 * That is a routing idea neither of the others has. The Yard is symmetric
 * under rotation; Vertical City is symmetric under gravity; in both of them a
 * line is as good flown backwards as forwards. Here it is not — going with the
 * flow you accumulate speed you did not have to earn, and going against it you
 * spend everything and arrive with nothing.
 *
 * The walls are the second half of it. Every channel is bounded by quarter
 * pipes facing *inward*, so drifting wide does not end a line, it returns you
 * to it carrying the speed you took into the wall. Floodway is the arena whose
 * geometry forgives a bad line and punishes a slow one.
 *
 * Two kinds of ramp, and the difference is the whole design:
 *
 * - **Spillways are roads.** They are `transit`; you drive down one. Nothing
 *   in the arena launches off the way down, because a drop you were going to
 *   take anyway is not a trick.
 * - **Weirs are launches.** They sit at the end of a terrace and throw you
 *   across the drop instead of down it — trading the descent for airtime over
 *   the basin below. They are the only ramps here that point across the
 *   gradient rather than along it.
 */

import { expandPieces } from './pieces.js';

export const FLOOD = {
  RUN: 300,              // half-length of a terrace — the long-speed lines
  WIDTH: 44,             // half-width of a channel floor
  PITCH: 76,             // kicker spacing: one comfortable hop at 44 m/s
  WALL: 11,              // banked wall radius
};

const at = (piece, id, pos, yaw, params = {}) => ({ piece, id, pos, yaw, params });

const kicker = (id, x, y, z, yaw, p = {}) =>
  at('kicker', id, { x, y, z }, yaw,
    { length: p.length ?? 20, halfWidth: p.halfWidth ?? 7,
      exitAngle: p.exitAngle ?? 0.48, lipFrac: p.lipFrac ?? 0.40 });

/** Facing, in the ramp convention: a ramp throws you toward its own -Z. */
const EAST = -Math.PI / 2;      // +X
const WEST = Math.PI / 2;       // -X
const SOUTH = Math.PI;          // +Z
const NORTH = 0;                // -Z

/**
 * The three terraces, high to low, and which way each one flows. The
 * alternation is the arena: a straight line down the gradient would be a
 * ramp, and a ramp is not a place.
 */
// The z-spacing is a range decision, not a look: a weir has to *clear* the
// gap to the terrace below. At 190 m apart the weirs landed on bare ground
// between the channels and `npm run lines` called them deck-only ramps.
const TERRACES = [
  { id: 'top', z: -150, y: 24, flow: 1 },
  { id: 'mid', z: 0, y: 12, flow: -1 },
  { id: 'low', z: 150, y: 0, flow: 1 },
];

export function describeFloodPieces() {
  const pieces = [];
  const W = FLOOD.WIDTH;
  const R = FLOOD.RUN;

  // ── The terraces ────────────────────────────────────────────────────────
  // Built up rather than cut down: the ground is a slab and nothing here can
  // dig into it, so the deck is the floodway's own lowest terrace.
  for (const t of TERRACES) {
    if (t.y > 0) {
      pieces.push(at('slab', `terrace_${t.id}`, { x: 0, y: t.y / 2, z: t.z }, 0,
        { half: { x: R, y: t.y / 2, z: W }, kind: 'roof' }));
    }
    pieces.push(at('target', `terrace_${t.id}`, { x: 0, y: t.y, z: t.z }, 0,
      { tier: 'road', tagged: false, half: { x: R, y: 3, z: W } }));

    // The banked walls, facing in — cast in sections like a real one. A
    // single six-hundred-metre pipe builds convex hulls Rapier accepts and
    // then refuses to make colliders from, and the whole arena failed to
    // load on it.
    const SEG = 40;
    for (const side of [-1, 1]) {
      for (let k = 0; k * SEG * 2 < R * 2; k++) {
        pieces.push(at('quarterpipe', `wall_${t.id}_${side < 0 ? 'n' : 's'}_${k}`,
          { x: -R + SEG + k * SEG * 2, y: t.y, z: t.z + side * (W + FLOOD.WALL) },
          side < 0 ? SOUTH : NORTH,
          { radius: FLOOD.WALL, halfWidth: SEG, transit: true }));
      }
    }
  }

  // ── Along the flow: the long-speed lines ────────────────────────────────
  // Seven kickers a terrace at the pitch a car actually covers, all facing
  // the way the channel runs. This is what makes a terrace a chain rather
  // than a corridor with two ramps in it — the first layout put them a
  // hundred and fifty metres apart and `npm run lines` reported nothing in
  // the arena reachable from three others.
  for (const t of TERRACES) {
    const yaw = t.flow > 0 ? EAST : WEST;
    for (let k = 0; k < 7; k++) {
      const x = (-3 + k) * FLOOD.PITCH * t.flow;
      pieces.push(kicker(`fw_${t.id}_${k}`, x, t.y, t.z + (k % 2 ? 16 : -16), yaw,
        { length: 22, halfWidth: 8, exitAngle: k % 3 === 2 ? 0.54 : 0.46 }));
    }
  }

  // ── Spillways: the way down, at the end of each run, and they are roads ─
  for (let step = 0; step < 2; step++) {
    const a = TERRACES[step], b = TERRACES[step + 1];
    const gapMid = (a.z + W + b.z - W) / 2;
    const len = (b.z - W) - (a.z + W);
    // At the downstream end of the upper terrace, which is where the water
    // would actually go over.
    const x = a.flow > 0 ? R - 100 : -R + 100;
    for (const off of [-34, 34]) {
      pieces.push(at('wedge', `spill_${step}_${off < 0 ? 'a' : 'b'}`,
        { x: x + off, y: b.y, z: gapMid }, NORTH,
        { height: a.y - b.y, length: len, halfWidth: 16, transit: true }));
    }
  }

  // ── Weirs: launch across the drop instead of down it ────────────────────
  for (let step = 0; step < 2; step++) {
    const a = TERRACES[step], b = TERRACES[step + 1];
    const x = a.flow > 0 ? R - 100 : -R + 100;
    for (const [k, off] of [[0, -60], [1, 60]]) {
      pieces.push(kicker(`weir_${step}_${k}`, x + off, a.y, a.z + W - 14, SOUTH,
        { length: 24, halfWidth: 9, exitAngle: 0.50 }));
    }
  }

  // ── Culverts: covered channel, and the roof is a landing ────────────────
  // The one place in the arena with something *above* the line.
  for (const [k, t] of [[0, TERRACES[0]], [1, TERRACES[1]], [2, TERRACES[2]]]) {
    const x = (k - 1) * 120;
    pieces.push(at('slab', `culvert_${k}`, { x, y: t.y + 9, z: t.z }, 0,
      { half: { x: 32, y: 0.9, z: W - 4 }, kind: 'roof' }));
    pieces.push(at('target', `culvert_${k}`, { x, y: t.y + 9.9, z: t.z }, 0,
      { tier: 'rooftop', tagged: true, half: { x: 32, y: 3, z: W - 4 } }));
    // The piers run *along* the flow, at the outer edge of the roof, because
    // the culvert is a thing you drive through. Built the other way round —
    // offset in x, long in z — they were not piers at all, they were two
    // nine-metre walls across the channel sixty metres apart, and the capture
    // rig found it before any probe did: the scripted driver went down the top
    // channel at 119 km/h and stopped dead against one.
    for (const side of [-1, 1]) {
      pieces.push(at('slab', `culvert_${k}_p${side < 0 ? 'a' : 'b'}`,
        { x, y: t.y + 4.5, z: t.z + side * (W - 5.4) }, 0,
        { half: { x: 32, y: 4.5, z: 1.4 }, kind: 'leg' }));
    }
    pieces.push(kicker(`culvert_up_${k}`, x, t.y + 9.9, t.z + (k % 2 ? 14 : -14),
      t.flow > 0 ? EAST : WEST, { length: 18, halfWidth: 6.5, exitAngle: 0.50 }));
  }

  // ── Basins: what a weir throws you into, priced at x3 ───────────────────
  for (let step = 0; step < 2; step++) {
    const a = TERRACES[step], b = TERRACES[step + 1];
    // Directly under where the first weir of this step actually lands, not
    // beside it: a basin the weirs overfly is a x3 target nothing reaches.
    const x = (a.flow > 0 ? R - 100 : -R + 100) - 60;
    pieces.push(at('slab', `basin_${step}_base`, { x, y: b.y + 3, z: b.z - 28 }, 0,
      { half: { x: 24, y: b.y / 2 + 3, z: 20 }, kind: 'roof' }));
    pieces.push(at('pool', `basin_${step}`, { x, z: b.z - 28 }, 0, {
      half: 14, floorY: b.y + 7.4, wallY: b.y + 9.4, wallPrefix: `bw_${step}_`,
      floorId: `basin_${step}_floor`,
      aimY: b.y + 8, targetHalf: { x: 14, y: 4, z: 14 },
    }));
  }

  // ── The return weirs: the only launches that fire upstream ──────────────
  // Every spillway delivers to the *upstream* end of the terrace below,
  // because the flow alternates — so every channel has a feeder except the
  // top one, which has nothing above it. `npm run lines` said so plainly: the
  // head of the top channel was a ramp nothing in the arena could reach.
  //
  // A helix like the city's Coil cannot fix it, because a full turn returns
  // you to the x and z you started at and the head is two hundred metres
  // away. What fixes it is a ramp that fires *against* the gradient — which
  // is the one thing this arena is about making expensive, so it is steep, it
  // is at the far end, and it costs a full channel of speed to use.
  for (const [k, x] of [[0, -228], [1, -152]]) {
    pieces.push(kicker(`weir_up_${k}`, x, TERRACES[1].y, TERRACES[1].z - W + 16, NORTH,
      { length: 26, halfWidth: 9, exitAngle: 0.54 }));
  }

  // ── The head gate: the x5, over the top of the run ──────────────────────
  // Sited where the top terrace's first kicker throws you, so the secret is
  // on a line rather than in a corner.
  // Sited from the measurement too: on the busiest high corridor over the
  // middle channel, where flights off the top terrace come down.
  pieces.push(at('mast', 'headgate', { x: -71, z: 15 }, 0, {
    legId: 'headgate_leg', legY: 17, legHalf: { x: 1.6, y: 17, z: 1.6 },
    topId: 'headgate_top', topY: 34.3, topHalf: { x: 5.5, z: 5.5 },
    aimY: 34.7, targetHalf: { x: 5.5, y: 2.5, z: 5.5 },
  }));

  // ── Billboards, sited from the measurement ──────────────────────────────
  // Not by eye and not at apex: the analyzer knows where descending arcs
  // actually cross each altitude, and these are the busiest of those
  // corridors on each terrace. Placed at apex height they were signs every
  // flight passed *over* — three tagged targets nothing could land on.
  const BB = [
    { id: 'bb_low', x: 192, z: 135, y: 11 },     // the low channel, downstream
    { id: 'bb_mid', x: -96, z: 15, y: 23 },      // over the middle channel
    { id: 'bb_top', x: -23, z: -165, y: 37 },    // the head of the run
  ];
  BB.forEach((b, n) => {
    pieces.push(at('billboard', b.id, { x: b.x, z: b.z }, 0, {
      legId: `bbleg_${n}`, legY: b.y / 2, legHalf: { x: 1.2, y: b.y / 2, z: 1.2 },
      panelY: b.y + 0.4, panelHalf: { x: 12, y: 0.4, z: 4.5 },
      aimY: b.y + 0.8, targetHalf: { x: 12, y: 2.5, z: 4.5 }, tagged: true,
    }));
  });

  // ── The coin line that draws the flow ───────────────────────────────────
  // No inlet ramp: the lowest terrace *is* the deck, so a run drives straight
  // into the channel. A ramp there would be a launch nothing in the arena
  // could ever reach, which is the definition of an orphan.
  pieces.push(at('coinArc', 'coins_flow', { x: -R + 40, z: TERRACES[0].z }, 0, {
    from: { x: -R + 40, y: 34, z: TERRACES[0].z - 10 },
    to: { x: -R + 40 + 150, y: 34, z: TERRACES[0].z + 10 },
    apexY: 10, n: 14,
  }));

  // ── Street furniture: the debris a channel collects ─────────────────────
  for (const t of TERRACES) {
    pieces.push(at('propLine', `debris_${t.id}`,
      { x: -R + 60, y: t.y, z: t.z + W - 12 }, 0, {
        to: { x: R - 60, z: t.z + W - 12 }, n: 12, kind: 'crate',
        half: { x: 1.3, y: 1.3, z: 1.3 }, mass: 30,
      }));
  }

  return {
    id: 'flood',
    name: 'FLOODWAY',
    lot: {
      ground: 1100,
      // Downstream of the low terrace, pointing up the gradient: the first
      // thing the arena teaches is that climbing it costs.
      spawn: { x: -FLOOD.RUN + 40, y: 1.08, z: TERRACES[2].z + FLOOD.WIDTH + 170 },
      coinPrefix: 'fcoin_',
    },
    pieces,
  };
}

/** Nothing stands inside a solid — the same filter the other arenas use. */
function standingClear(prop, arena) {
  for (const s of arena.structures) {
    if (Math.abs(prop.pos.x - s.pos.x) > s.half.x + prop.half.x) continue;
    if (Math.abs(prop.pos.z - s.pos.z) > s.half.z + prop.half.z) continue;
    if (prop.pos.y - prop.half.y > s.pos.y + s.half.y) continue;
    return false;
  }
  for (const r of arena.ramps) {
    const reach = r.length / 2 + r.halfWidth + prop.half.x;
    if (Math.hypot(prop.pos.x - r.pos.x, prop.pos.z - r.pos.z) < reach
        && Math.abs(prop.pos.y - r.pos.y) < 12) return false;
  }
  return true;
}

export function describeFlood() {
  const arena = expandPieces(describeFloodPieces());
  arena.props = arena.props.filter((p) => standingClear(p, arena));
  return arena;
}
