/**
 * R7's unpaid debts, measured.
 *
 * The premium pass held itself to one rule — the *decision* lives somewhere a
 * headless probe can drive it, never in the render loop next to the draw call
 * — and the five things it still owed are exactly the five most tempting
 * things in the game to fake. A dent nobody can see, a scuff that saturates
 * to black in ten minutes, a bollard that twitches, a brake light dressed up
 * as a temperature, a tannoy that talks over the engine: all of them look
 * finished in a screenshot and none of them survives a number.
 *
 * So:
 *
 * 1. **Deformation is physical, and only for a near-miss on a tear-off.**
 * 2. **Scuffing saturates, is directional, and never touches the simulation.**
 * 3. **Props break above a speed and are inert below it, with a budget.**
 * 4. **Brake heat is an integral** — it lags, it holds, and it stacks.
 * 5. **The PA is a room** — it never talks over itself, it owes silence, and
 *    the car ducks it rather than the other way round.
 *
 * And one thing that is not about any of them: an undamaged run must be
 * **bit-identical** to the same run before wear existed, or every clip in the
 * library is quietly orphaned by a system that was supposed to be inert.
 *
 *   node tools/probe-wear.mjs
 */

import TUNING from '../src/TUNING.js';
import { Sim } from '../src/sim/sim.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { resolveSetup } from '../src/sim/cars.js';
import { Wear, REGIONS, regionOf } from '../src/sim/wear.js';
import { BrakeHeat } from '../src/sim/brakes.js';
import { PA } from '../src/audio/pa.js';
import { signBrightness } from '../src/render/signs.js';
import { SLOTS } from '../src/sim/panels.js';
import { getArena } from '../src/arena/index.js';

const DT = 1 / TUNING.SIM.HZ;
const fails = [];
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(48)} ${detail}`);
  if (!ok) fails.push(label);
};
const setup = resolveSetup({
  car: 'vector', livery: 'stock',
  tune: { weight: .5, suspension: .5, thrust: .5, aero: .5 },
  parts: { doors: 'stock', hood: 'stock', trunk: 'stock', spoiler: 'stock' },
});

console.log('\n── R7\'s debts ──────────────────────────────────────────────\n');

// ── 1. Deformation ─────────────────────────────────────────────────────────
{
  const W = TUNING.WEAR;
  const w = new Wear();
  // A routine hard landing on a deployed panel strains the hinge at about
  // 12 m/s. That is not "nearly came off", and it must leave nothing.
  w.strain('SPOILER', 12.2);
  const routine = w.panelDamage('SPOILER');

  w.strain('SPOILER', TUNING.PANELS.TEAROFF_IMPACT_SPEED - 0.5);
  const nearly = w.panelDamage('SPOILER');

  check(routine === 0 && nearly > 0,
    'only a near-miss on a tear-off bends a panel',
    `12.2 m/s leaves ${routine.toFixed(2)}, ${(TUNING.PANELS.TEAROFF_IMPACT_SPEED - 0.5).toFixed(1)} leaves ${nearly.toFixed(2)}`);

  check(w.hingeSag('SPOILER') > 0 && w.hingeSag('DOOR_L') === 0,
    'a bent hinge rests open, and only that one',
    `spoiler sags ${(w.hingeSag('SPOILER') * 100).toFixed(0)}% of its open angle`);

  // The physical consequence, in the real solver: a car with a bent wing does
  // not fly the same line as a car without one. If it does, deformation is a
  // picture of damage rather than damage.
  const fly = async (damage) => {
    const sim = await Sim.create(setup, 'park');
    sim.restartRun('stunt', 20, 0x5eed1234);
    while (!sim.round.running) sim.step(DT, NEUTRAL_ACTIONS);
    const p = sim.players[0];
    // Every panel bent, which is what a car that has been thrown at a
    // building actually looks like. One bent wing is a smaller effect and a
    // weaker question.
    if (damage) { for (const slot of SLOTS) p.wear.panels[slot] = damage; p.panels.reset(); }
    for (let i = 0; i < Math.round(12 / DT); i++) {
      sim.step(DT, { ...NEUTRAL_ACTIONS, throttle: 1, boost: i * DT < 4.6 }, {});
    }
    const c = p.car.position;
    return { x: c.x, y: c.y, z: c.z };
  };
  const clean = await fly(0);
  const bent = await fly(1);
  const drift = Math.hypot(clean.x - bent.x, clean.y - bent.y, clean.z - bent.z);
  check(drift > 2, 'bent panels change where the car ends up',
    `${drift.toFixed(1)} m apart after 12 s on identical inputs`);

  // ...and an undamaged car must be exactly the car that existed before this
  // system did. Anything else orphans the clip library for nothing.
  const cleanAgain = await fly(0);
  const same = Math.hypot(clean.x - cleanAgain.x, clean.y - cleanAgain.y, clean.z - cleanAgain.z);
  check(same === 0, 'and an undamaged car is bit-identical to itself',
    `${same.toFixed(6)} m`);
}

// ── 2. Scuffing ────────────────────────────────────────────────────────────
{
  const w = new Wear();
  check(regionOf({ x: 0, y: 0, z: -1 }) === 'nose' && regionOf({ x: 0, y: -1, z: 0 }) === 'floor'
    && regionOf({ x: -1, y: 0, z: 0 }) === 'left',
    'an impact is attributed to a face of the car',
    'nose / floor / left all read correctly');

  for (let i = 0; i < 40; i++) w.scuffFrom({ x: 0, y: 0, z: -1 }, 0.6);
  const nose = w.scuffAt('nose');
  check(nose < 1 && nose > 0.9 && w.scuffAt('tail') === 0,
    'scuffing saturates, and stays where it was put',
    `40 nose hits -> nose ${nose.toFixed(3)}, tail ${w.scuffAt('tail').toFixed(3)}`);

  const noseBright = w.brightnessAt({ x: 0, y: 0, z: -1 });
  const tailBright = w.brightnessAt({ x: 0, y: 0, z: 1 });
  check(noseBright < tailBright && tailBright > 0.99,
    'the trim goes out where the car was hit, and only there',
    `nose ${noseBright.toFixed(2)} vs tail ${tailBright.toFixed(2)} of full brightness`);

  const small = new Wear();
  small.scuffFrom({ x: 0, y: 0, z: -1 }, TUNING.WEAR.SCUFF_MIN - 0.01);
  check(small.scuffAt('nose') === 0, 'a gentle touch leaves no mark',
    `below ${TUNING.WEAR.SCUFF_MIN} severity, nothing`);

  // Paint survives a run; panels do not. That split is the §R requirement.
  const sim = await Sim.create(setup, 'park');
  const p = sim.players[0];
  p.wear.scuffFrom({ x: 0, y: -1, z: 0 }, 0.8);
  p.wear.panels.HOOD = 0.7;
  p.reset();
  check(p.wear.scuffAt('floor') > 0 && p.wear.panelDamage('HOOD') === 0,
    'a new run straightens the panels and keeps the paint',
    `floor ${p.wear.scuffAt('floor').toFixed(2)}, hood ${p.wear.panelDamage('HOOD').toFixed(2)}`);
  p.wear.repair();
  check(p.wear.total === 0, 'the garage clears both', 'total 0');
}

// ── 3. Breakable props ─────────────────────────────────────────────────────
{
  const P = TUNING.PROPS;
  const city = getArena('city');
  check(city.props.length > 20, 'the city is full of things to break',
    `${city.props.length} props, and none of them in the routing graph`);
  check(getArena('park').props.length === 0,
    'the void-space arena has none, deliberately',
    'clutter on the floor of The Yard argues with what The Yard is');

  // Nothing stands inside anything solid — the filter in city-block.js.
  let inside = 0;
  for (const prop of city.props) {
    for (const s of city.structures) {
      if (Math.abs(prop.pos.x - s.pos.x) > s.half.x + prop.half.x) continue;
      if (Math.abs(prop.pos.z - s.pos.z) > s.half.z + prop.half.z) continue;
      if (prop.pos.y - prop.half.y > s.pos.y + s.half.y) continue;
      inside++;
      break;
    }
  }
  check(inside === 0, 'and none of them is standing inside a building', `${inside} embedded`);

  // Below the threshold nothing moves. This is the whole rule: a bollard that
  // twitches when you brush it promises physics it is not running.
  const run = async (speed) => {
    const sim = await Sim.create(setup, 'city');
    sim.restartRun('stunt', 20, 1);
    while (!sim.round.running) sim.step(DT, NEUTRAL_ACTIONS);
    const p = sim.players[0];
    const prop = sim.props.items[0];
    const at = prop.body.translation();
    let broke = 0;
    for (let i = 0; i < 40; i++) {
      // Park the car on the prop at a chosen speed, the way the impact would.
      p.car.body.setTranslation({ x: at.x, y: at.y + 0.6, z: at.z }, true);
      p.car.body.setLinvel({ x: speed, y: 0, z: 0 }, true);
      sim.step(DT, NEUTRAL_ACTIONS, {});
      for (const e of sim.drainEvents()) if (e.type === 'prop') broke++;
    }
    return { broke, live: sim.props.live };
  };
  const slow = await run(P.BREAK_SPEED - 2);
  const fast = await run(P.BREAK_SPEED + 12);
  check(slow.broke === 0 && fast.broke > 0,
    'props break above a speed and are inert below it',
    `${(P.BREAK_SPEED - 2).toFixed(0)} m/s breaks ${slow.broke}, ${(P.BREAK_SPEED + 12).toFixed(0)} m/s breaks ${fast.broke}`);
  check(fast.live <= P.BUDGET, 'and the budget holds',
    `${fast.live} live of ${P.BUDGET} allowed`);
}

// ── 4. Brake heat ──────────────────────────────────────────────────────────
{
  const B = TUNING.BRAKES;
  const b = new BrakeHeat();
  // It lags: one frame of full brake at speed is not a glowing disc.
  b.update(DT, 1, 60, true);
  const oneFrame = b.glow;

  for (let i = 0; i < Math.round(2.5 / DT); i++) b.update(DT, 1, 55, true);
  const afterStop = b.glow;
  check(oneFrame === 0 && afterStop > 0.2, 'brake heat lags the pedal',
    `one frame ${oneFrame.toFixed(2)}, two and a half seconds ${afterStop.toFixed(2)}`);

  // It holds: still hot a second after you come off the brakes. Measured on
  // heat rather than glow, because the glow threshold is a display decision
  // and this is a question about the metal.
  const hot = b.heat;
  for (let i = 0; i < Math.round(1 / DT); i++) b.update(DT, 0, 55, true);
  check(b.heat > hot * 0.4, 'and holds after the pedal comes up',
    `${(b.heat / hot * 100).toFixed(0)}% of its heat a second later, still glowing at ${b.glow.toFixed(2)}`);

  // A brake in mid-air heats nothing, and the car is airborne a third of its
  // life in this game.
  const air = new BrakeHeat();
  for (let i = 0; i < Math.round(3 / DT); i++) air.update(DT, 1, 60, false);
  check(air.heat === 0, 'and a brake in mid-air heats nothing', `${air.heat.toFixed(3)}`);

  // It is work, not pressure: the same pedal at a crawl does far less.
  const fast = new BrakeHeat();
  const slow = new BrakeHeat();
  for (let i = 0; i < Math.round(2 / DT); i++) {
    fast.update(DT, 1, 60, true);
    slow.update(DT, 1, 8, true);
  }
  check(fast.heat > slow.heat * 4, 'and it is work, not pedal pressure',
    `at 60 m/s ${fast.heat.toFixed(2)} vs at 8 m/s ${slow.heat.toFixed(2)}`);
}

// ── 5. Active billboards ───────────────────────────────────────────────────
{
  const S = TUNING.SIGNS;
  const sign = { aim: { x: 0, y: 25, z: 0 } };
  const at = (pos, vel, airborne) => signBrightness(sign, {
    position: pos, velocity: vel, airborne,
  }).level;

  const aimed = at({ x: 0, y: 20, z: 60 }, { x: 0, y: 4, z: -40 }, true);
  const away = at({ x: 0, y: 20, z: 60 }, { x: 0, y: 4, z: 40 }, true);
  const grounded = at({ x: 0, y: 1, z: 60 }, { x: 0, y: 0, z: -40 }, false);
  check(aimed > away && away === S.IDLE && grounded === S.IDLE,
    'a sign lights for a flight aimed at it, and only then',
    `aimed ${aimed.toFixed(2)}, away ${away.toFixed(2)}, on the ground ${grounded.toFixed(2)}`);

  const near = at({ x: 0, y: 22, z: 30 }, { x: 0, y: 0, z: -40 }, true);
  const far = at({ x: 0, y: 22, z: 200 }, { x: 0, y: 0, z: -40 }, true);
  check(near > far, 'and brighter the closer it is to being reachable',
    `${far.toFixed(2)} at 200 m -> ${near.toFixed(2)} at 30 m`);

  const hit = signBrightness(sign, null, 0.0);
  const cooled = signBrightness(sign, null, S.FLASH_TIME + 0.01);
  check(hit.level === 1 && hit.flash > 0 && cooled.level <= S.LIVE,
    'landing on one punches it, briefly',
    `flash capped at ${(S.FLASH_TIME * 1000).toFixed(0)} ms — the art brief's photosensitivity number`);
}

// ── 6. The PA ──────────────────────────────────────────────────────────────
{
  const P = TUNING.PA;
  const pa = new PA();
  pa.setArena('park');
  check(!pa.say('huge'), 'the PA is an arena property',
    'a stunt park in a void has nobody to announce anything');

  pa.setArena('city');
  check(pa.say('huge'), 'and a city has one', 'it takes the call');

  // It never talks over itself with something less important.
  check(!pa.say('crash'), 'it does not talk over itself', 'a crash cannot interrupt a big stick');
  check(pa.say('record'), 'unless it is more important', 'a personal best can');

  // Run it out and confirm it owes silence afterwards.
  let t = 0;
  while (pa.speaking && t < 10) { pa.update(DT, 0); t += DT; }
  check(!pa.say('huge'), 'and it owes silence between calls', `${P.COOLDOWN}s of it`);
  for (let i = 0; i < Math.round(P.COOLDOWN / DT) + 4; i++) pa.update(DT, 0);
  check(pa.say('huge'), 'then it will speak again', 'cooldown expired');

  // The car ducks the PA, not the other way round.
  const quiet = new PA(); quiet.setArena('city'); quiet.say('huge');
  const busy = new PA(); busy.setArena('city'); busy.say('huge');
  for (let i = 0; i < 30; i++) { quiet.update(DT, 0); busy.update(DT, 1); }
  check(busy.level < quiet.level && quiet.duck < 1,
    'a busy car pushes the PA down, and the PA pushes the bed down',
    `level ${busy.level.toFixed(3)} busy vs ${quiet.level.toFixed(3)} quiet; bed duck ${quiet.duck.toFixed(2)}`);
}

console.log('');
console.log(fails.length
  ? `FAIL  ${fails.length} of R7's debts are not actually paid`
  : 'PASS  the debts are paid, and none of them is a picture of itself');
process.exit(fails.length ? 1 : 0);
