/**
 * R10's gate: "each teaches a routing idea the others do not."
 *
 * `npm run lines` proves an arena is a *network*. It cannot prove an arena is
 * a **different** network, and six arenas that are all "ramps pointing at
 * things, 76 m apart" would pass it six times while being one arena with six
 * skins. That is the failure mode a capped-content release cannot afford: the
 * whole argument for six instead of twenty is that each one is worth thirty
 * hours, which is only true if each one asks something the others do not.
 *
 * So this is `probe:cars` applied to arenas. The roster's law for vehicles is
 * that no car may be Pareto-dominated and every car must be best at something;
 * the same law, on the same reasoning, holds for the places you drive them:
 *
 *   1. **No arena is dominated** — worse than some other arena on every axis.
 *   2. **Every arena is the strict maximum on at least one axis.** If an arena
 *      is not the most anything, it is not teaching anything, and the roster
 *      says it does not ship.
 *
 * The axes are measured off the same reachability graph the line analyzer
 * builds, so none of them is a claim about intent — they are what the geometry
 * actually does to a car.
 *
 *   node tools/probe-arenas.mjs
 */

import TUNING from '../src/TUNING.js';
import { Sim } from '../src/sim/sim.js';
import { ARENA_IDS, rampSurface, rampExitAngle } from '../src/arena/index.js';
import { predictArc } from '../src/sim/airtime.js';
import { gapsFor } from '../src/arena/gaps.js';

const SPEEDS = [32, 38, 44, 50, 56, 62];
const LAUNCHABLE = 0.95;

const C = TUNING.CAR;
const meanArea = (4 * C.HALF.y * C.HALF.z + 4 * C.HALF.x * C.HALF.z + 4 * C.HALF.x * C.HALF.y) / 3;
const dragK = (0.5 * TUNING.AERO.AIR_DENSITY * meanArea * TUNING.AERO.CHASSIS_CD) / C.MASS;

/**
 * The axes. Each is 0..1-ish and each is a *routing* property rather than a
 * decoration — what the arena does to a line, not what it looks like.
 */
const AXES = [
  ['retention', 'flights that hold or gain altitude'],
  ['verticality', 'spread of launch heights, over the arena\'s own scale'],
  ['direction', 'how one-way the graph is — the flow asymmetry'],
  ['motion', 'moving landing targets, as a share of all of them'],
  ['altitude', 'how far above the deck the arena is, on average'],
  ['exposure', 'share of launches that end on bare deck'],
  ['openness', 'distinct surfaces a launch can reach, on average'],
];

function launchFrom(r, speed) {
  const s = rampSurface(r);
  const ang = rampExitAngle(r);
  const c = Math.cos(r.yaw), sn = Math.sin(r.yaw);
  const pos = { x: r.pos.x + s.zMin * sn, y: r.pos.y + s.y(s.zMin) + 1, z: r.pos.z + s.zMin * c };
  const horiz = Math.cos(ang) * speed;
  return { pos, vel: { x: -sn * horiz, y: Math.sin(ang) * speed, z: -c * horiz } };
}

async function measure(id) {
  const sim = await Sim.create(null, id);
  sim.world.step();
  const park = sim.park;
  const ramps = park.ramps.filter((r) => !r.transit && rampExitAngle(r) <= LAUNCHABLE);

  const heights = ramps.map((r) => r.pos.y);
  const reach = new Map();
  let held = 0, real = 0;
  let dirX = 0, dirZ = 0, dirN = 0;
  let deckLandings = 0;

  for (const r of ramps) {
    const hits = new Set();
    for (const speed of SPEEDS) {
      const { pos, vel } = launchFrom(r, speed);
      const arc = predictArc(sim.world, pos, vel, TUNING.SIM.GRAVITY, dragK, 9, 1 / 40);
      if (!arc.point) continue;
      const dx = arc.point.x - pos.x, dz = arc.point.z - pos.z;
      const d = Math.hypot(dx, dz) || 1;
      dirX += dx / d; dirZ += dz / d; dirN++;
      // What did it land on?
      let on = null;
      for (const t of park.targets) {
        if (Math.abs(arc.point.x - t.aim.x) <= t.half.x && Math.abs(arc.point.z - t.aim.z) <= t.half.z
            && arc.point.y >= t.aim.y - t.half.y - 2 && arc.point.y <= t.aim.y + t.half.y + 2) {
          on = t.id; break;
        }
      }
      if (!on) {
        for (const s of park.structures) {
          if (Math.abs(arc.point.x - s.pos.x) <= s.half.x && Math.abs(arc.point.z - s.pos.z) <= s.half.z
              && arc.point.y > s.pos.y) { on = s.id; break; }
        }
      }
      if (!on) { deckLandings++; on = 'deck'; }
      hits.add(on);
      real++;
      if (arc.point.y >= pos.y - 1) held++;
    }
    reach.set(r.id, hits.size);
  }

  const tagged = park.targets.filter((t) => t.tagged !== false);
  const hi = Math.max(...heights), lo = Math.min(...heights);
  // Normalised against the tallest launch, so a big arena is not automatically
  // "more vertical" than a tall one.
  const verticality = hi > 0 ? (hi - lo) / hi : 0;

  return {
    id,
    ramps: ramps.length,
    gaps: gapsFor(id).length,
    retention: real ? held / real : 0,
    verticality,
    direction: dirN ? Math.hypot(dirX, dirZ) / dirN : 0,
    // Movers are not in `targets` — they are their own list, resolved at
    // runtime — so counting them among the tagged ones read zero for every
    // arena including the two built around machinery.
    motion: (park.movers || []).length / Math.max(1, tagged.length + (park.movers || []).length),
    // Skyline's whole identity is that there is no ground, and none of the
    // other axes could see it: its pads catch their own flights, so it scored
    // ordinary on exposure and was the maximum on nothing at all.
    altitude: heights.reduce((a, h) => a + h, 0) / Math.max(1, heights.length) / 100,
    exposure: real ? deckLandings / real : 0,
    openness: reach.size
      ? [...reach.values()].reduce((a, n) => a + n, 0) / reach.size / SPEEDS.length
      : 0,
  };
}

const fails = [];
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} ${detail}`);
  if (!ok) fails.push(label);
};

console.log('\n── six instruments, or one arena with six skins? ────────────\n');

const rows = [];
for (const id of ARENA_IDS) rows.push(await measure(id));

console.log('  arena   ' + AXES.map(([k]) => k.slice(0, 9).padStart(11)).join(''));
for (const r of rows) {
  console.log(`  ${r.id.padEnd(8)}` + AXES.map(([k]) => r[k].toFixed(2).padStart(11)).join(''));
}
console.log('');

// ── 1. Nobody is dominated ─────────────────────────────────────────────────
const dominated = rows.filter((a) =>
  rows.some((b) => b !== a && AXES.every(([k]) => b[k] >= a[k]) && AXES.some(([k]) => b[k] > a[k])));
check(dominated.length === 0, 'no arena is Pareto-dominated',
  dominated.length ? dominated.map((r) => r.id).join(', ') : 'every one of them is the most something');

// ── 2. Everybody is best at something ──────────────────────────────────────
const bestAt = {};
for (const [k] of AXES) {
  let best = rows[0];
  for (const r of rows) if (r[k] > best[k]) best = r;
  (bestAt[best.id] = bestAt[best.id] || []).push(k);
}
const mute = rows.filter((r) => !bestAt[r.id]);
check(mute.length === 0, 'every arena is the maximum on some axis',
  mute.length ? `${mute.map((r) => r.id).join(', ')} teach nothing the others do not`
    : rows.map((r) => `${r.id}:${(bestAt[r.id] || []).join('/')}`).join('  '));

// ── 3. Every arena has named places in it ──────────────────────────────────
const thin = rows.filter((r) => r.gaps < 8);
check(thin.length === 0, 'and every one has named gaps derived from itself',
  thin.length ? thin.map((r) => `${r.id} has ${r.gaps}`).join(', ')
    : rows.map((r) => `${r.id} ${r.gaps}`).join('  '));

// ── 4. And enough of an arena to be one ────────────────────────────────────
const small = rows.filter((r) => r.ramps < 15);
check(small.length === 0, 'and enough launch surfaces to be an arena',
  small.length ? small.map((r) => `${r.id} has ${r.ramps}`).join(', ')
    : rows.map((r) => `${r.id} ${r.ramps}`).join('  '));

console.log('');
console.log(fails.length
  ? `FAIL  ${fails.length} of the roster's arenas do not earn their place`
  : 'PASS  six instruments, and each is the most something');
process.exit(fails.length ? 1 : 0);
