/**
 * The particle system, measured (R7).
 *
 * "The world should look expensive because it's coherent and *responsive*."
 * Responsive is testable: smoke has to appear where the tyres are actually
 * slipping and nowhere else, a crash has to throw more than a landing, and the
 * whole thing has to stay inside its pool on the worst frame of a run —
 * because the frame where a car explodes is exactly the frame you cannot
 * afford to allocate on.
 *
 * The emission decisions live in Fx rather than in the render loop precisely so
 * this can drive real simulation states through them in node.
 */
import * as THREE from 'three';
import { Sim } from '../src/sim/sim.js';
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { resolveSetup } from '../src/sim/cars.js';
import { Fx } from '../src/render/fx.js';

const DT = 1 / TUNING.SIM.HZ;
const F = TUNING.FX;
const mkRand = () => { let s = 0x9e3779b9; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
const setupFor = (car) => resolveSetup({
  car, livery: 'stock', tune: { weight: .5, suspension: .5, thrust: .5, aero: .5 },
  parts: { doors: 'stock', hood: 'stock', trunk: 'stock', spoiler: 'stock' },
});
const newFx = () => new Fx(new THREE.Scene(), { style: 'neon' });

// ── 1. Smoke tracks slip, and only slip ───────────────────────────────────
function smokeFor(slipAngle, airborne, speed) {
  const fx = newFx(); const rand = mkRand();
  const state = {
    slipAngle, airborne, groundSpeed: speed, wheelsInContact: 4,
    position: { x: 0, y: 1, z: 0 }, forward: { x: 0, y: 0, z: -1 }, thrustActive: false,
  };
  for (let i = 0; i < 60; i++) { fx.emit(DT, state, rand); }
  return fx.update(DT);
}
const gripping = smokeFor(0.05, false, 40);
const sliding = smokeFor(0.55, false, 40);
const slidingInAir = smokeFor(0.55, true, 40);
const slidingSlow = smokeFor(0.55, false, 2);

// ── 2. A crash throws more than a landing ─────────────────────────────────
function burst(evt, impact) {
  const fx = newFx(); const rand = mkRand();
  const car = { position: { x: 0, y: 1, z: 0 }, linvel: { x: 0, y: -12, z: -30 } };
  fx.onEvent(evt(impact), car, rand);
  return { live: fx.update(DT), shake: fx.shake };
}
const soft = burst((v) => ({ type: 'landed', result: { landed: true }, landing: { impactVel: v, counted: true } }), 6);
const hard = burst((v) => ({ type: 'landed', result: { landed: true }, landing: { impactVel: v, counted: true } }), 24);
const crash = burst((v) => ({ type: 'landed', result: { landed: false }, landing: { impactVel: v, counted: true } }), 24);

// ── 3. Shake decays rather than sticking ──────────────────────────────────
const decayFx = newFx();
decayFx.impulse(1);
for (let i = 0; i < Math.round(1.2 / DT); i++) decayFx.update(DT);
const shakeAfter = decayFx.shake;

// ── 4. A real run never overruns the pool ─────────────────────────────────
const sim = await Sim.create(setupFor('drifter'), 'park');
sim.run.begin();
const fx = newFx(); const rand = mkRand();
let peak = 0, total = 0;
for (let i = 0; i < Math.round(20 / DT); i++) {
  sim.step(DT, { ...NEUTRAL_ACTIONS, throttle: 1, steer: i * DT > 3 ? 0.7 : 0, boost: i * DT < 4 }, {});
  const state = sim.snapshot();
  for (const e of sim.drainEvents()) fx.onEvent(e, sim.car, rand);
  fx.emit(DT, state, rand);
  const live = fx.update(DT);
  peak = Math.max(peak, live);
  total += live;
}

console.log('\n── particles as a response to the car ──\n');
console.log(`gripping at 40 m/s (slip 0.05)           ${gripping} particles`);
console.log(`sliding at 40 m/s  (slip 0.55)           ${sliding} particles`);
console.log(`sliding, but airborne                    ${slidingInAir} particles`);
console.log(`sliding, but at 2 m/s                    ${slidingSlow} particles`);
console.log('');
console.log(`soft landing (6 m/s)                     ${soft.live} particles, shake ${soft.shake.toFixed(2)}`);
console.log(`hard landing (24 m/s)                    ${hard.live} particles, shake ${hard.shake.toFixed(2)}`);
console.log(`crash (24 m/s)                           ${crash.live} particles, shake ${crash.shake.toFixed(2)}`);
console.log(`shake 1.2 s after a full impulse         ${shakeAfter.toFixed(3)}`);
console.log('');
console.log(`peak live particles over a 20 s drift    ${peak} of ${F.MAX_PARTICLES}`);

const quietWhenGripping = gripping === 0;
const smokesWhenSliding = sliding > 20;
const notInAir = slidingInAir === 0;
const notWhenSlow = slidingSlow < sliding * 0.3;
const crashIsBigger = crash.live > hard.live * 1.4 && hard.live > soft.live;
const shakeDecays = shakeAfter < 0.02;
const withinPool = peak <= F.MAX_PARTICLES;

console.log('');
if (!quietWhenGripping) console.log('  a car with grip is making smoke');
if (!smokesWhenSliding) console.log('  a sliding car is not making smoke');
if (!notInAir) console.log('  the tyres smoke while airborne');
if (!notWhenSlow) console.log('  a stationary car smokes as hard as a sliding one');
if (!crashIsBigger) console.log('  a crash does not throw more than a landing');
if (!shakeDecays) console.log('  camera shake never settles');
if (!withinPool) console.log('  the pool overruns');

const ok = quietWhenGripping && smokesWhenSliding && notInAir && notWhenSlow
  && crashIsBigger && shakeDecays && withinPool;
console.log('\ngate: smoke only where the tyres slip, a crash throws more than a landing,');
console.log('      shake settles, and a real run stays inside the pool');
console.log(ok ? 'PASS  the effects are a response, not decoration' : 'FAIL  the effects are decoration');
if (!ok) process.exitCode = 1;
