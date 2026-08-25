/**
 * The soundscape, measured (R7).
 *
 * "Audio may be half the AAA illusion... leaving the ramp should change the
 * entire soundscape: engine and road rumble become wind and mechanical
 * stress." That is a claim about levels over time, and levels over time are
 * numbers, so it does not have to be taken on trust.
 *
 * The mix is a pure model (src/audio/mix.js) with no Web Audio in it, so a
 * real run can be driven through it in node and the claims checked:
 *
 *   · at the lip, the air voices overtake the ground voices, fast
 *   · on touchdown they hand back
 *   · a big stick ducks the bed and a hop does not
 *   · the room reacts to what happened rather than droning
 */
import { Sim } from '../src/sim/sim.js';
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { resolveSetup } from '../src/sim/cars.js';
import { Mixer } from '../src/audio/mix.js';

const DT = 1 / TUNING.SIM.HZ;
const A = TUNING.AUDIO;
const setup = resolveSetup({
  car: 'vector', livery: 'stock',
  tune: { weight: .5, suspension: .5, thrust: .5, aero: .5 },
  parts: { doors: 'stock', hood: 'stock', trunk: 'stock', spoiler: 'stock' },
});

// Five hero jumps rather than one scripted 90-second run. The loop driver is a
// smoke test — it produces two real flights on a good night, and a claim about
// what happens at the lip needs more lips than that to stand on. Each jump is
// the same deterministic drive the landing gate already uses, flown with a
// different air input so the flights are not identical.
const HOLDS = [{}, { doorL: 1 }, { hood: 0.5 }, { doorL: 1, doorR: 1 }, { spoiler: 1 }];

const airShare = (mix) => {
  const air = mix.airVoices(), ground = mix.groundVoices();
  return air / Math.max(1e-4, air + ground);
};

const MIN_FLIGHT = 0.6;   // shorter than this is a kerb, not a jump
const ROLLING = 12;       // m/s below which a landing has no road noise to make
const flips = [], returns = [];
let crowdMin = Infinity, crowdMax = 0, wheelLifts = 0;

for (const hold of HOLDS) {
  const sim = await Sim.create(setup, 'park');
  sim.run.begin();
  const mix = new Mixer();
  let t = 0, launchT = null, flip = null, ret = null;

  for (let i = 0; i < Math.round(12 / DT); i++) {
    const airborne = sim.airborne && launchT !== null;
    const since = airborne ? t - launchT : 0;
    const holding = airborne && since > 0.3 && since < 1.1;
    sim.step(DT, { ...NEUTRAL_ACTIONS, throttle: 1, boost: t < 4.6, ...(holding ? hold : {}) }, {});
    t += DT;

    for (const e of sim.drainEvents()) {
      mix.onEvent(e);
      if (e.type === 'launch' && e.launch.armed && launchT === null) {
        launchT = t; wheelLifts++;
        flip = { at: t, before: airShare(mix), after: null };
      }
      if (e.type === 'landed' && launchT !== null && e.landing && e.landing.airtime > MIN_FLIGHT && !ret) {
        ret = { at: t, after: null, rolled: false };
      }
    }

    mix.update(DT, sim.snapshot());
    const share = airShare(mix);
    crowdMin = Math.min(crowdMin, mix.crowd);
    crowdMax = Math.max(crowdMax, mix.crowd);

    if (flip && flip.after === null && t - flip.at < 1.0 && share > 0.65) flip.after = t - flip.at;
    if (ret) {
      const speed = sim.snapshot().groundSpeed || 0;
      if (t - ret.at < 1.5 && speed > ROLLING) ret.rolled = true;
      if (ret.after === null && t - ret.at < 1.5 && share < 0.45) ret.after = t - ret.at;
    }
  }

  if (flip && flip.after !== null && flip.before < 0.55) flips.push(flip.after);
  if (ret && ret.after !== null && ret.rolled) returns.push(ret.after);
}

const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

// The duck is measured on the model directly rather than off the run. The
// scripted driver banks a few thousand on a good night and the deep duck is
// reserved for five figures, so a driven run simply cannot show both ends of
// it — and "we never observed the feature" is not evidence the feature works.
function duckFloor(payout) {
  const m = new Mixer();
  for (let i = 0; i < 30; i++) m.update(DT, { groundSpeed: 40, airborne: false });
  m.onEvent({ type: 'landed', result: { landed: true, total: payout } });
  let floor = 1;
  for (let i = 0; i < Math.round(1.2 / DT); i++) {
    m.update(DT, { groundSpeed: 40, airborne: false });
    floor = Math.min(floor, m.duck);
  }
  return floor;
}
function duckRecovers(payout) {
  const m = new Mixer();
  m.onEvent({ type: 'landed', result: { landed: true, total: payout } });
  for (let i = 0; i < Math.round(3.0 / DT); i++) m.update(DT, { groundSpeed: 40, airborne: false });
  return m.duck;
}
const bigFloor = duckFloor(60000);
const smallFloor = duckFloor(900);
const recovered = duckRecovers(60000);

console.log('\n── the soundscape over five hero jumps ──\n');
console.log(`real flights, measured                   ${flips.length} of ${wheelLifts} launches`);
console.log(`  the mix goes 65% air after             ${(avg(flips) * 1000).toFixed(0)} ms  (worst ${(Math.max(0, ...flips) * 1000).toFixed(0)} ms)`);
console.log(`landings back onto a rolling car         ${returns.length}`);
console.log(`  the mix is back under 45% air after    ${(avg(returns) * 1000).toFixed(0)} ms  (worst ${(Math.max(0, ...returns) * 1000).toFixed(0)} ms)`);
console.log(`the room, quietest -> loudest            ${crowdMin.toFixed(2)} -> ${crowdMax.toFixed(2)}`);
console.log('');
console.log(`a 60,000 stick pulls the bed to          ${bigFloor.toFixed(2)}`);
console.log(`a 900 hop pulls the bed to               ${smallFloor.toFixed(2)}`);
console.log(`and the bed is back up 3 s later at      ${recovered.toFixed(2)}`);

const flipOK = flips.length >= 2 && Math.max(...flips) < 0.30;
const backOK = returns.length >= 2 && Math.max(...returns) < 0.45;
const duckOK = bigFloor < 0.6;
const restraintOK = smallFloor > 0.75;
const recoverOK = recovered > 0.9;
const roomOK = crowdMax > crowdMin * 1.6;

console.log('');
if (!flipOK) console.log('  the lip does not read: the mix never goes air-dominant, or takes too long');
if (!backOK) console.log('  the landing does not read: the road never comes back under the car');
if (!duckOK) console.log('  a big stick does not duck the bed');
if (!restraintOK) console.log('  every hop ducks the bed, so ducking means nothing');
if (!recoverOK) console.log('  the bed never comes back up, so the duck is just a mix change');
if (!roomOK) console.log('  the room is a drone, not a reaction');

const ok = flipOK && backOK && duckOK && restraintOK && recoverOK && roomOK;
console.log('\ngate: the lip flips the soundscape inside 300 ms and hands back inside 450 ms,');
console.log('      a big stick ducks the bed below 0.6, a hop leaves it above 0.75, the room reacts');
console.log(ok ? 'PASS  the soundscape tracks the car' : 'FAIL  the soundscape is not doing its job');
if (!ok) process.exitCode = 1;
