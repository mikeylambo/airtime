/**
 * §R — does a clip actually re-simulate the run it recorded?
 *
 * The whole replay architecture rests on one claim: inputs + seed = the same
 * flight, bit for bit. Before this probe, that claim was a comment. It broke
 * in practice because traffic rerolled by *continuing* its RNG sequence, so a
 * recorded run (made after restartRun and a played-out countdown) met traffic
 * in a state playback (fresh world, countdown skipped) could never reproduce
 * — and reactive traffic is physical, so the divergence could rewrite the
 * ending of a clip.
 *
 * Three measurements:
 *   1. record a run the way the game does (restartRun, countdown, stream),
 *      then play the clip back in a fresh world via replayStart and compare
 *      the trajectory step for step;
 *   2. rewind in place (the scrub path) and compare against the first
 *      playback — the seek must be the same simulation, not a similar one;
 *   3. check the §R stamps and that a clip's meta is a snapshot, not a live
 *      reference into the recorder.
 */
import { Sim } from '../src/sim/sim.js';
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { resolveSetup } from '../src/sim/cars.js';
import { Recorder, Player, neutralActions } from '../src/sim/replay.js';
import { simVersion, SCHEMA_VERSION } from '../src/sim/version.js';
import { loopActions, loopEdges } from '../src/loop-demo.js';

const DT = 1 / TUNING.SIM.HZ;
const SECONDS = 40;

const profile = {
  car: 'vector', livery: 'stock',
  tune: { weight: .5, suspension: .5, thrust: .5, aero: .5 },
  parts: { doors: 'stock', hood: 'stock', trunk: 'stock', spoiler: 'stock' },
};
const setup = resolveSetup(profile);

const pos = (sim) => {
  const p = sim.car.position;
  return [p.x, p.y, p.z];
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ── 1. Record, exactly the way main.js does ────────────────────────────────
// The game rerolls each run under an explicit seed; the scripted driver is
// blind, so scan a few seeds for a round it survives — whatever happens under
// the chosen seed, playback must reproduce it, which is the entire point.
let A = null, rec = null, best = null, trajectory = null, roundSeed = 0;

for (let candidate = 1; candidate <= 12 && !best; candidate++) {
  roundSeed = (0x51ac0000 + candidate) >>> 0;
  A = await Sim.create(setup, 'park');
  A.restartRun('stunt', undefined, roundSeed);
  // The countdown is part of the world's history: the game steps it with
  // hands off the wheel before the recorder hears anything.
  while (!A.round.running) A.step(DT, NEUTRAL_ACTIONS);
  A.drainEvents();

  rec = new Recorder({
    arena: 'park', setup, profile,
    seed: A.roundSeed, duration: A.round.duration,
  });

  let t = 0, launchT = null, launchStep = 0;
  trajectory = [];
  const ctx = { thrusted: false, airborne: false, launchT: null, boost: 0, aim: null };

  while (t < SECONDS && !A.run.over) {
    ctx.airborne = A.airborne;
    ctx.launchT = launchT;
    ctx.boost = A.boost.value;
    ctx.car = A.car;
    ctx.park = A.park;
    const a = loopActions(t, NEUTRAL_ACTIONS, ctx);
    const e = loopEdges(t, DT, ctx);
    A.step(DT, rec.record(a, e), e);
    trajectory.push(pos(A));
    t += DT;
    for (const ev of A.drainEvents()) {
      if (ev.type === 'launch' && ev.launch.armed) { launchT = t; launchStep = rec.step; ctx.thrusted = false; }
      if (ev.type === 'landed' && ev.result && ev.result.total > (best ? best.total : 0)) {
        best = { total: ev.result.total, clip: rec.clip(launchStep, rec.step, { total: ev.result.total }) };
      }
    }
  }
}

if (!best) { console.log('FAIL  the scripted driver never landed anything under any seed'); process.exit(1); }
const clip = best.clip;
console.log(`recorded under seed ${roundSeed} · best landing ${best.total} · clip window [${clip.start}, ${clip.end}] of ${rec.step} steps`);

// ── 2. Fresh-world playback ────────────────────────────────────────────────
const B = await Sim.create(setup, 'park');
B.replayStart(clip.meta);

const play = (sim, player) => {
  const out = [];
  player.reset();
  while (player.step < clip.end) {
    const { actions, edges } = player.next();
    sim.step(DT, actions, edges);
    sim.drainEvents();
    out.push(pos(sim));
  }
  return out;
};

const played = play(B, new Player(clip));
let worst = 0, worstStep = 0;
for (let i = 0; i < played.length && i < trajectory.length; i++) {
  const d = dist(played[i], trajectory[i]);
  if (d > worst) { worst = d; worstStep = i; }
}
console.log(`fresh-world playback vs recording   worst ${worst.toExponential(2)} m at step ${worstStep}`);

// ── 3. Rewind (the scrub path): a rebuilt world, exactly like playClipFrom ──
// A reset-in-place world drifts by hundreds of metres (Rapier warm-start
// caches survive teleports), which is why the scrub rebuilds. Measure both so
// the drift is a number in the log, not folklore.
B.replayStart(clip.meta);
const inPlace = play(B, new Player(clip));
let driftInPlace = 0;
for (let i = 0; i < inPlace.length; i++) driftInPlace = Math.max(driftInPlace, dist(inPlace[i], played[i]));

const C = await Sim.create(setup, 'park');
C.replayStart(clip.meta);
const rewound = play(C, new Player(clip));
let worstR = 0;
for (let i = 0; i < rewound.length; i++) worstR = Math.max(worstR, dist(rewound[i], played[i]));
console.log(`rebuilt-world rewind vs playback    worst ${worstR.toExponential(2)} m  (in-place would drift ${driftInPlace.toFixed(1)} m — why the scrub rebuilds)`);

// ── 4. Stamps and snapshot independence ────────────────────────────────────
const stamped = clip.meta.sim === simVersion() && clip.meta.schema === SCHEMA_VERSION
  && clip.meta.seed === A.roundSeed && clip.meta.traffic === TUNING.TRAFFIC.MODE;
rec.meta.car = 'tampered';
const snapshot = clip.meta.car === 'vector';
console.log(`stamps  sim ${clip.meta.sim} · schema ${clip.meta.schema} · seed ${clip.meta.seed >>> 0} · ${stamped ? 'ok' : 'WRONG'}`);
console.log(`meta is a snapshot, not a reference  ${snapshot ? 'ok' : 'WRONG'}`);

// A replay is a re-simulation, so the bar is identity, not similarity. The
// tolerance exists only for float-order noise; today both measure exactly 0.
const ok = worst < 1e-9 && worstR < 1e-9 && stamped && snapshot;
console.log(ok
  ? '\nPASS  a clip is the run itself: playback and scrubbing reproduce it exactly'
  : '\nFAIL  playback diverged from the recording');
process.exit(ok ? 0 : 1);
