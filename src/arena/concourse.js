/**
 * Arena 6 — THE CONCOURSE (R12).
 *
 * **The Concourse has a ceiling.** It is the only arena in the game that does,
 * and that single fact is the routing idea: *you cannot solve anything by
 * going up*. Every other arena answers a hard gap the same way — more exit
 * angle, more height, more air. Here the roof is twenty-six metres over the
 * whole hall and it is not decoration, it is the rule. A line has to be solved
 * sideways.
 *
 * That makes it the inverse of the three arenas that max out verticality.
 * Vertical City is an altitude selector; Skyline is nothing *but* altitude;
 * Mega Works stacks. In here the entire usable band is twenty-six metres tall
 * and most of it is furniture, so the currency is not height, it is **line** —
 * where you are pointing, how much speed you kept through the columns, and
 * whether you can reach the gallery from the floor without ever apexing above
 * a train.
 *
 * The consequences run all the way down into the ramp palette:
 *
 * - **Every launch here is shallow.** Exit angles run 0.14–0.30 where the
 *   other five arenas sit at 0.46–0.54. A 0.50 kicker at sweep speed apexes
 *   forty-five metres up, which in this building is a collision with the roof.
 *   The angles are not a difficulty setting, they are what fits.
 * - **Shallow means long.** The same launches that cannot climb carry 80–220 m
 *   across the floor, so the hall is wide rather than tall and the columns are
 *   what make that distance interesting instead of empty.
 * - **The banked walls face in, everywhere.** Losing the line costs you the
 *   columns, not the round: the perimeter returns you at speed. Floodway does
 *   this along one axis; here it is the whole boundary, because an interior
 *   with hard walls would be a crash simulator.
 *
 * Four strata, and the gap between them is deliberately small:
 *
 *   FLOOR    0   the concourse itself, columns and all
 *   PLATFORM 5   four long island platforms, with a train on one of them
 *   MEZZ    13   the gallery — a ring above the floor, reachable from it
 *   GANTRY  19   service catwalks, six metres under the roof
 *
 * **The thing that makes this arena dangerous to build.** `predictArc` casts
 * *downward* and only once the flight is descending, so a ceiling is invisible
 * to every probe in the repository — the line analyzer, the gap generator and
 * the arena gate would all cheerfully certify a ramp that fires the car into
 * the roof at forty metres a second. That is Floodway's culvert walls again in
 * a new costume: geometry the measurements are structurally unable to see. So
 * `probe:arenas` gained a clearance check that ballistically apexes every
 * launchable ramp at the top sweep speed and requires the result to clear
 * whatever is above it. It is the check that makes every *other* probe's
 * blindness to ceilings harmless here.
 */

import { expandPieces } from './pieces.js';

export const HALL = {
  X: 260,                // half-length of the hall
  Z: 180,                // half-width
  CEIL: 26,              // the roof — the whole arena in one number
  PLATFORM: 5,
  MEZZ: 13,
  GANTRY: 19,
  GW: 22,                // gallery depth
  BAY: 52,               // column spacing
};

const at = (piece, id, pos, yaw, params = {}) => ({ piece, id, pos, yaw, params });

/**
 * A launch, angled for the stratum it sits on. This is the arena's one real
 * constant: the higher you start, the flatter you are allowed to leave, because
 * the roof does not move. Every number in here was picked by apexing the
 * ballistic at the gate's top sweep speed and leaving headroom.
 */
// By band rather than by exact height, and that is a scar. The first version
// was a lookup keyed on the stratum constants — and every launch in the
// building actually sits on a *deck* rather than on the stratum itself, at
// 13.9 and 19.6 rather than 13 and 19. Both missed, both fell through to the
// default 0.24, and the catwalk kickers apexed thirty-two metres up: six
// metres through the roof, from the flattest ramps in the game. Nothing but
// the clearance check could have seen it.
const angleFor = (y) => (y < 3 ? 0.27 : y < 10 ? 0.26 : y < 16 ? 0.20 : 0.11);

const kicker = (id, x, y, z, yaw, p = {}) =>
  at('kicker', id, { x, y, z }, yaw,
    { length: p.length ?? 22, halfWidth: p.halfWidth ?? 7,
      exitAngle: p.exitAngle ?? angleFor(y), lipFrac: p.lipFrac ?? 0.38 });

/** A ramp throws you toward its own -Z. */
const EAST = -Math.PI / 2;
const WEST = Math.PI / 2;
const SOUTH = Math.PI;
const NORTH = 0;

/** The four island platforms, running the length of the hall. */
const PLATFORMS = [
  { id: 'p_a', z: -104, flow: 1 },
  { id: 'p_b', z: -34, flow: -1 },
  { id: 'p_c', z: 34, flow: 1 },
  { id: 'p_d', z: 104, flow: -1 },
];

export function describeConcoursePieces() {
  const pieces = [];
  const { X, Z, CEIL, PLATFORM, MEZZ, GANTRY, GW, BAY } = HALL;

  // ── The roof: the arena's whole argument, cast in panels ────────────────
  // In panels rather than one slab for the reason Floodway's walls are: a
  // single enormous convex hull is a collider Rapier accepts and then refuses
  // to build.
  for (let ix = -3; ix <= 3; ix++) {
    for (let iz = -2; iz <= 2; iz++) {
      pieces.push(at('slab', `roof_${ix + 3}_${iz + 2}`,
        { x: ix * (X / 3.5), y: CEIL, z: iz * (Z / 2.5) }, 0,
        { half: { x: 65, y: 0.8, z: 65 }, kind: 'ceiling' }));
    }
  }

  // ── The perimeter: banked, facing in, all the way round ─────────────────
  // Transit, not launches. A wall you ride is a wall that gives the speed
  // back; a wall you launch off would point every line at the roof.
  const SEG = 40;
  for (let k = 0; k * SEG * 2 < X * 2; k++) {
    const x = -X + SEG + k * SEG * 2;
    for (const side of [-1, 1]) {
      pieces.push(at('quarterpipe', `wall_${side < 0 ? 'n' : 's'}_${k}`,
        { x, y: 0, z: side * (Z + 11) }, side < 0 ? SOUTH : NORTH,
        { radius: 11, halfWidth: SEG, transit: true }));
    }
  }
  for (let k = 0; k * SEG * 2 < Z * 2; k++) {
    const z = -Z + SEG + k * SEG * 2;
    for (const side of [-1, 1]) {
      pieces.push(at('quarterpipe', `wall_${side < 0 ? 'w' : 'e'}_${k}`,
        { x: side * (X + 11), y: 0, z }, side < 0 ? EAST : WEST,
        { radius: 11, halfWidth: SEG, transit: true }));
    }
  }

  // ── The floor, and what stands on it ────────────────────────────────────
  // (The floor's own target is pushed at the very end of this list, not here.
  // Landing resolution takes the first target whose box contains the point,
  // and a target the size of the arena declared early shadows every specific
  // one at ground level — it swallowed the underpass whole, and the pool read
  // as unreachable while sitting directly under a landing.)

  // The columns are what the floor is *for*. A shallow launch here runs two
  // hundred metres, which is a long time to be holding a line, and these are
  // what make holding it a skill rather than a wait. Two rows, sited in the
  // gaps between the platforms so they never stand on a landing surface.
  for (let ix = -4; ix <= 4; ix++) {
    for (const z of [-BAY, BAY]) {
      pieces.push(at('slab', `col_${ix + 4}_${z < 0 ? 'n' : 's'}`,
        { x: ix * BAY, y: CEIL / 2, z }, 0,
        { half: { x: 2.2, y: CEIL / 2, z: 2.2 }, kind: 'leg' }));
    }
  }

  // ── The island platforms ────────────────────────────────────────────────
  // Held inside the gallery ring on every side, so a platform launch runs out
  // under open roof rather than into the underside of a gallery.
  for (const p of PLATFORMS) {
    pieces.push(at('slab', `plat_${p.id}`, { x: 0, y: PLATFORM / 2, z: p.z }, 0,
      { half: { x: X - 60, y: PLATFORM / 2, z: 14 }, kind: 'roof' }));
    pieces.push(at('target', `plat_${p.id}`, { x: 0, y: PLATFORM, z: p.z }, 0,
      { tier: 'rooftop', tagged: true, half: { x: X - 60, y: 3, z: 14 } }));

    // Five along the island, alternating sides so a straight run down the
    // middle does not miss all of them. Floodway taught that one the hard
    // way: two staggered rows with a clean lane between them is a corridor.
    const yaw = p.flow > 0 ? EAST : WEST;
    for (let k = 0; k < 5; k++) {
      pieces.push(kicker(`fl_${p.id}_${k}`, (-2 + k) * 84 * p.flow, PLATFORM,
        p.z + (k % 2 ? 6.5 : -6.5), yaw, { length: 24, halfWidth: 6 }));
    }
    // And one firing across the hall, so the platforms are a graph rather
    // than four parallel lines that never meet. Flatter than the ones firing
    // along the island, because this one flies *under the catwalks*.
    pieces.push(kicker(`cross_${p.id}`, p.flow > 0 ? -128 : 128, PLATFORM, p.z,
      p.z < 0 ? SOUTH : NORTH, { length: 26, halfWidth: 8, exitAngle: 0.22 }));
  }

  // ── The floor's own launches ────────────────────────────────────────────
  // Down the spine and through the column rows, firing across the hall. The
  // flattest thing on the floor, because everything above it is a lid.
  for (let k = 0; k < 5; k++) {
    pieces.push(kicker(`gr_spine_${k}`, (-2 + k) * 106, 0, 0,
      k % 2 ? NORTH : SOUTH, { length: 26, halfWidth: 8 }));
  }
  for (const [i, z] of [-BAY, BAY].entries()) {
    for (const x of [-BAY * 2.5, BAY * 1.5]) {
      pieces.push(kicker(`gr_bay_${i}_${x < 0 ? 'w' : 'e'}`, x, 0, z,
        z < 0 ? NORTH : SOUTH, { length: 24, halfWidth: 7 }));
    }
  }

  // ── Escalator banks: how you get up, and they are roads ──────────────────
  // Every stratum has a driven way onto it, because *no launch in this
  // building climbs a storey*. That is not an oversight, it is the arena: the
  // roof caps the exit angles, the exit angles cap the apex, and the apex
  // never reaches the gallery. Height is bought by driving, and only by
  // driving.
  for (const p of PLATFORMS) {
    for (const side of [-1, 1]) {
      pieces.push(at('wedge', `esc_${p.id}_${side < 0 ? 'a' : 'b'}`,
        { x: side * (X - 76), y: 0, z: p.z }, side < 0 ? EAST : WEST,
        { height: PLATFORM, length: 28, halfWidth: 10, transit: true }));
    }
  }
  // Floor to gallery: four long climbs, running *along* the gallery at its
  // ends so they never stand under the platforms' flight path.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      pieces.push(at('wedge', `esc_mezz_${sx < 0 ? 'w' : 'e'}${sz < 0 ? 'n' : 's'}`,
        { x: sx * (X - 34), y: 0, z: sz * (Z - GW) }, sx < 0 ? WEST : EAST,
        { height: MEZZ, length: 68, halfWidth: 12, transit: true }));
    }
  }

  // ── The gallery: a ring at thirteen metres, all the way round ───────────
  // The arena's one continuous high road, and the only way to carry speed
  // from one end of the hall to the other without threading the columns.
  for (const side of [-1, 1]) {
    const z = side * (Z - GW);
    pieces.push(at('slab', `mezz_${side < 0 ? 'n' : 's'}`, { x: 0, y: MEZZ, z }, 0,
      { half: { x: X, y: 0.9, z: GW }, kind: 'roof' }));
    // Untagged on purpose. Nothing in the building launches onto the gallery
    // — that is the arena's whole premise — so tagging it would advertise a
    // landing no line can make, which is the failure the city was pulled up
    // for. It is a road: you drive here, and you score on the way *off*.
    pieces.push(at('target', `mezz_${side < 0 ? 'n' : 's'}`, { x: 0, y: MEZZ + 0.9, z }, 0,
      { tier: 'road', tagged: false, half: { x: X, y: 3, z: GW } }));
    for (let k = 0; k < 4; k++) {
      const x = (-1.5 + k) * 116;
      pieces.push(at('slab', `mezzleg_${side < 0 ? 'n' : 's'}_${k}`,
        { x, y: MEZZ / 2, z }, 0, { half: { x: 2.4, y: MEZZ / 2, z: 2.4 }, kind: 'leg' }));
      // Firing inward, over the open middle of the hall — the one direction
      // in this building with nothing but roof above it.
      pieces.push(kicker(`mz_${side < 0 ? 'n' : 's'}_${k}`, x, MEZZ + 0.9,
        z - side * (GW - 4), side < 0 ? SOUTH : NORTH, { length: 24, halfWidth: 7 }));
    }
  }
  // No gallery across the east and west ends, and that absence is the single
  // most load-bearing decision in the building. A ring all the way round is
  // the obvious shape and it makes the hall unplayable: the platforms run
  // east–west, so every launch along an island ends up under the gallery end,
  // and at six metres of headroom the only exit angle that clears it is 0.17,
  // which is not a launch, it is a bump. Opening the two ends to the roof
  // gives the platforms twenty-five metres of air to work with, and the long
  // axis of the hall becomes the one place you are allowed to commit.

  // ── The catwalks: above the gallery, never over the hall ────────────────
  // Sited on top of the ring rather than spanning the room, and that is a
  // clearance decision rather than a look: a catwalk across the middle at
  // nineteen metres is a second ceiling six metres lower than the real one,
  // and it would cap every launch in the building a second time.
  for (const side of [-1, 1]) {
    const z = side * (Z - GW);
    pieces.push(at('slab', `gantry_${side < 0 ? 'n' : 's'}`, { x: 0, y: GANTRY, z }, 0,
      { half: { x: X - 40, y: 0.6, z: 6 }, kind: 'roof' }));
    pieces.push(at('target', `gantry_${side < 0 ? 'n' : 's'}`, { x: 0, y: GANTRY + 0.6, z }, 0,
      { tier: 'road', tagged: false, half: { x: X - 40, y: 3, z: 6 } }));
    for (const [k, x] of [-150, 0, 150].entries()) {
      pieces.push(kicker(`gt_${side < 0 ? 'n' : 's'}_${k}`, x, GANTRY + 0.6, z - side * 4,
        side < 0 ? SOUTH : NORTH, { length: 20, halfWidth: 5.5 }));
    }
    // The driven way up from the gallery, at the far end from the escalators.
    pieces.push(at('wedge', `gtramp_${side < 0 ? 'n' : 's'}`,
      { x: side * (X - 70), y: MEZZ + 0.9, z }, side < 0 ? EAST : WEST,
      { height: GANTRY - MEZZ - 0.3, length: 44, halfWidth: 9, transit: true }));
  }

  // ── The train ───────────────────────────────────────────────────────────
  // One mover, on the platform it belongs on. Not a fleet: this arena's
  // subject is the line, and a hall full of moving landings would make the
  // subject timing, which is Mega Works' job.
  pieces.push(at('mover', 'service_train', { x: 0, z: PLATFORMS[2].z }, 0, {
    kind: 'train', tier: 'moving',
    half: { x: 12, y: 2.4, z: 4.2 }, cars: 4, gap: 30,
    y: PLATFORM + 3.6, speed: 24,
    from: { x: -(X - 70), z: PLATFORMS[2].z }, to: { x: X - 70, z: PLATFORMS[2].z },
    loop: 'wrap',
  }));

  // ── The clock: the x5, hung from the roof ───────────────────────────────
  // The one thing in the arena that uses the ceiling instead of fighting it,
  // and it is hung as high as it can be while still being landable — right
  // under the roof, above the flattest launches in the building.
  // Sited from the measurement rather than by eye: not at the apex of a
  // gallery launch but at the point where that arc comes back *down* through
  // the face's height, ninety-nine metres out. Hung at the apex it would be
  // flown over every time and never landed on, which is a x5 made of scenery.
  pieces.push(at('mast', 'the_clock', { x: -58, z: -88 }, 0, {
    legId: 'clock_hanger', legY: 22, legHalf: { x: 1.1, y: 4.4, z: 1.1 },
    topId: 'clock_face', topY: 17.6, topHalf: { x: 8, z: 12 },
    aimY: 18.3, targetHalf: { x: 8, y: 2, z: 12 },
  }));

  // ── The flooded underpass ───────────────────────────────────────────────
  pieces.push(at('pool', 'underpass', { x: -128, z: -56 }, 0, {
    half: 15, floorY: 0.4, wallY: 2.4, wallPrefix: 'up_w_',
    floorId: 'underpass_floor',
    aimY: 1.2, targetHalf: { x: 15, y: 4, z: 15 },
  }));

  // ── Departure boards: the only bright objects, as ever ───────────────────
  for (const [k, spec] of [{ x: -150, z: -BAY }, { x: 150, z: BAY }].entries()) {
    pieces.push(at('billboard', `board_${k}`, { x: spec.x, z: spec.z }, 0, {
      legId: `board_${k}_leg`, legY: 4.5, legHalf: { x: 1.4, y: 4.5, z: 1.4 },
      panelY: 10, panelHalf: { x: 13, y: 0.6, z: 5 },
      aimY: 10.7, targetHalf: { x: 13, y: 2.5, z: 5 },
    }));
  }

  // ── A coin line down the spine ──────────────────────────────────────────
  pieces.push(at('coinArc', 'coins_spine', { x: 0, z: 0 }, 0, {
    from: { x: -150, y: 6, z: -20 },
    to: { x: 150, y: 6, z: -20 },
    apexY: 7, n: 14,
  }));

  // ── The floor, last, so it is the fallback rather than the answer ───────
  pieces.push(at('target', 'concourse_floor', { x: 0, y: 0, z: 0 }, 0,
    { tier: 'road', tagged: false, half: { x: X, y: 3, z: Z } }));

  // ── Street furniture: a concourse has things standing on it ─────────────
  pieces.push(at('propLine', 'benches', { x: -70, z: -16 }, 0, {
    kind: 'crate', n: 5, to: { x: 70, z: -16 },
    half: { x: 1.1, y: 0.7, z: 0.5 }, mass: 60,
  }));

  return {
    id: 'hall',
    name: 'THE CONCOURSE',
    lot: {
      ground: 700,
      ceiling: CEIL,          // read by probe:arenas — the arena states its lid
      spawn: { x: -X + 46, y: 1.08, z: 0 },
      coinPrefix: 'hcoin_',
    },
    pieces,
  };
}

export function describeConcourse() {
  return expandPieces(describeConcoursePieces());
}
