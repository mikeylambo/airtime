/**
 * Arena 3 — MEGA WORKS (R10).
 *
 * Every arena has to teach a routing idea the others do not, or it does not
 * ship. The Yard is centripetal — rings pointing inward, and the job is
 * finding ways back out. Vertical City is stratified — the centre is a pit
 * and altitude is the currency.
 *
 * **Mega Works routes in time.** Its best surfaces move: a gantry crane's jib
 * swings, a container skip runs a rail, a conveyor deck crosses the yard on a
 * cycle. So the reachability graph is not a fixed thing you memorise, it is a
 * thing that *opens and closes*, and the skill is leaving a ramp at the moment
 * the arrival will be somewhere. Neither of the first two arenas asks that of
 * anybody: The Yard's tower is where it always was, and the City's roofs do
 * not go anywhere.
 *
 * The static half is built to make the timing legible rather than to be
 * interesting on its own — container stacks at three heights on a 76 m pitch,
 * every one of them reachable, so a mistimed launch is a landing on a
 * container rather than a landing on the floor. Missing a moving target should
 * cost you the shot, never the run.
 *
 * The giant drop the roster asks for is the **hopper**: a launch off the top
 * of the plant at 54 m, which is the highest static surface in the game and
 * the only one that outranges the spire.
 */

import { expandPieces } from './pieces.js';

export const WORKS = {
  P: 76,                 // pitch — one comfortable hop at 44 m/s
  DECK: 13,              // the low gantry / catwalk level
  STACK: 26,             // container stack tops
  CRANE: 38,             // the jibs
  HOPPER: 54,            // the plant, and the giant drop
};

const g = (n) => n * WORKS.P;
const at = (piece, id, pos, yaw, params = {}) => ({ piece, id, pos, yaw, params });
const toward = (from, to) => Math.atan2(from.x - to.x, from.z - to.z);

const kicker = (id, x, y, z, yaw, p = {}) =>
  at('kicker', id, { x, y, z }, yaw,
    { length: p.length ?? 20, halfWidth: p.halfWidth ?? 6.5,
      exitAngle: p.exitAngle ?? 0.52, lipFrac: p.lipFrac ?? 0.40 });

export function describeWorksPieces() {
  const pieces = [];

  // ── Container stacks: the static floor of the routing graph ─────────────
  // Three heights, and no two neighbours the same, so a hop between them is
  // always a climb or a drop. These are the safety net — every mistimed
  // launch at a moving target lands on one of these instead of the concrete.
  const STACKS = [
    { id: 'st_nw', x: -g(1), z: -g(1), h: 26, hx: 20, hz: 14 },
    { id: 'st_n', x: 0, z: -g(1), h: 18, hx: 16, hz: 16 },
    { id: 'st_ne', x: g(1), z: -g(1), h: 30, hx: 20, hz: 14 },
    { id: 'st_w', x: -g(1), z: 0, h: 22, hx: 14, hz: 20 },
    { id: 'st_e', x: g(1), z: 0, h: 30, hx: 14, hz: 20 },
    { id: 'st_sw', x: -g(1), z: g(1), h: 30, hx: 20, hz: 14 },
    { id: 'st_s', x: 0, z: g(1), h: 22, hx: 18, hz: 14 },
    { id: 'st_se', x: g(1), z: g(1), h: 18, hx: 20, hz: 14 },
    { id: 'st_wo', x: -g(2), z: -g(1) / 2, h: 26, hx: 15, hz: 18 },
    { id: 'st_eo', x: g(2), z: g(1) / 2, h: 26, hx: 15, hz: 18 },
  ];
  for (const t of STACKS) {
    pieces.push(at('tower', t.id, { x: t.x, z: t.z }, 0, {
      half: { x: t.hx, z: t.hz }, height: t.h, tier: 'rooftop', tagged: t.h >= 26,
    }));
  }

  // ── THE PLANT: the giant drop ───────────────────────────────────────────
  // Fifty-four metres, the tallest static surface in the game. Its four
  // roll-offs are the only launches in the arena that reach the far side of
  // it, which is what makes the plant worth climbing to rather than a view.
  pieces.push(at('tower', 'hopper', { x: 0, z: 0 }, 0, {
    half: { x: 18, z: 18 }, height: WORKS.HOPPER, tier: 'rooftop', tagged: true,
    targetHalfY: 4,
  }));
  [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([dx, dz], i) => {
    pieces.push(at('wedge', `hop_off_${i}`, { x: dx * 25, y: WORKS.HOPPER, z: dz * 25 },
      Math.atan2(-dx, -dz), { height: 5.6, length: 24, halfWidth: 8 }));
  });

  // ── Gantry cranes: narrow jibs, thirty-eight metres up ──────────────────
  // Two of them cross the yard on each axis. A jib is six metres wide and has
  // nothing under it, which is the whole appeal.
  const CRANES = [
    { id: 'cr_n', x: 0, z: -g(2), alongZ: false, span: 34 },
    { id: 'cr_s', x: 0, z: g(2), alongZ: false, span: 34 },
    { id: 'cr_w', x: -g(2), z: 0, alongZ: true, span: 34 },
    { id: 'cr_e', x: g(2), z: 0, alongZ: true, span: 34 },
  ];
  for (const c of CRANES) {
    pieces.push(at('crane', c.id, { x: c.x, z: c.z }, 0, {
      height: WORKS.CRANE, span: c.span, alongZ: c.alongZ, halfWidth: 6,
    }));
    // A kicker on the jib, aimed at the plant. Every crane feeds the middle.
    pieces.push(kicker(`cr_up_${c.id}`, c.x, WORKS.CRANE + 0.7, c.z,
      toward({ x: c.x, z: c.z }, { x: 0, z: 0 }),
      { length: 16, halfWidth: 5, exitAngle: 0.50 }));
  }

  // ── Catwalks: the mezzanine, and how the yard is crossed on foot ────────
  const WALKS = [
    { id: 'cw_n', from: { x: 0, z: -g(2) }, to: { x: 0, z: -g(1) } },
    { id: 'cw_s', from: { x: 0, z: g(1) }, to: { x: 0, z: g(2) } },
    { id: 'cw_w', from: { x: -g(2), z: 0 }, to: { x: -g(1), z: 0 } },
    { id: 'cw_e', from: { x: g(1), z: 0 }, to: { x: g(2), z: 0 } },
  ];
  WALKS.forEach((b, i) => {
    pieces.push(at('skybridge', b.id, b.from, 0,
      { to: b.to, y: WORKS.DECK, halfWidth: 8, tier: 'road' }));
    const mx = (b.from.x + b.to.x) / 2, mz = (b.from.z + b.to.z) / 2;
    pieces.push(kicker(`cw_up_${i}`, mx, WORKS.DECK + 0.7, mz, toward(b.from, b.to),
      { length: 18, halfWidth: 7, exitAngle: 0.55 }));
  });

  // ── Roof kickers: every stack top is a launch, not a dead end ───────────
  const ROOF_LINES = [
    // Two of these aim *outward* at the far stacks. With every line pointing
    // at the middle the outer pair were tagged targets nothing could reach.
    ['st_nw', 'st_wo'], ['st_n', 'hopper'], ['st_ne', 'st_e'],
    ['st_w', 'st_nw'], ['st_e', 'st_ne'], ['st_sw', 'st_w'],
    ['st_s', 'hopper'], ['st_se', 'st_eo'], ['st_wo', 'st_w'], ['st_eo', 'st_e'],
  ];
  const byId = new Map(STACKS.map((t) => [t.id, t]));
  byId.set('hopper', { id: 'hopper', x: 0, z: 0, h: WORKS.HOPPER, hx: 18, hz: 18 });

  // Outward launches off the corner stacks. Without these the outer ring is
  // decoration: `npm run lines` found `yd_sw` an orphan and the two outer
  // stacks unreachable, because every launch in the arena pointed at the
  // middle. An arena where nothing ever aims out is a funnel, not a network.
  // Aimed at the loading aprons, not at the corners of the lot: the first
  // version fired at bare ground a hundred metres past everything and all
  // four came back as deck-only ramps.
  const OUT = [
    ['st_nw', { x: -g(1), z: -150 }], ['st_ne', { x: g(1), z: -150 }],
    ['st_sw', { x: -g(1), z: 150 }], ['st_se', { x: g(1), z: 150 }],
  ];
  for (const [src, aim] of OUT) {
    const a = byId.get(src);
    const yaw = toward(a, aim);
    const back = Math.min(a.hx, a.hz) - 6;
    pieces.push(kicker(`roofout_${src}`,
      a.x - Math.sin(yaw) * back, a.h, a.z - Math.cos(yaw) * back, yaw,
      { length: 17, halfWidth: 6, exitAngle: 0.52 }));
  }

  for (const [src, dst] of ROOF_LINES) {
    const a = byId.get(src), b = byId.get(dst);
    const yaw = toward(a, b);
    const back = Math.min(a.hx, a.hz) - 6;
    pieces.push(kicker(`roof_${src}`,
      a.x - Math.sin(yaw) * back, a.h, a.z - Math.cos(yaw) * back, yaw,
      { length: 17, halfWidth: 6, exitAngle: 0.50 }));
  }

  // ── Loading aprons: where the outward launches land ────────────────────
  // Low, wide catchers beside the corner ramps. They are what makes the outer
  // ring part of the arena rather than a wall — land on one and the ground
  // kicker beside it is the next launch.
  for (const [ax, az, id] of [[-g(1), -150, 'ap_nw'], [g(1), -150, 'ap_ne'],
                              [-g(1), 150, 'ap_sw'], [g(1), 150, 'ap_se']]) {
    pieces.push(at('tower', id, { x: ax, z: az }, 0, {
      half: { x: 19, z: 15 }, height: 6, tier: 'rooftop', tagged: false,
    }));
  }

  // ── Ground kickers: how a run starts ────────────────────────────────────
  const GROUND = [
    { id: 'yd_s', x: 0, z: g(2) + 46, at: { x: 0, z: g(1) } },
    { id: 'yd_n', x: 0, z: -g(2) - 46, at: { x: 0, z: -g(1) } },
    { id: 'yd_w', x: -g(2) - 46, z: 0, at: { x: -g(1), z: 0 } },
    { id: 'yd_e', x: g(2) + 46, z: 0, at: { x: g(1), z: 0 } },
    { id: 'yd_sw', x: -g(1), z: g(2) + 20, at: { x: -g(1), z: g(1) } },
    { id: 'yd_se', x: g(1), z: g(2) + 20, at: { x: g(1), z: g(1) } },
    { id: 'yd_nw', x: -g(1), z: -g(2) - 20, at: { x: -g(1), z: -g(1) } },
    { id: 'yd_ne', x: g(1), z: -g(2) - 20, at: { x: g(1), z: -g(1) } },
  ];
  for (const k of GROUND) {
    pieces.push(kicker(k.id, k.x, 0, k.z, toward(k, k.at),
      { length: 22, halfWidth: 7, exitAngle: 0.54 }));
  }

  // ── Pipes: the industrial quarter pipes, on the diagonals ───────────────
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
    const r = g(2) - 10;
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    pieces.push(at('quarterpipe', `pipe_${i}`, { x, z }, Math.atan2(x, z) + Math.PI,
      { radius: 12, halfWidth: 18 }));
  }

  // ── The machinery: this is what the arena is *for* ──────────────────────
  // Three movers, all landing targets, all on cycles a player can learn. The
  // skip runs the long rail; the swinging jib relocates on a hold like the
  // city's helicopter; the conveyor deck crosses the yard face-up and face-
  // down, so it only pays half the time.
  const rail = g(2) + 130;
  pieces.push(at('mover', 'skip', { x: -g(1) / 2, z: 0 }, 0, {
    kind: 'train', tier: 'moving',
    half: { x: 4.5, y: 2.2, z: 11 }, cars: 3, gap: 34,
    y: WORKS.DECK + 3.4, speed: 21,
    from: { x: -g(1) / 2, z: rail }, to: { x: -g(1) / 2, z: -rail },
    loop: 'wrap',
  }));
  pieces.push(at('mover', 'jib', { x: g(1), z: -g(1) }, 0, {
    kind: 'heli', tier: 'secret',
    half: { x: 5.5, y: 0.6, z: 5.5 },
    hold: 24, y: WORKS.CRANE + 6,
    stations: [
      { x: g(1), z: -g(1) }, { x: -g(1), z: g(1) },
      { x: g(1), z: g(1) }, { x: -g(1), z: -g(1) },
    ],
  }));
  pieces.push(at('mover', 'conveyor', { x: g(1) / 2, z: -g(1) / 2 }, 0, {
    kind: 'billboard', tier: 'billboard',
    half: { x: 11, y: 0.5, z: 4.5 }, y: WORKS.STACK + 2,
    spin: 0.34,
    at: { x: g(1) / 2, z: -g(1) / 2 },
  }));

  // ── Coin lines: the two transitions worth drawing in light ──────────────
  pieces.push(at('coinArc', 'coins_up', { x: 0, z: g(2) }, 0, {
    from: { x: 0, y: 9, z: g(2) + 24 }, to: { x: 0, y: WORKS.DECK + 3, z: g(1) + 20 },
    apexY: 9, n: 9,
  }));
  pieces.push(at('coinArc', 'coins_crane', { x: 0, z: -g(2) }, 0, {
    from: { x: 0, y: WORKS.CRANE + 9, z: -g(2) + 14 }, to: { x: 0, y: WORKS.HOPPER, z: 26 },
    apexY: 8, n: 12,
  }));

  // ── Street furniture (R7) ───────────────────────────────────────────────
  // A working yard is full of things a car should be able to destroy. They
  // are filtered against the geometry below, the same as the city's.
  for (const [x, z] of [[-g(1) / 2, g(1)], [g(1) / 2, -g(1)], [-g(2) + 20, g(1)]]) {
    pieces.push(at('propLine', `drum_${x}_${z}`, { x, z }, 0, {
      to: { x: x + 40, z }, n: 8, kind: 'crate',
      half: { x: 1.2, y: 1.2, z: 1.2 }, mass: 34,
    }));
  }

  return {
    id: 'works',
    name: 'MEGA WORKS',
    lot: {
      ground: 900,
      spawn: { x: 0, y: 1.08, z: g(2) + 120 },
      coinPrefix: 'wcoin_',
    },
    pieces,
  };
}

/** Nothing stands inside a solid — the same filter Vertical City uses. */
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

export function describeWorks() {
  const arena = expandPieces(describeWorksPieces());
  arena.props = arena.props.filter((p) => standingClear(p, arena));
  return arena;
}
