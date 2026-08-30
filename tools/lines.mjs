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
 *   node tools/lines.mjs             the current arena
 *   node tools/lines.mjs --city
 *   node tools/lines.mjs --verbose   every edge
 *   node tools/lines.mjs --emit-gaps name the notable ones (R6)
 *
 * The last one is the point of having built this: named gaps are the cheapest
 * depth in the plan, and hand-authoring them is guesswork about geometry the
 * analyzer already knows exactly. So the gaps are *derived* — the long, high,
 * lands-on-something-real edges of the reachability graph get names, and the
 * game learns them from the same measurement that proved the park is a
 * network in the first place.
 */

import TUNING from '../src/TUNING.js';
import { Sim } from '../src/sim/sim.js';
import { RAPIER, WHEEL_RAY_GROUPS } from '../src/sim/physics.js';
import { rampSurface, rampExitAngle } from '../src/arena/index.js';
import { predictArc } from '../src/sim/airtime.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
// Any arena by name. `--city` stays as an alias because it is in a dozen
// commit messages and one npm script.
const ai = argv.indexOf('--arena');
const ARENA = ai >= 0 ? argv[ai + 1] : (argv.includes('--city') ? 'city' : 'park');
const VERBOSE = argv.includes('--verbose');
const EMIT = argv.includes('--emit-gaps');

// Dense enough that each ramp->surface pair has a real middle to pick from;
// five samples left most pairs with a single arc, and "the median flight" then
// meant "the only flight", which is where the gap definitions drifted to the
// top of the speed range.
const SPEEDS = [26, 32, 38, 44, 50, 56, 62, 68];
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
// A `transit` ramp is a road that happens to be inclined — the city's spiral
// flyover. Counting its ten shallow segments as launch surfaces would report
// ten flights into the street and call the arena a scatter on the strength of
// its best feature.
const launchable = park.ramps.filter((r) => r.id !== 'garage' && !r.transit
  && rampExitAngle(r) <= LAUNCHABLE);

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
    // Keep the real endpoints, not the ramp's centre and the target's centre.
    // A ramp is 30 m long; matching a runtime flight against its midpoint puts
    // the tolerance in the wrong place and nothing ever matches.
    const e = { from: r.id, speed, airtime: arc.airtime, apex: arc.apexHeight, to: surf, next,
                at: { x: pos.x, y: pos.y, z: pos.z }, point: { ...arc.point } };
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

// ── Strata (R8) ────────────────────────────────────────────────────────────
// The Yard's routing idea is centripetal; Vertical City's is altitude, and
// "each stratum is a network in its own right" is a claim about where flights
// start and where they end rather than about how many of them there are. So
// bucket every edge by the height it left from and the height it arrived at.
const STRATA = [
  { name: 'street', below: 8 }, { name: 'mezz', below: 22 },
  { name: 'roof', below: 42 }, { name: 'sky', below: Infinity },
];
const stratumOf = (y) => STRATA.findIndex((s) => y < s.below);
const grid = STRATA.map(() => STRATA.map(() => 0));
let held = 0, real = 0;
for (const e of edges) {
  if (e.to.kind === 'deck') continue;
  const a = stratumOf(e.at.y - 9), b = stratumOf(e.point.y);   // -9: lip height
  grid[a][b]++;
  real++;
  if (b >= a) held++;
}
console.log('\nstrata      ' + STRATA.map((s) => s.name.padStart(7)).join(''));
STRATA.forEach((s, i) => {
  if (!grid[i].some(Boolean)) return;
  console.log(`  from ${s.name.padEnd(7)} ` + grid[i].map((n) => String(n).padStart(7)).join(''));
});
console.log(`flights that hold or gain altitude       ${held}/${real}  ` +
  `(${((held / Math.max(1, real)) * 100).toFixed(0)}%)`);

// A tagged target is a promise the camera makes to the player: it frames the
// thing, so the thing had better be somewhere a jump can end. One that no arc
// in the sweep reaches is a prize behind glass.
const landedOn = new Set(edges.map((e) => e.to.id));
const tagged = park.targets.filter((t) => t.tagged !== false);
const unreachedTargets = tagged.filter((t) => !landedOn.has(t.id));
console.log(`tagged targets no launch reaches         ${unreachedTargets.length}  ` +
  (unreachedTargets.length ? '— ' + unreachedTargets.map((t) => t.id).join(', ') : ''));

// ── Named gaps (R6) ────────────────────────────────────────────────────────
const NOUN = [
  // The Yard
  [/^tower/, 'TOWER'], [/^mid_up/, 'DECK'], [/^mid/, 'DECK'], [/^hero/, 'HERO'],
  [/^in_/, 'KICKER'], [/^bank/, 'BANK'], [/^pipe/, 'PIPE'], [/^shelf/, 'SHELF'],
  [/^board/, 'BILLBOARD'], [/^pool/, 'POOL'], [/^mast/, 'MAST'],
  [/^over/, 'OVERPASS'], [/^garage/, 'GARAGE'],
  // Vertical City (R8). The city names things after what they *are*, so the
  // gap names come out as places a player can say out loud rather than as
  // grid coordinates: SPIRE DROP, NORTH STACK LINE, WEST COIL SKIP.
  [/^spire/, 'SPIRE'], [/^stack/, 'STACK'], [/^coil/, 'COIL'],
  [/^roof_/, 'ROOF'], [/^tw_/, 'ROOF'], [/^br_/, 'BRIDGE'], [/^st_/, 'STREET'],
  [/^plaza/, 'PLAZA'], [/^bb_/, 'BILLBOARD'], [/^viaduct/, 'VIADUCT'],
  // Mega Works (R10)
  [/^hop/, 'HOPPER'], [/^cr_/, 'CRANE'], [/^cw_/, 'CATWALK'],
  [/^st_/, 'STACK'], [/^yd_/, 'YARD'], [/^skip/, 'SKIP'], [/^jib/, 'JIB'],
  // Floodway (R10)
  [/^ch_/, 'CHANNEL'], [/^spill/, 'SPILLWAY'], [/^weir/, 'WEIR'],
  [/^basin/, 'BASIN'], [/^culvert/, 'CULVERT'], [/^fw_/, 'CHANNEL'],
  // Skyline (R10)
  [/^up_peak/, 'PEAK'], [/^up_pad/, 'PAD'], [/^pad_/, 'PAD'],
  [/^span_/, 'SPAN'], [/^peak/, 'PEAK'], [/^climb/, 'CLIMB'],
  [/^sk_/, 'PAD'], [/^anchor/, 'ANCHOR'], [/^cable/, 'CABLE'],
];
const nounOf = (id) => (NOUN.find(([re]) => re.test(id)) || [null, id.toUpperCase()])[1];
const VERB = { TOWER: 'DROP', BANK: 'SWEEP', PIPE: 'SPILL', DECK: 'HOP', SHELF: 'STEP',
               BILLBOARD: 'SIGN', POOL: 'PLUNGE', ROOF: 'SKIP', OVERPASS: 'UNDERPASS',
               SPIRE: 'DROP', STACK: 'LINE', COIL: 'SPIRAL', BRIDGE: 'SPAN',
               PLAZA: 'DIVE', STREET: 'FALL', VIADUCT: 'RAIL',
               HOPPER: 'DROP', CRANE: 'SWING', CATWALK: 'WALK', YARD: 'CLIMB',
               SKIP: 'CATCH', JIB: 'REACH',
               CHANNEL: 'RUN', SPILLWAY: 'SPILL', WEIR: 'BREAK', BASIN: 'PLUNGE',
               CULVERT: 'BORE',
               PAD: 'STEP', SPAN: 'CROSS', PEAK: 'SUMMIT', ANCHOR: 'HOLD',
               CLIMB: 'HAUL',
               CABLE: 'WIRE' };

// The Yard is four-fold symmetric, so a dozen gaps are rotations of each other
// and naming them by shape alone produces BANK DROP I through VI. Bearing off
// the launch point separates them into things a player can actually say out
// loud: the north bank drop, the west kicker hop.
const COMPASS = ['NORTH', 'NORTHEAST', 'EAST', 'SOUTHEAST', 'SOUTH', 'SOUTHWEST', 'WEST', 'NORTHWEST'];
const bearingOf = (p) => {
  const a = Math.atan2(p.x, -p.z);                       // -z is north
  return COMPASS[(Math.round((a / (Math.PI / 4)) + 8) % 8)];
};

function nameGap(e, dist, src) {
  src = { at: e.at };
  const a = nounOf(e.from), b = nounOf(e.to.id);
  // apexHeight is absolute world y, so "high" has to be measured against the
  // launch. In The Yard every lip is nine metres up and the two readings
  // agree; in a city where a ramp can sit on a forty-six metre roof, an
  // absolute threshold calls every rooftop hop HIGH and the word stops
  // meaning anything.
  const far = dist > 130, high = e.apex - e.at.y > 20;
  const shape = a === b ? `${a} ${VERB[a] || 'LINE'}` : `${a} ${VERB[b] || 'LINE'}`;
  const qualifier = far ? 'LONG ' : high ? 'HIGH ' : '';
  return `${bearingOf(src.at)} ${qualifier}${shape}`;
}

// Only edges worth a name: a real flight that ends somewhere authored.
const candidates = [];
for (const e of edges) {
  if (e.to.kind === 'deck' || e.to.id === e.from) continue;
  if (e.airtime < 1.5) continue;
  const src = launchable.find((r) => r.id === e.from);
  const dst = park.targets.find((t) => t.id === e.to.id)
    || park.structures.find((x) => x.id === e.to.id)
    || park.ramps.find((x) => x.id === e.to.id);
  if (!src || !dst) continue;
  const dp = e.point;
  const dist = Math.hypot(dp.x - e.at.x, dp.z - e.at.z);
  if (dist < 45) continue;
  candidates.push({ e, src, dst, dp, dist });
}
// One gap per (from -> to) pair, keeping the *median* flight rather than the
// longest. The longest is the one flown at the top of the speed sweep, which
// sits at the edge of what the car can actually do — pin the gap there and a
// normal crossing lands 30 m short of its own definition and matches nothing.
// The median is the version a player will really fly.
const byPair = new Map();
for (const c of candidates) {
  const key = `${c.e.from}>${c.e.to.id}`;
  if (!byPair.has(key)) byPair.set(key, []);
  byPair.get(key).push(c);
}
const REALISTIC = [44, 62];   // the band a car actually leaves a kicker in
for (const [key, list] of byPair) {
  list.sort((a, b) => a.dist - b.dist);
  const pick = list[Math.floor(list.length / 2)];
  pick.support = list.filter((c) => c.e.speed >= REALISTIC[0] && c.e.speed <= REALISTIC[1]).length;
  byPair.set(key, pick);
}
// Capped. Naming everything names nothing — a gap is supposed to be a place
// with a reputation, not a row in a table.
const MAX_GAPS = 16;
const gaps = [...byPair.values()]
  // Ranked on drama *and* on how many realistic launch speeds reach it. A gap
  // only one speed in the sweep can hit is a curiosity; one that half the band
  // reaches is a place.
  .sort((a, b) => (b.dist + b.e.airtime * 40 + b.e.apex * 2 + b.support * 70)
                - (a.dist + a.e.airtime * 40 + a.e.apex * 2 + a.support * 70))
  .slice(0, MAX_GAPS);
const used = new Map();
for (const g of gaps) {
  let name = nameGap(g.e, g.dist, g.src);
  const n = (used.get(name) || 0) + 1;
  used.set(name, n);
  g.name = n > 1 ? `${name} ${'II III IV V VI VII VIII IX X'.split(' ')[n - 2]}` : name;
}

console.log(`\nnamed gaps                               ${gaps.length}`);
for (const g of gaps.slice(0, 14)) {
  console.log(`  ${g.name.padEnd(22)} ${g.e.from.padEnd(12)} -> ${g.e.to.id.padEnd(14)} ` +
    `${g.dist.toFixed(0).padStart(3)}m  ${g.e.airtime.toFixed(2)}s  apex ${g.e.apex.toFixed(0)}m`);
}
if (gaps.length > 14) console.log(`  ...and ${gaps.length - 14} more`);

if (EMIT) {
  const rows = gaps.map((g) => ({
    id: `${ARENA}:${g.e.from}>${g.e.to.id}`, name: g.name, arena: ARENA,
    // y on both ends: Vertical City stacks four garage decks on one footprint,
    // and an x/z-only match cannot tell a flight onto the top deck from the
    // same flight three storeys lower.
    from: { x: +g.e.at.x.toFixed(2), y: +g.e.at.y.toFixed(2), z: +g.e.at.z.toFixed(2) },
    to: { x: +g.dp.x.toFixed(2), y: +g.dp.y.toFixed(2), z: +g.dp.z.toFixed(2) },
    dist: +g.dist.toFixed(1), airtime: +g.e.airtime.toFixed(2), apex: +g.e.apex.toFixed(1),
    tier: g.e.to.tier || g.e.to.kind,
  }));
  const path = new URL('../src/arena/gaps.generated.js', import.meta.url);
  const prev = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const others = prev.match(/\/\* ---- (\w+) ---- \*\/\n([\s\S]*?)\/\* ---- end \1 ---- \*\//g) || [];
  const kept = others.filter((b) => !b.startsWith(`/* ---- ${ARENA} ---- */`));
  const block = `/* ---- ${ARENA} ---- */\n` +
    rows.map((r) => '  ' + JSON.stringify(r) + ',').join('\n') +
    `\n/* ---- end ${ARENA} ---- */`;
  writeFileSync(path, `/**
 * Named gaps — GENERATED by \`npm run gaps\`. Do not hand-edit.
 *
 * Each entry is a notable edge of an arena's reachability graph: a launch
 * point, a landing point, and how far and how long the flight between them is.
 * The game matches a flight to a gap by proximity at both ends, so nothing in
 * the simulation needs to know a gap exists.
 */
export const GENERATED_GAPS = [
${[...kept, block].join('\n')}
];
`);
  console.log(`\nwrote src/arena/gaps.generated.js  (${rows.length} gaps for ${ARENA})`);
}

const GATE = { chainable: 15, chain: 5, orphans: 0, gaps: 8 };
const pass = chainable.length >= GATE.chainable && longest.length >= GATE.chain
  && unreachable.length === GATE.orphans && deckOnly.length === 0
  && gaps.length >= GATE.gaps;
console.log(`\ngate: >=${GATE.chainable} reachable from 3+, a chain of >=${GATE.chain}, no orphans, ` +
  `no deck-only ramps, >=${GATE.gaps} named gaps`);
console.log(pass ? 'PASS  this park is a network' : 'FAIL  this park is a scatter');
process.exit(pass ? 0 : 1);
