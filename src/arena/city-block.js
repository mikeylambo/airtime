/**
 * Arena 2 — VERTICAL CITY (R8), as an authored piece list.
 *
 * Build 1's city was a procedural grid of towers with the ramps on the floor:
 * every launch was street -> roof, every roof was a dead end, and `npm run
 * lines` measured it at four orphan ramps and six ramps reachable from three
 * or more. It was a scatter with a skyline. So it is authored now, the way
 * The Yard was, and against its own routing idea rather than The Yard's.
 *
 * **The Yard is centripetal** — rings pointing inward, a tower in the middle,
 * and the player's job is finding ways back out. Vertical City is the
 * inverse in both axes:
 *
 * - **The centre is a pit, not a peak.** The middle of the city is a low
 *   plaza with a pool on it. Everything valuable is around the edge and
 *   above, so the city's default gravity is *outward and downward*, and the
 *   player's job is refusing to come down.
 * - **Altitude is the currency.** Four strata, and every one of them is a
 *   self-sustaining network: land on a roof and there is a kicker on that
 *   roof aimed at the next one. Descending is free; ascending costs speed you
 *   have to have carried from the street.
 *
 *     STREET   y=0    traffic, the run-ups, the eight kickers that get you up
 *     MEZZ     y=12   skybridges, podiums, the plaza — the first landing
 *     ROOFS    y=24-34 the tower tops, the billboards, the garage's decks
 *     SPIRE    y=46   one skyscraper. Everything below is reachable from it
 *
 * Laid out by range, like The Yard. A kicker's lip is already ~9 m up, and a
 * car leaving it at 44 m/s apexes ~10 m above that and travels ~70 m, so the
 * grid pitch is 72 m — one block is a comfortable hop, the diagonal is a
 * committed one — and each stratum sits inside one apex of the one below.
 *
 * Two structures carry the identity:
 *
 * - **THE COIL**, a spiral flyover you *drive* up. The city's honest way from
 *   the street to the roofs, and the reason a bad run is never over.
 * - **THE STACK**, a four-deck parking structure with cantilevered kickers on
 *   every deck. It is an altitude selector: overshooting the top deck lands
 *   you on the one below rather than on nothing.
 *
 * AFTERGLOW (airtime-art-direction.md): a lightless city, windows sparse,
 * billboards the only bright objects — brightness is "land here" language.
 * The dressing follows the structures, so nothing here is a colour decision.
 */

import { expandPieces } from './pieces.js';

export const CITY = {
  P: 72,                 // grid pitch — one comfortable hop at 44 m/s
  MEZZ: 12,              // the skybridge / podium stratum
  SPIRE: 46,             // the skyscraper roof
  COIL_TOP: 28,          // where the spiral flyover puts you
};

const g = (n) => n * CITY.P;
const at = (piece, id, pos, yaw, params = {}) => ({ piece, id, pos, yaw, params });

/** Face a piece at a point — every yaw in this file is stated, never inferred. */
const toward = (from, to) => Math.atan2(from.x - to.x, from.z - to.z);

/** A kicker, wherever it sits. The lip is ~9 m up, which is the whole point. */
const kicker = (id, x, y, z, yaw, p = {}) =>
  at('kicker', id, { x, y, z }, yaw,
    { length: p.length ?? 20, halfWidth: p.halfWidth ?? 6.5,
      exitAngle: p.exitAngle ?? 0.52, lipFrac: p.lipFrac ?? 0.40 });

export function describeCityPieces() {
  const pieces = [];
  const P = CITY.P;

  // ── The eight towers ─────────────────────────────────────────────────────
  // Heights are a routing decision, not decoration: no two neighbours match,
  // so a roof-to-roof hop is always either a climb or a drop and the player
  // has to know which. The two short ones at ±g(2) are mezzanine-adjacent —
  // they are how the outer ring rejoins the middle.
  const TOWERS = [
    { id: 'tw_nw', x: -g(1), z: -g(1), h: 30, half: 17 },
    { id: 'tw_ne', x: g(1), z: -g(1), h: 24, half: 18 },
    { id: 'tw_w', x: -g(1), z: 0, h: 34, half: 16 },
    { id: 'tw_e', x: g(1), z: 0, h: 26, half: 18 },
    { id: 'tw_se', x: g(1), z: g(1), h: 31, half: 17 },
    { id: 'tw_n', x: 0, z: -g(2), h: 22, half: 19 },
    { id: 'tw_wo', x: -g(2), z: 0, h: 22, half: 19 },
    { id: 'tw_eo', x: g(2), z: 0, h: 28, half: 17 },
  ];
  for (const t of TOWERS) {
    pieces.push(at('tower', t.id, { x: t.x, z: t.z }, 0, {
      half: { x: t.half, z: t.half }, height: t.h, tier: 'rooftop',
      // Tag the tall ones: the target-lock camera should frame the handful
      // worth a shot, not every building in the city.
      tagged: t.h >= 28,
    }));
  }

  // ── THE SPIRE — the skyscraper the acceptance clip launches off ─────────
  // Sixteen metres above the tallest tower, with a roll-off on each face, so
  // leaving it in any direction is a two-and-a-half second flight that ends
  // somewhere authored.
  pieces.push(at('tower', 'spire', { x: 0, z: -g(1) }, 0, {
    half: { x: 16, z: 16 }, height: CITY.SPIRE, tier: 'rooftop', tagged: true,
    targetHalfY: 4,
  }));
  // Faces *out*: you leave the spire, you never aim at it from up here.
  const spireFaces = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  spireFaces.forEach(([dx, dz], i) => {
    const x = dx * 23, z = -g(1) + dz * 23;
    pieces.push(at('wedge', `spire_off_${i}`, { x, y: CITY.SPIRE, z },
      Math.atan2(-dx, -dz),
      { height: 5.4, length: 22, halfWidth: 8 }));
  });

  // ── THE STACK — the parking structure, and the altitude selector ────────
  const stackZ = g(1) + 18;
  pieces.push(at('garage', 'stack', { x: 0, z: stackZ }, 0, {
    half: { x: 22, z: 18 }, levels: [9, 18, 27], deckHalfY: 0.6, columnHalf: 1.8,
    tier: 'rooftop',
  }));
  // Cantilevered north off each deck, so nothing overhangs the lip: a kicker
  // tucked under the deck above is a ceiling, not a ramp.
  [9, 18, 27].forEach((y, i) => {
    pieces.push(kicker(`stack_up_${i}`, 0, y + 0.6, stackZ - 26, Math.PI,
      { length: 18, halfWidth: 7, exitAngle: 0.50 }));
  });

  // ── THE COIL — the spiral flyover, the city's way up ────────────────────
  // Sixteen wedges on chords of a 30 m circle, each lifting 1.75 m: one full
  // turn, an eight-and-a-half degree climb, and a corner you take at about
  // eighteen metres a second. Every segment is `transit`, because it is a
  // road — and the segment count is the whole difference between a road and
  // a hazard. Ten wedges of forty-five degrees each was a spiral staircase:
  // `probe:city` measured a car reaching 5.5 m of 28 before it fell off the
  // second hairpin. Sixteen of twenty-two and a half degrees is driveable,
  // and it fits inside one block with the streets left clear.
  const coil = { x: -g(1), z: g(1) };
  // radius 26 so the ring fits inside its own block with both streets clear;
  // startAngle 1.035 so the tangent at the exit points at the plaza — a
  // spiral that delivers you to the top and then throws you at nothing is
  // half a feature, and `npm run lines -- --city` said so out loud (one
  // deck-only ramp, and it was this one).
  const COIL = { radius: 26, y0: 0, rise: 1.75, segments: 16,
                 startAngle: 1.035, arc: Math.PI / 8, halfWidth: 5.5 };
  pieces.push(at('helix', 'coil', coil, 0, COIL));
  // What the coil is *for*: it ends in a launch, not in a parapet. The exit
  // is derived from the helix rather than eyeballed — one full turn puts it
  // directly above the mouth, and a kicker guessed onto the far side of the
  // circle is a ramp the spiral never delivers anybody to.
  const coilAt = (i) => {
    const a = COIL.startAngle + i * COIL.arc;
    return { x: coil.x + Math.sin(a) * COIL.radius, z: coil.z + Math.cos(a) * COIL.radius };
  };
  const exit = coilAt(COIL.segments);
  const prev = coilAt(COIL.segments - 1);
  const ex = exit.x - prev.x, ez = exit.z - prev.z;
  const el = Math.hypot(ex, ez);
  const outYaw = Math.atan2(-ex / el, -ez / el);
  const OUT_LEN = 20;
  pieces.push(kicker('coil_out',
    exit.x + Math.sin(outYaw) * (OUT_LEN / 2), COIL.y0 + COIL.segments * COIL.rise,
    exit.z + Math.cos(outYaw) * (OUT_LEN / 2), outYaw,
    { length: OUT_LEN, halfWidth: 6, exitAngle: 0.52 }));

  // ── The plaza: the city's centre is a pit ───────────────────────────────
  pieces.push(at('slab', 'plaza', { x: 0, y: CITY.MEZZ / 2, z: 0 }, 0,
    { half: { x: 26, y: CITY.MEZZ / 2, z: 26 }, kind: 'roof' }));
  pieces.push(at('pool', 'pool', { x: 0, z: 0 }, 0, {
    half: 13, floorY: CITY.MEZZ + 2.4, wallY: CITY.MEZZ + 4.4, wallPrefix: 'poolw_',
    aimY: CITY.MEZZ + 3, targetHalf: { x: 13, y: 4, z: 13 },
  }));
  // Off the plaza in all four directions — the mezzanine's own launches, and
  // the only ramps in the city that face outward from the middle.
  [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([dx, dz], i) => {
    pieces.push(kicker(`plaza_up_${i}`, dx * 33, CITY.MEZZ, dz * 33,
      Math.atan2(-dx, -dz), { length: 19, halfWidth: 6.5, exitAngle: 0.54 }));
  });

  // ── Skybridges: the mezzanine, and the roads between the podiums ────────
  // Each one spans a street at y=12 and carries a kicker, so the mezzanine is
  // a network in its own right rather than a set of landing pads.
  const BRIDGES = [
    { id: 'br_nw', from: { x: -g(1), z: -g(1) }, to: { x: -g(1), z: 0 } },
    { id: 'br_ne', from: { x: g(1), z: -g(1) }, to: { x: g(1), z: 0 } },
    { id: 'br_se', from: { x: g(1), z: 0 }, to: { x: g(1), z: g(1) } },
    { id: 'br_w', from: { x: -g(2), z: 0 }, to: { x: -g(1), z: 0 } },
    { id: 'br_e', from: { x: g(1), z: 0 }, to: { x: g(2), z: 0 } },
    { id: 'br_n', from: { x: 0, z: -g(2) }, to: { x: 0, z: -g(1) } },
  ];
  for (const b of BRIDGES) {
    pieces.push(at('skybridge', b.id, b.from, 0,
      { to: b.to, y: CITY.MEZZ, halfWidth: 7, tier: 'road', tagged: false }));
  }
  // A kicker in the middle of each bridge, aimed along it at the far podium.
  BRIDGES.forEach((b, i) => {
    const mx = (b.from.x + b.to.x) / 2, mz = (b.from.z + b.to.z) / 2;
    pieces.push(kicker(`br_up_${i}`, mx, CITY.MEZZ + 0.7, mz, toward(b.from, b.to),
      { length: 17, halfWidth: 6, exitAngle: 0.55 }));
  });

  // ── Roof kickers: the top stratum is a network, not a set of dead ends ──
  // One per tower, on the roof, aimed at a named neighbour. This single list
  // is what turns a skyline into an instrument — without it every roof in the
  // city is somewhere you arrive and never leave.
  const ROOF_LINES = [
    ['tw_nw', 'tw_w'], ['tw_ne', 'spire'], ['tw_w', 'tw_nw'],
    ['tw_e', 'tw_ne'], ['tw_se', 'tw_e'], ['tw_n', 'spire'],
    ['tw_wo', 'tw_w'], ['tw_eo', 'tw_e'],
  ];
  const byId = new Map(TOWERS.map((t) => [t.id, t]));
  byId.set('spire', { id: 'spire', x: 0, z: -g(1), h: CITY.SPIRE, half: 16 });
  ROOF_LINES.forEach(([src, dst], i) => {
    const a = byId.get(src), b = byId.get(dst);
    const yaw = toward(a, b);
    // Set back from the roof's far edge so there is run-up on the roof itself.
    pieces.push(kicker(`roof_${src}`, a.x - Math.sin(yaw) * (a.half - 9), a.h,
      a.z - Math.cos(yaw) * (a.half - 9), yaw,
      { length: 17, halfWidth: 6, exitAngle: 0.50 }));
  });

  // ── Street kickers: how a run starts ────────────────────────────────────
  // Eight, in the avenues, every one aimed at a podium or a bridge. Their job
  // is one stratum: street to mezzanine. Nothing here reaches a roof.
  const ST = [
    { id: 'st_s', x: 0, z: g(2) + 40, at: { x: 0, z: 0 } },
    { id: 'st_n', x: 0, z: -g(2) - 40, at: { x: 0, z: -g(1) } },
    { id: 'st_w', x: -g(2) - 40, z: 0, at: { x: -g(1), z: 0 } },
    { id: 'st_e', x: g(2) + 40, z: 0, at: { x: g(1), z: 0 } },
    { id: 'st_sw', x: -g(1), z: g(2) + 12, at: { x: -g(1), z: g(1) } },
    { id: 'st_se', x: g(1), z: g(2) + 12, at: { x: g(1), z: g(1) } },
    { id: 'st_nw', x: -g(2) - 12, z: -g(1), at: { x: -g(1), z: -g(1) } },
    { id: 'st_ne', x: g(2) + 12, z: -g(1), at: { x: g(1), z: -g(1) } },
  ];
  for (const s of ST) {
    pieces.push(kicker(s.id, s.x, 0, s.z, toward(s, s.at),
      { length: 22, halfWidth: 7, exitAngle: 0.54 }));
  }

  // ── Billboards: the only bright objects, and they sit on the lines ──────
  // Sited from the measurement, not by eye. The analyzer knows where every
  // descending arc in the city crosses billboard altitude; these are the five
  // busiest of those corridors, so a roof-to-roof flight has a sign in it
  // whether or not the player meant to take one. Placing them by eye put four
  // of five somewhere no launch in the sweep could reach — prizes behind
  // glass, which is the failure the old city made everywhere.
  const BB = [
    { id: 'bb_s', x: 0, z: 140, y: 25 },      // the spire -> stack line
    { id: 'bb_se', x: g(1), z: 104, y: 25 },
    { id: 'bb_nw', x: -102, z: -g(1), y: 23 },
    { id: 'bb_ne', x: 102, z: -g(1), y: 23 },
    { id: 'bb_n', x: 0, z: -166, y: 26 },    // the northern approach
  ];
  BB.forEach((b, n) => {
    pieces.push(at('billboard', b.id, { x: b.x, z: b.z }, 0, {
      legId: `bbleg_${n}`, legY: b.y / 2, legHalf: { x: 1.2, y: b.y / 2, z: 1.2 },
      panelY: b.y + 0.4, panelHalf: { x: 12, y: 0.4, z: 4.5 },
      aimY: b.y + 0.8, targetHalf: { x: 12, y: 2.5, z: 4.5 }, tagged: true,
    }));
  });

  // ── The secret: the mast, x5, and only the spire can reach it ───────────
  // Due east of the spire at very nearly its own height, so the only launch
  // in the city that arrives is the one off the top of the skyscraper, flown
  // almost flat. A secret nothing can reach is not a secret.
  pieces.push(at('mast', 'mast', { x: 136, z: -g(1) }, 0, {
    legId: 'mast_leg', legY: 25, legHalf: { x: 1.5, y: 25, z: 1.5 },
    topId: 'mast_top', topY: 50.3, topHalf: { x: 4.6, z: 4.6 },
    aimY: 50.7, targetHalf: { x: 4.6, y: 2.5, z: 4.6 },
  }));

  // ── The viaduct the train runs on ───────────────────────────────────────
  // It takes the eastern avenue, and that avenue therefore carries no traffic
  // — a rail corridor is not also a street, and lane cars are kinematic, so
  // they would have driven straight through the piers.
  const vspan = g(2) + 150;
  const RAIL_X = 108;
  // A deck on piers, not a wall: the piers stand on block centres so the
  // east-west avenues pass underneath, and a solid kerb-to-sky slab would
  // have dammed every one of them.
  pieces.push(at('slab', 'viaduct', { x: RAIL_X, y: 14.6, z: 0 }, 0,
    { half: { x: 4, y: 0.8, z: vspan }, kind: 'roof' }));
  for (let k = -3; k <= 3; k++) {
    pieces.push(at('slab', `vpier_${k + 3}`, { x: RAIL_X, y: 6.9, z: k * P }, 0,
      { half: { x: 2.6, y: 6.9, z: 2.6 }, kind: 'leg' }));
  }

  // ── Coin lines: the authored routes through the dark (AFTERGLOW) ────────
  // Three, and each one is a *stratum transition* drawn in light: the way up
  // off the street, the way from the mezzanine to the roofs, and the spire
  // line the acceptance clip flies.
  pieces.push(at('coinArc', 'coins_up', { x: 0, z: g(2) }, 0, {
    from: { x: 0, y: 9, z: g(2) + 18 }, to: { x: 0, y: CITY.MEZZ + 2, z: 30 },
    apexY: 9, n: 10,
  }));
  pieces.push(at('coinArc', 'coins_mezz', { x: -g(1), z: -30 }, 0, {
    from: { x: -g(1), y: CITY.MEZZ + 8, z: -18 }, to: { x: -g(1), y: 32, z: -g(1) + 14 },
    apexY: 8, n: 9,
  }));
  pieces.push(at('coinArc', 'coins_spire', { x: 0, z: -g(1) + 24 }, 0, {
    from: { x: 0, y: CITY.SPIRE + 3, z: -g(1) + 24 }, to: { x: 0, y: 29, z: stackZ - 18 },
    apexY: 7, n: 14,
  }));

  // ── Streets (§4: traffic is an ingredient of this arena, not the economy) ─
  const span = g(2) + 190;
  const AVE = [-g(2) + P / 2, -P / 2, P / 2, g(2) - P / 2];
  const AVE_X = AVE.filter((x) => x !== RAIL_X);
  for (let i = 0; i < AVE_X.length; i++) {
    const x = AVE_X[i];
    pieces.push(at('lane', `st_${i}_a`, { x: x - 5, z: span }, 0,
      { from: { x: x - 5, z: span }, to: { x: x - 5, z: -span }, oncoming: false }));
    pieces.push(at('lane', `st_${i}_b`, { x: x + 5, z: -span }, 0,
      { from: { x: x + 5, z: -span }, to: { x: x + 5, z: span }, oncoming: true }));
  }
  for (let j = 0; j < AVE.length; j++) {
    const z = AVE[j];
    pieces.push(at('lane', `av_${j}_a`, { x: -span, z: z - 5 }, 0,
      { from: { x: -span, z: z - 5 }, to: { x: span, z: z - 5 }, oncoming: false }));
    pieces.push(at('lane', `av_${j}_b`, { x: span, z: z + 5 }, 0,
      { from: { x: span, z: z + 5 }, to: { x: -span, z: z + 5 }, oncoming: true }));
  }

  // ── §6.2 moving targets ─────────────────────────────────────────────────
  pieces.push(at('mover', 'train', { x: RAIL_X, z: 0 }, 0, {
    kind: 'train', tier: 'moving',
    half: { x: 2.4, y: 1.9, z: 9.5 }, cars: 5, gap: 21,
    y: 17.3, speed: 17,
    from: { x: RAIL_X, z: vspan }, to: { x: RAIL_X, z: -vspan },
    loop: 'wrap',
  }));
  // The helicopter sits *in the acceptance clip's flight path*: its first two
  // stations straddle the spire -> stack corridor at 36 m, which is the height
  // that line passes through. The near-miss is authored, not hoped for.
  pieces.push(at('mover', 'heli', { x: 0, z: -12 }, 0, {
    kind: 'heli', tier: 'secret',
    half: { x: 3.2, y: 0.4, z: 3.2 },
    hold: 30, y: 36,
    stations: [
      { x: 0, z: -12 }, { x: 0, z: g(1) - 16 },
      { x: -g(1), z: -g(1) }, { x: g(1), z: g(1) },
    ],
  }));
  pieces.push(at('mover', 'billboard', { x: -g(2) + 8, z: g(1) }, 0, {
    kind: 'billboard', tier: 'billboard',
    half: { x: 9, y: 0.4, z: 3.4 }, y: 23,
    spin: 0.42,
    at: { x: -g(2) + 8, z: g(1) },
  }));

  return {
    id: 'city',
    name: 'VERTICAL CITY',
    lot: {
      ground: 900,
      // Straight down the southern avenue into `st_s` — the city's hero
      // run-up, and the first thing it teaches: the street is where you buy
      // the altitude you are about to spend.
      spawn: { x: 0, y: 1.08, z: g(2) + 150 },
      coinPrefix: 'ccoin_',
    },
    pieces,
  };
}

export function describeCity() {
  return expandPieces(describeCityPieces());
}
