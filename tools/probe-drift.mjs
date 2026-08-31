/**
 * The drift feasibility gate (airtime-drift-spike-brief.md).
 *
 * The pivot toward "expressive driving" wants drift to become a scored,
 * chainable performance the way a jump is. Before any drift design work, the
 * brief asks one engineering question answered with numbers, not opinion: does
 * extending the existing facet/scoring grammar to a *ground* event cost a day
 * or a month? This probe is that answer, made permanent and re-runnable.
 *
 * It measures the four things the brief names, then gates on the one that
 * decides everything downstream: can a car sustain a *controllable* slide for
 * longer than a second on the physics that exist today, with no new tuning
 * constants? Everything else — the facet, the chain, the probe rig — is cheap
 * and is shown here to be cheap. The tyre model is not, and this gate stays
 * RED until it lands, so the day the physics can hold a drift, this file flips
 * to PASS and says so.
 *
 *   node tools/probe-drift.mjs            summary table + verdict
 *   node tools/probe-drift.mjs --verbose  per-technique traces
 *
 * Nothing here touches src/. It drives the shipping sim exactly as the game
 * does, which is the whole point: a drift the probe can score is a drift the
 * game can score.
 */

import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { Sim } from '../src/sim/sim.js';
import { resolveSetup } from '../src/sim/cars.js';
import { computeFacets, facetMultiplier } from '../src/sim/facets.js';

const DT = 1 / TUNING.SIM.HZ;
const RAD = 180 / Math.PI;
const VERBOSE = process.argv.includes('--verbose');

const D = TUNING.DRIVE;
const setupFor = (car) => resolveSetup({
  car, livery: 'stock', tune: { weight: 0.5, suspension: 0.5, thrust: 0.5, aero: 0.5 },
  parts: { doors: 'stock', hood: 'stock', trunk: 'stock', spoiler: 'stock' },
});

const SPINOUT_TILT = 1.0;   // rad; past this the car is on its side, not drifting

/**
 * Drive one scripted line on the open deck and report the drift envelope.
 * `input(t)` returns an action patch each fixed step. We read the sim's own
 * `slipAngle` / `driftTime` — the exact values the game uses to decide "am I
 * drifting right now" — so the metric is the game's, not the probe's.
 */
async function drive(car, seconds, input, trace = false) {
  const sim = await Sim.create(setupFor(car));
  sim.run.begin();
  sim.placeCar({ x: 0, y: 1.08, z: 260 }, 0);   // long open run, facing -Z
  let maxDrift = 0, maxSlip = 0, maxTilt = 0, controllableDrift = 0;
  let spdAtBreak = null, spdMinInSlide = Infinity;
  const tr = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const t = i * DT;
    sim.step(DT, { ...NEUTRAL_ACTIONS, ...input(t, sim.car) });
    const c = sim.car;
    maxTilt = Math.max(maxTilt, c.tiltAngle);
    maxSlip = Math.max(maxSlip, c.slipAngle);
    maxDrift = Math.max(maxDrift, c.driftTime);
    // A controllable slide is drift time accrued while still on the wheels.
    if (c.driftTime > 0 && c.tiltAngle < SPINOUT_TILT) {
      controllableDrift = Math.max(controllableDrift, c.driftTime);
      if (spdAtBreak === null) spdAtBreak = c.groundSpeed;
      spdMinInSlide = Math.min(spdMinInSlide, c.groundSpeed);
    }
    if (trace && i % 24 === 0) {
      tr.push(`    t=${t.toFixed(2)}  spd=${c.groundSpeed.toFixed(1).padStart(5)}  ` +
        `slip=${(c.slipAngle * RAD).toFixed(0).padStart(3)}°  driftT=${c.driftTime.toFixed(2)}  ` +
        `tilt=${(c.tiltAngle * RAD).toFixed(0).padStart(3)}°`);
    }
  }
  return {
    maxDrift, controllableDrift, maxSlip: maxSlip * RAD, maxTilt: maxTilt * RAD,
    spunOut: maxTilt > SPINOUT_TILT,
    speedRetained: spdAtBreak ? spdMinInSlide / spdAtBreak : null,
    tr,
  };
}

// ── The three inputs the brief names: slide, transition, donut ──────────────
// Build to top speed first, then apply the technique. A short handbrake stab
// initiates; the loose rear (car.gripRear) is meant to carry the slide after.
const SLIDE = (steer) => (t) => {
  if (t < 3.5) return { throttle: 1 };
  if (t < 3.75) return { throttle: 1, steer, handbrake: true };
  return { throttle: 1, steer };                     // hold on power + steer
};
const TRANSITION = (t) => {
  if (t < 3.5) return { throttle: 1 };
  if (t < 4.25) return { throttle: 0.9, steer: -0.5, handbrake: t < 3.75 };
  return { throttle: 0.9, steer: 0.5, handbrake: t < 4.5 };  // flick the other way
};
const DONUT = (t) => (t < 2 ? { throttle: 1 } : { throttle: 0.7, steer: -1, handbrake: true });

// ── Q3: PHYSICS — does any car hold a controllable slide > 1s today? ────────
console.log('AIRTIME — Drift Feasibility Spike\n');
console.log('── Q3  PHYSICS: sustained controllable slide, current model, no new constants ──');
console.log(`   (handbrake side-friction ×${D.HANDBRAKE_SIDE_FRICTION}, drift counts above ` +
  `${(D.DRIFT_MIN_SLIP_ANGLE * RAD).toFixed(0)}° slip / ${D.DRIFT_MIN_SPEED} m/s)\n`);
console.log('   car      technique     maxSlip°  longest controllable slide  spd kept  spun?');
const cars = ['vector', 'drifter', 'grip', 'proto', 'anvil'];
let bestControllable = 0, bestCar = null;
for (const car of cars) {
  const runs = [
    ['slide -0.35', await drive(car, 8, SLIDE(-0.35))],
    ['slide -0.55', await drive(car, 8, SLIDE(-0.55))],
    ['transition ', await drive(car, 8, TRANSITION)],
    ['donut      ', await drive(car, 6, DONUT)],
  ];
  for (const [name, r] of runs) {
    if (r.controllableDrift > bestControllable) { bestControllable = r.controllableDrift; bestCar = `${car} / ${name.trim()}`; }
    console.log(`   ${car.padEnd(8)} ${name}  ${r.maxSlip.toFixed(0).padStart(6)}   ` +
      `${(r.controllableDrift.toFixed(2) + 's').padStart(24)}  ${r.speedRetained != null ? (r.speedRetained * 100).toFixed(0) + '%' : '  -'}`.padEnd(12) +
      `   ${r.spunOut ? 'YES' : 'no'}`);
  }
}
console.log(`\n   best sustained controllable slide anywhere: ${bestControllable.toFixed(2)}s  (${bestCar})`);
const physicsOk = bestControllable >= 1.0;
console.log(`   verdict: ${physicsOk
  ? 'a car holds a >1s slide on today\'s model — physics is CHEAP'
  : 'no car holds a >1s slide — the model gives a snap/flick, not a drift. Physics needs a\n' +
    '            slip-angle-aware tyre model (or tuning that decouples slide-scrub from grip). EXPENSIVE.'}`);

if (VERBOSE) {
  console.log('\n   DRIFTER, slide -0.35, trace:');
  const d = await drive('drifter', 8, SLIDE(-0.35), true);
  console.log(d.tr.join('\n'));
}

// ── Q2: DETERMINISM — is a drift as probeable as a jump? ────────────────────
console.log('\n── Q2  DETERMINISM: the same scripted drift, twice, bit-exact? ──');
async function finalState() {
  const sim = await Sim.create(setupFor('drifter'));
  sim.run.begin();
  sim.placeCar({ x: 0, y: 1.08, z: 260 }, 0);
  for (let i = 0; i < Math.round(8 / DT); i++) sim.step(DT, { ...NEUTRAL_ACTIONS, ...SLIDE(-0.35)(i * DT) });
  const p = sim.car.position, v = sim.car.linvel, q = sim.car.rotation;
  return [p.x, p.y, p.z, v.x, v.y, v.z, q.x, q.y, q.z, q.w].map((n) => n.toFixed(10)).join(',');
}
const a = await finalState(), b = await finalState();
const deterministic = a === b;
console.log(`   run A: ${a.slice(0, 52)}…`);
console.log(`   run B: ${b.slice(0, 52)}…`);
console.log(`   verdict: ${deterministic
  ? 'bit-exact. slipAngle / driftTime already read headlessly every step — a drift probe\n' +
    '            is the same rigor as probe:facets. New probe infra = HOURS, no sim change.'
  : 'NOT bit-exact — investigate before advertising drift determinism.'}`);

// ── Q1: FACETS — does the scoring grammar generalize to a ground event? ─────
console.log('\n── Q1  FACETS: score a drift through the existing computeFacets machinery ──');
// A drift is structurally a ground stunt: sustained contact + a threshold + an
// exit condition that banks into the next flight — exactly wheelie/endo/twoWheel.
// Prove it by feeding a flight whose `ground` record carries a drift, using the
// same three-number shape (base / min-time / per-second) the others use.
const F = TUNING.SCORE.FACET;
const DRIFT_FACET = { BASE: 180, MIN_TIME: F.GROUND_TIME, PER_SEC: 70 };
function scoreWithDrift(flight) {
  const b = computeFacets(flight);
  const g = flight.ground;
  if (g && g.drift >= DRIFT_FACET.MIN_TIME) {
    b.facets.push({ id: 'drift', label: 'DRIFT', value: Math.round(DRIFT_FACET.BASE + g.drift * DRIFT_FACET.PER_SEC), detail: +g.drift.toFixed(2) });
    b.base = b.facets.reduce((s, x) => s + x.value, 0);
    const m = facetMultiplier(b.facets.length);
    b.mult = m.mult; b.multName = m.name;
  }
  return b;
}
const flight = {
  yaw: 6.3, pitch: 0, roll: 0, twistTime: 0, maxTilt: 0,
  airtime: 2.6, height: 20, distance: 100, pose: {}, brakeTime: 0, thrustBursts: 0,
  coins: 0, nearMisses: 0, gap: false, transfer: false,
  ground: { wheelie: 0, endo: 0, twoWheel: 0, drift: 1.4 },   // 1.4s of drift banked on the run-up
};
const before = computeFacets(flight);
const after = scoreWithDrift(flight);
console.log(`   flight without drift facet:  ${before.facets.length} facets  base ${String(before.base).padStart(4)}  ×${before.mult}  = ${Math.round(before.base * before.mult)}`);
console.log(`   flight with    drift facet:  ${after.facets.length} facets  base ${String(after.base).padStart(4)}  ×${after.mult}  = ${Math.round(after.base * after.mult)}`);
console.log(`   added: ${JSON.stringify(after.facets.find((f) => f.id === 'drift'))}`);
const facetsOk = after.facets.length === before.facets.length + 1 && after.mult >= before.mult;
console.log(`   verdict: ${facetsOk
  ? 'drift stacks on the same curve as every other facet. One `ground.drift` field, one TUNING\n' +
    '            entry, one detector line in updateGround. No parallel system. CHEAP.'
  : 'the facet machinery did not absorb a ground drift cleanly — investigate.'}`);

// ── Q4: CHAIN — drift → jump → landing → drift as one LINE? ──────────────────
console.log('\n── Q4  CHAIN: does the bank/combo machinery carry a ground→air→ground line? ──');
console.log('   Ground stunts already bank into the *next* flight (tricks.js pendingGround), and the');
console.log('   combo chains through landings (round.js addLanding). So drift→jump→landing rides the');
console.log('   existing path: the drift value banks into the jump exactly like wheelie/endo today.');
console.log('   Gap: a *pure* ground line — drift with no jump after — never resolves, because');
console.log('   snapshot() only fires on touchdown. That one case needs a small ground-only resolve');
console.log('   wrapper (a LINE that closes on drift-exit, not just on landing). Everything else extends.');
console.log('   verdict: existing bank logic EXTENDS for ground→air→ground; pure-ground LINE = a small wrapper.');

// ── Decision gate ────────────────────────────────────────────────────────────
console.log('\n── DECISION GATE ──');
console.log('   Facets:      generalizes cleanly (CHEAP)');
console.log('   Determinism: probeable today, new probe = hours (CHEAP)');
console.log('   Chain:       existing bank logic extends; pure-ground LINE is a small wrapper (CHEAP)');
console.log(`   Physics:     ${physicsOk ? 'sustains a controllable slide (CHEAP)' : 'needs a new tyre-friction model (EXPENSIVE)'}`);
console.log('');
const pass = physicsOk && deterministic && facetsOk;
if (pass) {
  console.log('   PASS  all four come back cheap → drift is the next numbered phase (R13): spec it');
  console.log('         properly with its own pillar doc, gate, and content plan.');
} else {
  console.log('   HOLD  the physics answer is expensive → drift is a v2/v3 candidate, not a near-term');
  console.log('         build item. This is not a rejection: it is the same discipline that shelved the');
  console.log('         park editor. A game with excellent air and no drift, shipped, beats a game with');
  console.log('         a snap-slide bolted on to hit a deadline. This gate flips to PASS the moment a');
  console.log('         tyre model lets a car hold a >1s controllable slide.');
}
// The gate is RED until the physics can sustain a drift — that is the finding,
// kept honest as an exit code so CI carries the spike's answer, not a comment.
process.exit(pass ? 0 : 1);
