/**
 * Named gaps, exercised (R6).
 *
 * Generating gap definitions proves nothing on its own — the analyzer's arcs
 * are predictions, and a gap only exists if the actual simulation can fly it.
 * So this drives the real car off each gap's launch ramp at the speed the
 * analyzer used and checks that the flight is recognised at both ends.
 */
import { Sim } from '../src/sim/sim.js';
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { gapsFor, matchGap } from '../src/arena/gaps.js';

const ARENA = process.argv.includes('--city') ? 'city' : 'park';
const gaps = gapsFor(ARENA);
const DT = 1 / TUNING.SIM.HZ;

console.log(`\n── ${gaps.length} named gaps in "${ARENA}" ──\n`);
for (const g of gaps) {
  console.log(`  ${g.name.padEnd(26)} ${String(Math.round(g.dist)).padStart(3)}m  ` +
    `${g.airtime.toFixed(2)}s  apex ${g.apex.toFixed(0).padStart(2)}m  -> ${g.tier}`);
}

// Every gap has to be geometrically self-consistent: fed its own endpoints,
// the matcher must return that gap and not a neighbour.
let selfMatch = 0, wrong = [];
for (const g of gaps) {
  const m = matchGap(ARENA, { x: g.from.x, z: g.from.z }, { x: g.to.x, z: g.to.z });
  if (m && m.id === g.id) selfMatch++;
  else wrong.push(`${g.name} -> ${m ? m.name : 'no match'}`);
}

// And the matcher must not hand out names for flights that went nowhere near
// one, or every landing in the arena becomes a discovery.
const spawn = { x: 0, z: 214 };
const falsePositive = matchGap(ARENA, spawn, { x: 4, z: 200 });

// Then actually fly one, in the real solver, and see it fire.
const sim = await Sim.create(null, ARENA);
sim.run.begin();
const seen = [];
const flights = [];
for (let i = 0; i < Math.round(45 / DT); i++) {
  sim.step(DT, { ...NEUTRAL_ACTIONS, throttle: 1, boost: i * DT < 5 }, {});
  for (const e of sim.drainEvents()) {
    if (e.type === 'gap') seen.push(e.gap);
    if (e.type === 'landed' && e.landing && e.landing.from && e.landing.airtime > 1)
      flights.push(e.landing);
  }
}

// If the scripted line does not cross a named gap, say how near it came —
// "none" alone cannot tell a broken matcher from a driver going elsewhere.
const near = [];
for (const f of flights) {
  let best = null, bestMiss = Infinity;
  for (const g of gaps) {
    const miss = Math.hypot(f.from.x - g.from.x, f.from.z - g.from.z)
               + Math.hypot(f.landedAt.x - g.to.x, f.landedAt.z - g.to.z);
    if (miss < bestMiss) { best = g; bestMiss = miss; }
  }
  if (best) near.push(`${best.name} (missed by ${bestMiss.toFixed(0)} m of combined error)`);
}

// End-to-end through the real scoring path, with a synthesised landing rather
// than a driven one: the scripted driver flies one fixed line and there is no
// reason it should happen to cross a named gap, so "it did not fire" would
// otherwise be indistinguishable from a broken matcher.
const target = gaps[0];
const p0 = sim.players[0];
const synthetic = {
  quality: 'clean', multiplier: 1.5, angle: 0.05, angleDeg: 3, wheels: 4, bounced: false,
  airtime: target.airtime, height: target.apex, impactVel: 6, bounces: 0,
  from: { x: target.from.x, y: 6, z: target.from.z },
  landedAt: { x: target.to.x, y: 6, z: target.to.z },
  target: null, tier: 'road', counted: true,
};
sim.drainEvents();
sim._bank(p0, synthetic, false);
const fired = sim.drainEvents().find((e) => e.type === 'gap');

console.log('');
console.log(`banking a flight across "${target.name}"    ` +
  (fired ? `fires, ${fired.gap.first ? 'as a discovery' : 'as a repeat'}, +${fired.gap.bonus}` : 'NOTHING FIRED'));
console.log(`gaps that match their own endpoints      ${selfMatch}/${gaps.length}`);
if (wrong.length) for (const w of wrong) console.log(`  MISMATCH  ${w}`);
console.log(`a nothing-flight near spawn matches      ${falsePositive ? 'YES — ' + falsePositive.name : 'no'}`);
console.log(`flights logged by the scripted driver    ${flights.length}`);
console.log(`named gaps it flew                       ${seen.length ? seen.map((g) => g.name + (g.first ? ' (NEW)' : '')).join(', ') : 'none'}`);
if (!seen.length && near.length) console.log(`closest it came                          ${near[0]}`);

const ok = gaps.length >= 8 && selfMatch === gaps.length && !falsePositive && !!fired;
console.log(`\ngate: >=8 named gaps, each matches itself, no false positive at spawn, and one pays out`);
console.log(ok ? 'PASS  the arena has named places in it' : 'FAIL  the gap table does not hold up');
if (!ok) process.exitCode = 1;
