/**
 * Arena 5 — SKYLINE (R10).
 *
 * **Skyline has no ground.** Everything worth being on is between forty and
 * ninety metres up, the deck is a long way below, and there is exactly one way
 * back: a spiral you drive, at the far edge, that costs you most of a round.
 * So a missed landing is not a crash and a restart — it is a *demotion*, and
 * the whole arena is about refusing to take it.
 *
 * That is the inverse of Floodway, deliberately. Floodway's geometry forgives
 * a bad line and punishes a slow one: the walls return you, the flow gives you
 * speed you did not earn. Skyline's geometry forgives nothing and asks for
 * nothing — the pads are small, the gaps are real, and there is no bank, no
 * wall, no catcher and no second chance anywhere in it. The Yard returns you
 * to the middle; Vertical City drops you a storey; Skyline drops you out of
 * the arena.
 *
 * Two rules kept it from being merely cruel:
 *
 * - **Every pad is reachable from three others.** A commitment arena where a
 *   line has one continuation is not commitment, it is a corridor. The whole
 *   difficulty has to live in the *gap*, never in the routing.
 * - **The pads are stepped.** Heights descend outward, so the natural failure
 *   is landing on a lower pad rather than on nothing. You lose altitude, which
 *   here is the only currency there is.
 *
 * The spans are the mercy: skybridges between some pads, at deck height for
 * the arena, which you can drive rather than jump. They are also the slow way,
 * and slow is what this arena charges for.
 */

import { expandPieces } from './pieces.js';

export const SKY = {
  PITCH: 80,             // pad spacing — a committed hop, above the easy 76
  DECK: 44,              // the lowest pad, and the height of the spans
  PEAK: 92,              // the summit
};

const g = (n) => n * SKY.PITCH;
const at = (piece, id, pos, yaw, params = {}) => ({ piece, id, pos, yaw, params });
const toward = (from, to) => Math.atan2(from.x - to.x, from.z - to.z);

const kicker = (id, x, y, z, yaw, p = {}) =>
  at('kicker', id, { x, y, z }, yaw,
    { length: p.length ?? 18, halfWidth: p.halfWidth ?? 6,
      exitAngle: p.exitAngle ?? 0.50, lipFrac: p.lipFrac ?? 0.40 });

/**
 * The pads. Heights step down from the middle so that overshooting lands you
 * lower rather than nowhere, and no two neighbours match — a hop is always a
 * climb or a drop and the player has to know which before they leave.
 */
const PADS = [
  { id: 'pad_c', x: 0, z: 0, h: 76, r: 17 },
  { id: 'pad_n', x: 0, z: -g(1), h: 68, r: 15 },
  { id: 'pad_s', x: 0, z: g(1), h: 62, r: 16 },
  { id: 'pad_w', x: -g(1), z: 0, h: 70, r: 15 },
  { id: 'pad_e', x: g(1), z: 0, h: 58, r: 16 },
  { id: 'pad_nw', x: -g(1), z: -g(1), h: 56, r: 14 },
  { id: 'pad_ne', x: g(1), z: -g(1), h: 64, r: 14 },
  { id: 'pad_sw', x: -g(1), z: g(1), h: 52, r: 15 },
  { id: 'pad_se', x: g(1), z: g(1), h: 60, r: 14 },
  { id: 'pad_no', x: 0, z: -g(2), h: 48, r: 18 },
  { id: 'pad_so', x: 0, z: g(2), h: 46, r: 18 },
  { id: 'pad_wo', x: -g(2), z: 0, h: SKY.DECK, r: 18 },
  { id: 'pad_eo', x: g(2), z: 0, h: 50, r: 18 },
];

export function describeSkyPieces() {
  const pieces = [];
  const byId = new Map(PADS.map((p) => [p.id, p]));

  // ── The pads ────────────────────────────────────────────────────────────
  for (const p of PADS) {
    pieces.push(at('tower', p.id, { x: p.x, z: p.z }, 0, {
      half: { x: p.r, z: p.r }, height: p.h, tier: 'rooftop', tagged: p.h >= 60,
    }));
  }

  // ── THE PEAK: the summit, and the only thing above everything ───────────
  pieces.push(at('tower', 'peak', { x: -g(1), z: -g(2) }, 0, {
    half: { x: 15, z: 15 }, height: SKY.PEAK, tier: 'rooftop', tagged: true,
    targetHalfY: 4,
  }));
  // No cardinal roll-offs. Every other pad in the arena launches at a *named*
  // neighbour, and the peak is ninety-two metres up — four roll-offs firing
  // at the compass sent two of them clean out of the arena, and `npm run
  // lines` called them deck-only ramps. The peak gets its three aimed
  // kickers from the same table as everything else.

  // ── Pad kickers: three a pad, so every landing has three continuations ──
  // A commitment arena where a line has one exit is a corridor. The gaps are
  // where the difficulty lives; the routing has to stay open.
  const LINES = {
    pad_c: ['pad_n', 'pad_w', 'pad_s'],
    pad_n: ['pad_c', 'pad_nw', 'pad_ne'],
    pad_s: ['pad_c', 'pad_sw', 'pad_se'],
    pad_w: ['pad_c', 'pad_nw', 'pad_sw'],
    pad_e: ['pad_c', 'pad_ne', 'pad_se'],
    pad_nw: ['pad_n', 'pad_w', 'peak'],
    pad_ne: ['pad_n', 'pad_e', 'pad_c'],
    pad_sw: ['pad_s', 'pad_w', 'pad_so'],
    pad_se: ['pad_s', 'pad_e', 'pad_eo'],
    pad_no: ['pad_n', 'pad_ne', 'peak'],
    pad_so: ['pad_s', 'pad_sw', 'pad_se'],
    pad_wo: ['pad_w', 'pad_nw', 'pad_sw'],
    pad_eo: ['pad_e', 'pad_ne', 'pad_se'],
    peak: ['pad_nw', 'pad_no', 'pad_n'],
  };
  byId.set('peak', { id: 'peak', x: -g(1), z: -g(2), h: SKY.PEAK, r: 15 });
  for (const [src, dsts] of Object.entries(LINES)) {
    const a = byId.get(src);
    dsts.forEach((dst, k) => {
      const b = byId.get(dst);
      const yaw = toward(a, b);
      const back = a.r - 5;
      pieces.push(kicker(`up_${src}_${k}`,
        a.x - Math.sin(yaw) * back, a.h, a.z - Math.cos(yaw) * back, yaw,
        { length: 16, halfWidth: 5.5, exitAngle: 0.50 }));
    });
  }

  // ── Spans: the mercy, and the slow way ──────────────────────────────────
  // Drive them instead of jumping. They are also how a demoted run gets back
  // into the arena without flying anything.
  const SPANS = [
    { id: 'span_n', from: { x: 0, z: -g(2) }, to: { x: 0, z: -g(1) } },
    { id: 'span_s', from: { x: 0, z: g(1) }, to: { x: 0, z: g(2) } },
    { id: 'span_w', from: { x: -g(2), z: 0 }, to: { x: -g(1), z: 0 } },
    { id: 'span_e', from: { x: g(1), z: 0 }, to: { x: g(2), z: 0 } },
  ];
  for (const b of SPANS) {
    pieces.push(at('skybridge', b.id, b.from, 0,
      { to: b.to, y: SKY.DECK, halfWidth: 7, tier: 'road' }));
  }

  // ── THE CLIMB: the one way back, and it costs ───────────────────────────
  // A spiral you drive, from the deck to the lowest pad. Nothing else in the
  // arena touches the ground, which is the point: falling is not a crash, it
  // is a demotion, and this is the price of undoing one.
  const climb = { x: -g(2), z: g(2) };
  const CLIMB = { radius: 32, y0: 0, rise: SKY.DECK / 20, segments: 20,
                  startAngle: Math.PI / 2, arc: Math.PI / 10, halfWidth: 6 };
  pieces.push(at('helix', 'climb', climb, 0, CLIMB));
  const climbAt = (i) => {
    const a = CLIMB.startAngle + i * CLIMB.arc;
    return { x: climb.x + Math.sin(a) * CLIMB.radius, z: climb.z + Math.cos(a) * CLIMB.radius };
  };
  {
    const exit = climbAt(CLIMB.segments), prev = climbAt(CLIMB.segments - 1);
    const ex = exit.x - prev.x, ez = exit.z - prev.z;
    const el = Math.hypot(ex, ez);
    const outYaw = Math.atan2(-ex / el, -ez / el);
    pieces.push(kicker('climb_out',
      exit.x + Math.sin(outYaw) * 10, CLIMB.y0 + CLIMB.segments * CLIMB.rise,
      exit.z + Math.cos(outYaw) * 10, outYaw,
      { length: 20, halfWidth: 6.5, exitAngle: 0.50 }));
  }

  // ── Anchors: the x5, on the one line that reaches it ────────────────────
  pieces.push(at('mast', 'anchor', { x: g(1), z: -g(2) }, 0, {
    legId: 'anchor_leg', legY: 34, legHalf: { x: 1.6, y: 34, z: 1.6 },
    topId: 'anchor_top', topY: 68.3, topHalf: { x: 5, z: 5 },
    aimY: 68.7, targetHalf: { x: 5, y: 2.5, z: 5 },
  }));

  // ── Billboards, sited on the lines between pads ─────────────────────────
  // Sited from the measurement — the busiest corridors where descending arcs
  // actually cross sign height. Placed on the straight lines between pads
  // they were three tagged targets nothing could land on.
  const BB = [
    { id: 'bb_sw', x: -79, z: 79, y: 57 },
    { id: 'bb_w', x: -113, z: 46, y: 51 },
    { id: 'bb_s', x: 45, z: 115, y: 53 },
  ];
  BB.forEach((b, n) => {
    pieces.push(at('billboard', b.id, { x: b.x, z: b.z }, 0, {
      legId: `bbleg_${n}`, legY: b.y / 2, legHalf: { x: 1.2, y: b.y / 2, z: 1.2 },
      panelY: b.y + 0.4, panelHalf: { x: 11, y: 0.4, z: 4.2 },
      aimY: b.y + 0.8, targetHalf: { x: 11, y: 2.5, z: 4.2 }, tagged: true,
    }));
  });

  // ── The wire: a moving pad, because a gap that also moves is the arena's
  //    hardest question ────────────────────────────────────────────────────
  pieces.push(at('mover', 'cable', { x: g(1), z: g(1) }, 0, {
    kind: 'heli', tier: 'secret',
    half: { x: 4.5, y: 0.5, z: 4.5 },
    hold: 26, y: 66,
    stations: [
      { x: g(1), z: g(1) }, { x: -g(1), z: g(1) },
      { x: g(1), z: -g(1) }, { x: 0, z: 0 },
    ],
  }));

  // ── The coin line: the drop off the peak ────────────────────────────────
  pieces.push(at('coinArc', 'coins_peak', { x: -g(1), z: -g(2) }, 0, {
    from: { x: -g(1), y: SKY.PEAK + 4, z: -g(2) + 24 },
    to: { x: -g(1), y: 58, z: -g(1) - 10 },
    apexY: 8, n: 12,
  }));

  return {
    id: 'sky',
    name: 'SKYLINE',
    lot: {
      ground: 900,
      // On the deck at the foot of the climb. The arena's first lesson is the
      // one it will keep teaching: getting up there is the expensive part.
      spawn: { x: -g(2), y: 1.08, z: g(2) + 92 },
      coinPrefix: 'scoin_',
    },
    pieces,
  };
}

export function describeSky() {
  return expandPieces(describeSkyPieces());
}
