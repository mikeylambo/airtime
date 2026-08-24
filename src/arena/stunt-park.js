/**
 * Arena 1 — the stunt park, gray box (§10a).
 *
 * "Abstract Rush-style ramps/gaps/pipes, built first as a lit gray box so the
 * camera gates in week one." Authored as plain data: src/sim builds Rapier
 * colliders from it, src/render builds meshes from the same records, and the
 * camera director reads the target list. Nothing is described twice.
 *
 * Content slots (§10): 15–25 ramps, 8–12 tagged landing targets.
 */

import { rampMesh, rampSlabs, rampSurface, rampLipHeight, rampExitAngle } from './ramp-geometry.js';
import TUNING from '../TUNING.js';

const TUNING_GROUND = TUNING.ARENA.GROUND_SIZE;
const SPAWN = TUNING.ARENA.SPAWN;

// §3.1 target tier multipliers. Carried on the target records now so the
// scoring pass (item 5) has nothing left to author.
export const TIER = {
  road:      { mult: 1.0, label: 'ROAD' },
  rooftop:   { mult: 1.5, label: 'ROOFTOP' },
  billboard: { mult: 2.0, label: 'BILLBOARD' },
  moving:    { mult: 3.0, label: 'MOVING' },
  pool:      { mult: 3.0, label: 'POOL' },
  secret:    { mult: 5.0, label: 'SECRET' },
};

// The hero line runs down −Z from the spawn. These three numbers set the whole
// Gate A jump; everything downrange is placed relative to them.
export const HERO = {
  RAMP_Z: 22,            // centre of the hero kicker
  RAMP_LENGTH: 26,
  RAMP_EXIT: 0.5236,     // 30 degrees at the lip
  RAMP_LIP_FRAC: 0.42,   // the last 42% is straight, so the car leaves flat
  RAMP_HALF_WIDTH: 7,
  get LIP_Z() { return this.RAMP_Z - this.RAMP_LENGTH / 2; },
};

// Measured from the headless sim (tools/measure-jump.mjs): a full-boost run-up
// off the hero kicker puts the car down around here.
// Measured with tools/arc.mjs. The hero arc crosses y=9 m at z=-135 after
// 2.8 s, so the landing hill's crest sits at z=-130 and it falls away at 27deg
// — close enough to the arc's own 33deg descent that the car meets it almost
// tangentially. Landing flat-out onto level deck at 22 m/s vertical bottoms
// the suspension and always reads as a crash; a downslope is how ski jumps,
// MX tracks and Rush itself make a big landing survivable.
// Mutable so tools/hill-sweep.mjs can search it; the committed values are
// what that sweep chose.
export const HILL = {
  crestZ: -128,      // where the top of the hill sits
  height: 8,         // crest height above the deck
  length: 27.9,      // horizontal run from crest to toe => 16 degrees
  halfWidth: 26,
};
/** Wedge centre for a hill whose crest is at HILL.crestZ (yaw PI flips it). */
export const hillPos = () => HILL.crestZ - HILL.length / 2;
export const HERO_ROOF_X = -52;          // the absurd alternative, off the hero line
export const HERO_ROOF_Z = -112;

const ramp = (kind, x, z, opts = {}) => ({
  kind, id: opts.id || `${kind}_${x}_${z}`,
  pos: { x, y: opts.y || 0, z },
  yaw: opts.yaw || 0,
  height: opts.height ?? 4,
  length: opts.length ?? 12,
  halfWidth: opts.halfWidth ?? 5,
  radius: opts.radius ?? 8,
  exitAngle: opts.exitAngle,     // kickers only: launch angle at the lip
  lipFrac: opts.lipFrac,         // kickers only: how much of it is straight
});

const slab = (id, x, y, z, hx, hy, hz, opts = {}) => ({
  id, pos: { x, y, z }, half: { x: hx, y: hy, z: hz }, yaw: opts.yaw || 0,
  kind: opts.kind || 'platform',
});

export function describePark() {
  const ramps = [
    // ── The hero line ──────────────────────────────────────────────────────
    ramp('kicker', 0, HERO.RAMP_Z, {
      id: 'hero', length: HERO.RAMP_LENGTH, halfWidth: HERO.RAMP_HALF_WIDTH,
      exitAngle: HERO.RAMP_EXIT, lipFrac: HERO.RAMP_LIP_FRAC,
    }),
    // Flankers, so the hero ramp is a choice and not a corridor
    ramp('wedge', -30, 34, { id: 'flank_l', height: 4.6, length: 16, halfWidth: 5 }),
    ramp('wedge', 30, 34, { id: 'flank_r', height: 4.6, length: 16, halfWidth: 5 }),

    // ── Quarter pipes: the big-airtime launchers that arm the orbit cam ─────
    ramp('quarterpipe', -76, -10, { id: 'qp_w', radius: 11, halfWidth: 13, yaw: -Math.PI / 2 }),
    ramp('quarterpipe', 76, -10, { id: 'qp_e', radius: 11, halfWidth: 13, yaw: Math.PI / 2 }),
    ramp('quarterpipe', 0, -196, { id: 'qp_catch', radius: 13, halfWidth: 22, yaw: Math.PI }),
    ramp('quarterpipe', -118, 120, { id: 'qp_start', radius: 9, halfWidth: 16, yaw: -Math.PI / 2 }),

    // ── Spine: two wedges back to back ─────────────────────────────────────
    ramp('wedge', -52, 78, { id: 'spine_a', height: 5.2, length: 14, halfWidth: 6 }),
    ramp('wedge', -52, 64, { id: 'spine_b', height: 5.2, length: 14, halfWidth: 6, yaw: Math.PI }),

    // ── Table top: up, across, down ────────────────────────────────────────
    ramp('wedge', 56, 82, { id: 'table_up', height: 3.4, length: 12, halfWidth: 7 }),
    ramp('wedge', 56, 58, { id: 'table_down', height: 3.4, length: 12, halfWidth: 7, yaw: Math.PI }),

    // ── Hips: angled kickers that throw you sideways ───────────────────────
    ramp('kicker', -34, -58, { id: 'hip_l', length: 16, halfWidth: 6, yaw: 0.62, exitAngle: 0.56, lipFrac: 0.35 }),
    ramp('kicker', 34, -58, { id: 'hip_r', length: 16, halfWidth: 6, yaw: -0.62, exitAngle: 0.56, lipFrac: 0.35 }),

    // ── Downrange kickers, for a second hop off the landing ────────────────
    ramp('kicker', -14, -142, { id: 'k_far_l', length: 14, halfWidth: 5, exitAngle: 0.49, lipFrac: 0.35 }),
    ramp('kicker', 14, -142, { id: 'k_far_r', length: 14, halfWidth: 5, exitAngle: 0.49, lipFrac: 0.35 }),

    // ── Return line: get back to the start without a reset ─────────────────
    ramp('wedge', -100, 60, { id: 'ret_l', height: 3.0, length: 12, halfWidth: 6, yaw: Math.PI / 2 }),
    ramp('wedge', 100, 60, { id: 'ret_r', height: 3.0, length: 12, halfWidth: 6, yaw: -Math.PI / 2 }),
    ramp('kicker', 0, -84, { id: 'k_mid', length: 18, halfWidth: 8, exitAngle: 0.59, lipFrac: 0.32 }),

    // The garage ramp (§2.1 live preview). Parked well clear of the park so
    // the fixed preview angle never has another structure in front of it.
    ramp('kicker', -235, 0, { id: 'garage', length: 16, halfWidth: 6, exitAngle: 0.52, lipFrac: 0.40 }),

    // ── The landing hill: yaw PI so it falls away from the jump ────────────
    ramp('wedge', 0, hillPos(), {
      id: 'landing_hero', height: HILL.height, length: HILL.length,
      halfWidth: HILL.halfWidth, yaw: Math.PI,
    }),
  ];

  // ── Structures. `target` marks a landing surface the camera can lock to ───
  const structures = [
    // The high roof the hero arc flies straight over — reachable only by
    // spending a DIVE burst on the way down (§5).
    slab('roof_hero', HERO_ROOF_X, 7.5, HERO_ROOF_Z, 18, 7.5, 15, { kind: 'roof' }),
    slab('roof_hero_lo', 0, 2.2, -60, 15, 2.2, 14, { kind: 'roof' }),

    // Billboard decks — narrow, high, terrifying
    slab('bb_w_leg', -58, 7.5, -96, 1.1, 7.5, 1.1, { kind: 'leg' }),
    slab('bb_w', -58, 15.4, -96, 9, 0.4, 3.4, { kind: 'billboard' }),
    slab('bb_e_leg', 58, 7.5, -96, 1.1, 7.5, 1.1, { kind: 'leg' }),
    slab('bb_e', 58, 15.4, -96, 9, 0.4, 3.4, { kind: 'billboard' }),

    // Rooftops flanking the run
    slab('roof_w', -92, 6.0, -46, 16, 6.0, 16, { kind: 'roof' }),
    slab('roof_e', 92, 6.0, -46, 16, 6.0, 16, { kind: 'roof' }),

    // The pool — a drained basin sitting on the deck (§3.1 pool tier)
    slab('pool_floor', -40, 0.5, -168, 13, 0.5, 13, { kind: 'pool' }),
    slab('pool_w_n', -40, 2.6, -181.5, 13, 2.1, 0.6, { kind: 'poolwall' }),
    slab('pool_w_s', -40, 2.6, -154.5, 13, 2.1, 0.6, { kind: 'poolwall' }),
    slab('pool_w_w', -53.6, 2.6, -168, 0.6, 2.1, 13, { kind: 'poolwall' }),
    slab('pool_w_e', -26.4, 2.6, -168, 0.6, 2.1, 13, { kind: 'poolwall' }),

    // Secret pad — small, high, absurd (§3.1 secret tier ×5)
    slab('secret_leg', 46, 11, -170, 1.4, 11, 1.4, { kind: 'leg' }),
    slab('secret', 46, 22.3, -170, 4.2, 0.35, 4.2, { kind: 'secret' }),
  ];

  // ── Tagged landing targets (§3 absurdity tiers, §6 camera target-lock) ────
  const targets = [
    // The hill is the intended landing, so it pays road tier — §3.1's whole
    // point is that the safe landing is cheap and the absurd one is not.
    { id: 'landing_hero', tier: 'road', aim: { x: 0, y: HILL.height / 2, z: hillPos() }, half: { x: HILL.halfWidth, y: HILL.height, z: HILL.length / 2 }, primary: true },
    { id: 'roof_hero', tier: 'rooftop', aim: { x: HERO_ROOF_X, y: 15.4, z: HERO_ROOF_Z }, half: { x: 18, y: 3, z: 15 } },
    { id: 'roof_hero_lo', tier: 'rooftop', aim: { x: 0, y: 4.4, z: -60 }, half: { x: 15, y: 3, z: 14 } },
    { id: 'bb_w', tier: 'billboard', aim: { x: -58, y: 15.8, z: -96 }, half: { x: 9, y: 2.5, z: 3.4 } },
    { id: 'bb_e', tier: 'billboard', aim: { x: 58, y: 15.8, z: -96 }, half: { x: 9, y: 2.5, z: 3.4 } },
    { id: 'roof_w', tier: 'rooftop', aim: { x: -92, y: 12.0, z: -46 }, half: { x: 16, y: 3, z: 16 } },
    { id: 'roof_e', tier: 'rooftop', aim: { x: 92, y: 12.0, z: -46 }, half: { x: 16, y: 3, z: 16 } },
    { id: 'pool', tier: 'pool', aim: { x: -40, y: 1.0, z: -168 }, half: { x: 13, y: 4, z: 13 } },
    { id: 'secret', tier: 'secret', aim: { x: 46, y: 22.7, z: -170 }, half: { x: 4.2, y: 2.5, z: 4.2 } },
    { id: 'table', tier: 'rooftop', aim: { x: 56, y: 3.4, z: 70 }, half: { x: 7, y: 2, z: 12 } },
    { id: 'qp_catch_deck', tier: 'rooftop', aim: { x: 0, y: 13.2, z: -209 }, half: { x: 22, y: 3, z: 5 } },
  ];

  // Every target in the park is hand-placed, so every one is tagged (§10).
  for (const t of targets) t.tagged = true;
  return {
    id: 'park', ground: TUNING_GROUND, spawn: { ...SPAWN },
    ramps, structures, targets,
    coins: describeCoins(), lanes: describeLanes(), movers: [],
  };
}

/**
 * Coin lines (§3.1). Authored *along* the flight paths the ramps produce, so a
 * player who commits to the line gets paid for the line as well as the trick.
 * Flat score, outside the bank — a crash still loses the bank but keeps these.
 */
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

/**
 * Traffic lanes (§4). Straight segments with a direction; the traffic system
 * walks vehicles along them and wraps.
 *
 * The hero straight is left clear at x=0 so the ramp approach is never a
 * lottery — the lanes flank it. That is the Burnout trade the mode wants:
 * weave out to the lanes for near-miss boost, then line back up for the lip.
 */
export function describeLanes() {
  return [
    { id: 'run_w_out', from: { x: -20, z: 210 }, to: { x: -20, z: -210 }, oncoming: false },
    { id: 'run_w_in',  from: { x: -13, z: -210 }, to: { x: -13, z: 210 }, oncoming: true },
    { id: 'run_e_in',  from: { x: 13, z: 210 }, to: { x: 13, z: -210 }, oncoming: false },
    { id: 'run_e_out', from: { x: 20, z: -210 }, to: { x: 20, z: 210 }, oncoming: true },
    { id: 'cross_n',   from: { x: -230, z: -30 }, to: { x: 230, z: -30 }, oncoming: false },
    { id: 'cross_s',   from: { x: 230, z: 112 }, to: { x: -230, z: 112 }, oncoming: false },
  ];
}

export function describeCoins() {
  const pts = [
    // The hero arc: launch at the lip, apex ~31 m, down onto the hill.
    ...arc({ x: 0, y: 12, z: 8 }, { x: 0, y: 6, z: -136 }, 19, 26),
    // Off the west quarter pipe, over the west rooftop.
    ...arc({ x: -70, y: 12, z: -10 }, { x: -92, y: 13, z: -46 }, 6, 8),
    // Off the east quarter pipe.
    ...arc({ x: 70, y: 12, z: -10 }, { x: 92, y: 13, z: -46 }, 6, 8),
    // The hips, out toward the billboards.
    ...arc({ x: -34, y: 7, z: -66 }, { x: -58, y: 16, z: -96 }, 8, 8),
    ...arc({ x: 34, y: 7, z: -66 }, { x: 58, y: 16, z: -96 }, 8, 8),
    // The mid kicker toward the pool.
    ...arc({ x: 0, y: 8, z: -92 }, { x: -40, y: 2, z: -168 }, 12, 12),
  ];
  return pts.map((p, i) => ({ id: `coin_${i}`, pos: p }));
}

export { rampMesh, rampSlabs, rampSurface, rampLipHeight, rampExitAngle };
