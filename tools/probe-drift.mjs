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
import { computeFacets } from '../src/sim/facets.js';
import { TrickTracker } from '../src/sim/tricks.js';

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

// ── Q1: FACETS — the DRIFT facet, now built in, scored through computeFacets ──
console.log('\n── Q1  FACETS: the DRIFT facet stacks on the same curve as every other facet ──');
// Drift is now a real ground facet (facets.js). It reads f.ground.drift with the
// same base / min-time / per-second shape as wheelie/endo/twoWheel. Toggle it on
// the same flight and watch the count and multiplier move through the unmodified
// stacking curve — no parallel system, no special case.
const F = TUNING.SCORE.FACET;
const flightBase = {
  yaw: 6.3, pitch: 0, roll: 0, twistTime: 0, maxTilt: 0,
  airtime: 2.6, height: 20, distance: 100, pose: {}, brakeTime: 0, thrustBursts: 0,
  coins: 0, nearMisses: 0, gap: false, transfer: false,
};
const before = computeFacets({ ...flightBase, ground: { wheelie: 0, endo: 0, twoWheel: 0, drift: 0 } });
const after = computeFacets({ ...flightBase, ground: { wheelie: 0, endo: 0, twoWheel: 0, drift: 1.4 } });
console.log(`   flight, no drift banked:   ${before.facets.length} facets  base ${String(before.base).padStart(4)}  ×${before.mult}  = ${Math.round(before.base * before.mult)}`);
console.log(`   flight, 1.4 s drift banked: ${after.facets.length} facets  base ${String(after.base).padStart(4)}  ×${after.mult}  = ${Math.round(after.base * after.mult)}`);
console.log(`   added: ${JSON.stringify(after.facets.find((f) => f.id === 'drift'))}`);
const facetsOk = after.facets.length === before.facets.length + 1
  && after.facets.some((f) => f.id === 'drift') && after.mult >= before.mult;
console.log(`   verdict: ${facetsOk
  ? 'DRIFT is a facet like any other — one `ground.drift` field, one TUNING entry, one line in\n' +
    '            updateGround and one in computeFacets. Built and live. CHEAP.'
  : 'the facet machinery did not absorb a ground drift cleanly — investigate.'}`);

// ── Q4: CHAIN — does a banked drift ride the ground→air→landing path? ────────
console.log('\n── Q4  CHAIN: a drift banked on the run-up carries into the jump it feeds ──');
// Exercise the real path end to end at the tracker level: updateGround writes
// ground.drift; onLaunch moves it into pendingGround; snapshot()/computeFacets
// emit the DRIFT facet on the *flight*, so it lands and pays with the jump —
// exactly how wheelie/endo chain today, with no new machinery.
const tt = new TrickTracker();
tt.ground.drift = 0.9;                              // a slide accumulated on the run-up
tt.onLaunch({ position: { x: 0, y: 1, z: 0 } });    // launch banks it into pendingGround
Object.assign(tt, { airtime: 2.6, launchY: 1, maxY: 21, height: 20, distance: 100 });
const snap = tt.snapshot();
const carriedDrift = snap.facets.find((f) => f.id === 'drift');
console.log(`   run-up drift 0.9 s → launch → flight snapshot facets: ${snap.facets.map((f) => f.label).join(' · ')}`);
console.log(`   DRIFT carried into the landing: ${carriedDrift ? 'yes, worth ' + carriedDrift.value : 'NO'}`);
const chainOk = !!carriedDrift;
console.log(`   verdict: ${chainOk
  ? 'the drift banks into the flight via pendingGround and lands with it. drift→jump→landing\n' +
    '            chains on the existing bank/combo logic. A pure-ground LINE (drift, no jump) resolves\n' +
    '            through the ground-line path added alongside this — see probe:drift Q4 / sim.js.'
  : 'a banked drift did NOT carry into the flight — the chain is broken, investigate.'}`);

// ── Q4b: pure-ground LINE — a drift with no jump banks on its own ────────────
// The one net-new path. It is dormant on the real threshold (no car holds a
// drift to F.DRIFT_TIME), so to exercise it end to end we drop the threshold to
// what today's physics can reach, drive a real slide that never launches, and
// require the ground-line result to fire and carry a DRIFT facet. Restored after.
console.log('\n── Q4b CHAIN: a pure-ground drift LINE (no jump) resolves and banks ──');
const savedDriftTime = F.DRIFT_TIME;
const savedGrace = TUNING.SCORE.GROUND_LINE_GRACE;
F.DRIFT_TIME = 0.3;                       // reachable: DRIFTER holds ~0.46 s
TUNING.SCORE.GROUND_LINE_GRACE = 0.35;
let groundLineResult = null;
{
  const sim = await Sim.create(setupFor('drifter'));
  sim.run.begin();
  sim.placeCar({ x: 0, y: 1.08, z: 300 }, 0);
  const input = (t) => {
    if (t < 3.5) return { throttle: 1 };
    if (t < 4.6) return { throttle: 0.7, steer: -0.4, handbrake: t < 3.8 }; // slide
    return {};                                                             // let it settle, no jump
  };
  for (let i = 0; i < Math.round(7 / DT) && !groundLineResult; i++) {
    sim.step(DT, { ...NEUTRAL_ACTIONS, ...input(i * DT) });
    for (const ev of sim.drainEvents()) if (ev.type === 'groundLine') groundLineResult = ev.result;
  }
}
F.DRIFT_TIME = savedDriftTime;            // restore before anything else reads it
TUNING.SCORE.GROUND_LINE_GRACE = savedGrace;
const glDrift = groundLineResult && groundLineResult.facets.find((f) => f.id === 'drift');
console.log(`   scripted slide, no jump → groundLine event: ${groundLineResult ? 'fired' : 'NONE'}`);
if (groundLineResult) console.log(`   result: facets [${groundLineResult.facets.map((f) => f.label).join(', ')}]  bank ${groundLineResult.bank}  payout ${groundLineResult.payout}  landed ${groundLineResult.landed}`);
const groundLineOk = !!glDrift && groundLineResult.landed;
console.log(`   verdict: ${groundLineOk
  ? 'a drift held on the wheels and never launched banks as its own LINE and extends the chain.\n' +
    '            (Threshold restored — dormant on the real physics until a tyre model can hold a drift.)'
  : 'the pure-ground LINE did not resolve — investigate closeGroundLine / _bankGroundLine.'}`);

// ── Decision gate ────────────────────────────────────────────────────────────
console.log('\n── DECISION GATE ──');
console.log(`   Facets:      ${facetsOk ? 'DRIFT facet built and live (CHEAP, done)' : 'FACET WIRING BROKEN'}`);
console.log(`   Determinism: ${deterministic ? 'bit-exact, probeable today (CHEAP)' : 'NOT DETERMINISTIC'}`);
console.log(`   Chain:       ${chainOk && groundLineOk ? 'drift→jump banks via pendingGround; pure-ground LINE resolves (CHEAP, done)' : 'CHAIN BROKEN'}`);
console.log(`   Physics:     ${physicsOk ? 'sustains a controllable slide (CHEAP)' : 'needs a new tyre-friction model (EXPENSIVE)'}`);
console.log('');
// The three cheap dimensions are now built; the machinery is verified above and
// waits, dormant, on the one expensive dimension. The gate stays RED on physics.
const machineryOk = facetsOk && deterministic && chainOk && groundLineOk;
if (!machineryOk) {
  console.log('   BROKEN  the drift scoring/chain machinery failed its own checks — fix before shipping.');
} else if (physicsOk) {
  console.log('   PASS  scoring, determinism and chain are built AND the physics now holds a drift →');
  console.log('         drift is ready to be the next numbered phase (R13): give it a pillar doc,');
  console.log('         content plan, and promote this gate to the real threshold.');
} else {
  console.log('   HOLD  scoring, determinism and chain are BUILT and verified — drift banks, chains, and');
  console.log('         resolves the moment a real slide exists. They wait, dormant, on the one expensive');
  console.log('         dimension: no car holds a controllable slide past ~0.5 s on today\'s tyre model.');
  console.log('         This gate flips to PASS the moment a slip-angle model lets a car hold a >1 s slide;');
  console.log('         nothing else about drift is blocking. See airtime-drift-spike-findings.md.');
}
// RED until the physics can sustain a drift — the machinery is ready, the tyre
// model is not, and the exit code carries that honestly into CI.
process.exit(machineryOk && physicsOk ? 0 : 1);
