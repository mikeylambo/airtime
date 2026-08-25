/**
 * The line analyzer (R3).
 *
 * "Twenty to thirty individually mundane objects whose interactions create
 * hundreds of lines" is the right target for a stunt park and the hardest thing
 * to judge by eye. So don't judge it by eye.
 *
 * This launches a ballistic arc off every ramp across a spread of entry speeds,
 * integrates it with the same drag-corrected predictor the game uses, casts it
 * against the real collision world, and reports what it lands on. The result is
 * a reachability graph — which turns "is this park an instrument?" into numbers.
 *
 *   node tools/lines.mjs            the current arena
 *   node tools/lines.mjs --city
 *   node tools/lines.mjs --verbose  every edge
 */

import TUNING from '../src/TUNING.js';
import { Sim } from '../src/sim/sim.js';
import { RAPIER, WHEEL_RAY_GROUPS } from '../src/sim/physics.js';
import { rampSurface, rampExitAngle } from '../src/arena/index.js';
import { predictArc } from '../src/sim/airtime.js';

const argv = process.argv.slice(2);
const ARENA = argv.includes('--city') ? 'city' : 'park';
const VERBOSE = argv.includes('--verbose');

const SPEEDS = [28, 38, 48, 58, 68];
const LAUNCHABLE = 0.95;      // steeper than this is a wall ride, not a launch
const CHAIN_RADIUS = 60;      // land this close to a ramp and you can take it

const sim = await Sim.create(null, ARENA);
// Rapier builds its query pipeline during step(), so a world that has never
// stepped answers every raycast with a miss — which reads as "nothing is
// reachable from anywhere" rather than as an error.
sim.world.step();
const park = sim.park;

// Frontal area drag constant, matching the in-game predictor.
const C = TUNING.CAR;
const meanArea = (4 * C.HALF.y * C.HALF.z + 4 * C.HALF.x * C.HALF.z + 4 * C.HALF.x * C.HALF.y) / 3;
const dragK = (0.5 * TUNING.AERO.AIR_DENSITY * meanArea * TUNING.AERO.CHASSIS_CD) / C.MASS;

/** World-space AABB of a ramp, so a landing can be attributed to it. */
function rampBox(r) {
  const s = rampSurface(r);
  const c = Math.cos(r.yaw), sn = Math.sin(r.yaw);
  const pts = [];
  for (const z of [s.zMin, s.zMax]) {
    for (const x of [-r.halfWidth, r.halfWidth]) {
      pts.push({ x: r.pos.x + x * c + z * sn, z: r.pos.z - x * sn + z * c });
    }
  }
  return {
    minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
    minZ: Math.min(...pts.map((p) => p.z)), maxZ: Math.max(...pts.map((p) => p.z)),
    top: s.y(s.zMin),
  };
}

const boxes = new Map(park.ramps.map((r) => [r.id, rampBox(r)]));

/** What did we land on? A structure, a ramp, a tagged target, or the deck. */
function surfaceAt(p) {
  for (const t of park.targets) {
    if (Math.abs(p.x - t.aim.x) <= t.half.x && Math.abs(p.z - t.aim.z) <= t.half.z
        && p.y >= t.aim.y - t.half.y - 2 && p.y <= t.aim.y + t.half.y + 2) {
      return { id: t.id, kind: 'target', tier: t.tier };
    }
  }
  for (const s of park.structures) {
    if (Math.abs(p.x - s.pos.x) <= s.half.x && Math.abs(p.z - s.pos.z) <= s.half.z
        && p.y > s.pos.y) return { id: s.id, kind: 'structure' };
  }
  for (const [id, b] of boxes) {
    if (p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ) {
      return { id, kind: 'ramp' };
    }
  }
  return { id: 'deck', kind: 'deck' };
}

/** Launch state off a ramp: the lip, and the velocity leaving it. */
function launchFrom(r, speed) {
  const s = rampSurface(r);
  const ang = rampExitAngle(r);
  const lipLocal = { y: s.y(s.zMin), z: s.zMin };
  const c = Math.cos(r.yaw), sn = Math.sin(r.yaw);
  const pos = {
    x: r.pos.x + lipLocal.z * sn,
    y: r.pos.y + lipLocal.y + 1.0,
    z: r.pos.z + lipLocal.z * c,
  };
  // A ramp faces -Z in its own frame.
  const dir = { x: -sn, z: -c };
  const horiz = Math.cos(ang) * speed;
  return { pos, vel: { x: dir.x * horiz, y: Math.sin(ang) * speed, z: dir.z * horiz } };
}

// ── Walk every ramp at every speed ─────────────────────────────────────────
const edges = [];
const from = new Map();
const into = new Map();
const launchable = park.ramps.filter((r) => r.id !== 'garage' && rampExitAngle(r) <= LAUNCHABLE);

for (const r of launchable) {
  const hits = new Set();
  for (const speed of SPEEDS) {
    const { pos, vel } = launchFrom(r, speed);
    const arc = predictArc(sim.world, pos, vel, TUNING.SIM.GRAVITY, dragK, 9, 1 / 40);
    if (!arc.point) continue;
    const surf = surfaceAt(arc.point);
    // A ramp you can take next, having landed there.
    const next = launchable.filter((o) => o.id !== r.id
      && Math.hypot(o.pos.x - arc.point.x, o.pos.z - arc.point.z) < CHAIN_RADIUS)
      .map((o) => o.id);
    const e = { from: r.id, speed, airtime: arc.airtime, apex: arc.apexHeight, to: surf, next };
    edges.push(e);
    hits.add(surf.id);
    for (const n of next) {
      if (!into.has(n)) into.set(n, new Set());
      into.get(n).add(r.id);
    }
  }
  from.set(r.id, hits);
}

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`── ${ARENA}: ${launchable.length} launchable ramps, ${park.structures.length} structures, ` +
  `${park.targets.filter((t) => t.tagged !== false).length} tagged targets ──\n`);

if (VERBOSE) {
  for (const e of edges) {
    console.log(`  ${e.from.padEnd(14)} @${String(e.speed).padStart(2)} m/s  ${e.airtime.toFixed(2)}s  ` +
      `apex ${e.apex.toFixed(0).padStart(3)}m  ->  ${e.to.id.padEnd(14)} ` +
      (e.next.length ? `then: ${e.next.join(', ')}` : ''));
  }
  console.log('');
}

const landsOnSomething = [...from.entries()].filter(([, s]) => [...s].some((x) => x !== 'deck'));
const deckOnly = launchable.filter((r) => ![...(from.get(r.id) || [])].some((x) => x !== 'deck'));
const chainable = [...into.entries()].filter(([, s]) => s.size >= 3).map(([id]) => id);
const unreachable = launchable.filter((r) => !into.has(r.id));

// Longest chain of ramps linkable without touching the deck between them.
const adj = new Map(launchable.map((r) => [r.id, new Set()]));
for (const e of edges) for (const n of e.next) adj.get(e.from).add(n);
let longest = [];
const walk = (id, seen) => {
  if (seen.length > longest.length) longest = [...seen];
  if (seen.length > 8) return;
  for (const n of adj.get(id) || []) {
    if (seen.includes(n)) continue;
    walk(n, [...seen, n]);
  }
};
for (const r of launchable) walk(r.id, [r.id]);

const pct = (n) => `${((n / Math.max(1, launchable.length)) * 100).toFixed(0)}%`;
console.log(`ramps that land you somewhere authored   ${landsOnSomething.length}/${launchable.length}  (${pct(landsOnSomething.length)})`);
console.log(`ramps that only ever land you on deck    ${deckOnly.length}  ${deckOnly.length ? '— ' + deckOnly.map((r) => r.id).join(', ') : ''}`);
console.log(`ramps nothing can reach                  ${unreachable.length}  ${unreachable.length ? '— ' + unreachable.map((r) => r.id).join(', ') : ''}`);
console.log(`ramps reachable from 3+ others           ${chainable.length}  ${chainable.length ? '— ' + chainable.join(', ') : ''}`);
console.log(`longest chain without touching deck      ${longest.length}  ${longest.join(' -> ')}`);

const GATE = { chainable: 15, chain: 5, orphans: 0 };
const pass = chainable.length >= GATE.chainable && longest.length >= GATE.chain
  && unreachable.length === GATE.orphans && deckOnly.length === 0;
console.log(`\ngate: >=${GATE.chainable} reachable from 3+, a chain of >=${GATE.chain}, no orphans, no deck-only ramps`);
console.log(pass ? 'PASS  this park is a network' : 'FAIL  this park is a scatter');
process.exit(pass ? 0 : 1);
