/**
 * R8's gate, beyond the reachability graph.
 *
 * `npm run lines -- --city` proves Vertical City is a network. It cannot
 * prove the three things the arena was actually built to do, because all
 * three are claims about the simulation rather than about the geometry:
 *
 * 1. **The Coil is a road.** A spiral flyover assembled out of ten wedges
 *    either carries a car to the top or trips it on a seam at the first
 *    joint, and the difference is invisible in a reachability report — the
 *    analyzer skips transit ramps precisely because they are not launches.
 * 2. **The strata are real.** The city's routing idea is that altitude is a
 *    currency, which is only true if a launch from each stratum can reach
 *    the one above it. That is a statement about arcs, so measure arcs.
 * 3. **The acceptance clip has its furniture.** The vision's ten-second shot
 *    needs a skyscraper to leave, a helicopter to miss, and a parking garage
 *    to land on — and the near-miss has to *pay*, which it did not until
 *    movers learned the rule that only traffic knew.
 *
 *   node tools/probe-city.mjs
 */

import TUNING from '../src/TUNING.js';
import { Sim } from '../src/sim/sim.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { resolveSetup } from '../src/sim/cars.js';
import { rampSurface, rampExitAngle } from '../src/arena/index.js';
import { predictArc } from '../src/sim/airtime.js';
import { CITY } from '../src/arena/city-block.js';

const DT = 1 / TUNING.SIM.HZ;
const profile = {
  car: 'vector', livery: 'stock',
  tune: { weight: .5, suspension: .5, thrust: .5, aero: .5 },
  parts: { doors: 'stock', hood: 'stock', trunk: 'stock', spoiler: 'stock' },
};
const setup = resolveSetup(profile);
const fails = [];
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} ${detail}`);
  if (!ok) fails.push(label);
};

console.log('\n── Vertical City (R8) ──────────────────────────────────────\n');

// ── 1. The Coil is a road ──────────────────────────────────────────────────
{
  const sim = await Sim.create(setup, 'city');
  sim.restartRun('stunt');
  sim.run.begin();
  for (let i = 0; i < Math.ceil(TUNING.RUN.COUNTDOWN / DT) + 6; i++) sim.step(DT, NEUTRAL_ACTIONS, {});

  const segs = sim.park.ramps.filter((r) => r.id.startsWith('coil_s'));
  // The entrance is the low end of the first segment: its own zMax corner,
  // carried out of the ramp's frame.
  const first = segs[0];
  const s = rampSurface(first);
  const c = Math.cos(first.yaw), sn = Math.sin(first.yaw);
  const mouth = { x: first.pos.x + s.zMax * sn, z: first.pos.z + s.zMax * c };
  const heading = first.yaw;                       // straight up the ramp
  const back = 34;
  const p = sim.players[0];
  p.place({ x: mouth.x + Math.sin(heading) * back, y: 1.2, z: mouth.z + Math.cos(heading) * back },
    heading);
  p.car.body.setLinvel({ x: -Math.sin(heading) * 22, y: 0, z: -Math.cos(heading) * 22 }, true);

  // Drive it the way a player does. Two phases — aim at the mouth until the
  // car is on the spiral, then chase a point 18 m further round the circle —
  // and steer on heading error, because a spiral driven in a straight line
  // proves nothing about the surface. The question is whether the geometry
  // carries a car that is genuinely trying to follow it.
  const centre = { x: -CITY.P, z: CITY.P };
  const R = Math.hypot(mouth.x - centre.x, mouth.z - centre.z);
  const LOOK = 18;
  let top = 0;
  for (let i = 0; i < Math.round(15 / DT); i++) {
    const cp = p.car.position;
    const rad = Math.hypot(cp.x - centre.x, cp.z - centre.z);
    let tx, tz;
    if (Math.abs(rad - R) > 6) { tx = mouth.x; tz = mouth.z; }
    else {
      const a = Math.atan2(cp.x - centre.x, cp.z - centre.z) + LOOK / R;
      tx = centre.x + Math.sin(a) * R; tz = centre.z + Math.cos(a) * R;
    }
    const f = p.car.forward;
    // Headings in the game's own convention: forward is (-sin h, -cos h).
    const hCar = Math.atan2(-f.x, -f.z);
    const hWant = Math.atan2(-(tx - cp.x), -(tz - cp.z));
    let err = hWant - hCar;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    const steer = Math.max(-1, Math.min(1, -err * 1.8));
    // Ease off above the corner's speed: this is a road, not a straight.
    const sp = Math.hypot(p.car.linvel.x, p.car.linvel.z);
    sim.step(DT, { ...NEUTRAL_ACTIONS, throttle: sp < 19 ? 1 : 0.25, steer }, {});
    top = Math.max(top, p.car.position.y);
  }
  const target = CITY.COIL_TOP - 3;
  check(top >= target, 'a car drives the Coil to the top deck',
    `reached ${top.toFixed(1)} m of ${CITY.COIL_TOP}`);
}

// ── 2. Each stratum can reach the one above it ─────────────────────────────
{
  const sim = await Sim.create(setup, 'city');
  sim.world.step();
  const park = sim.park;
  const C = TUNING.CAR;
  const meanArea = (4 * C.HALF.y * C.HALF.z + 4 * C.HALF.x * C.HALF.z + 4 * C.HALF.x * C.HALF.y) / 3;
  const dragK = (0.5 * TUNING.AERO.AIR_DENSITY * meanArea * TUNING.AERO.CHASSIS_CD) / C.MASS;

  // The band a car actually leaves a kicker in — the same one the gap
  // generator calls realistic. A stratum you can only reach at the top of the
  // sweep is not reachable, it is a stunt.
  const SPEEDS = [44, 50, 56, 62];
  const apexOf = (r, speed) => {
    const s = rampSurface(r), ang = rampExitAngle(r);
    const cc = Math.cos(r.yaw), sn = Math.sin(r.yaw);
    const pos = { x: r.pos.x + s.zMin * sn, y: r.pos.y + s.y(s.zMin) + 1, z: r.pos.z + s.zMin * cc };
    const horiz = Math.cos(ang) * speed;
    const vel = { x: -sn * horiz, y: Math.sin(ang) * speed, z: -cc * horiz };
    return predictArc(sim.world, pos, vel, TUNING.SIM.GRAVITY, dragK, 9, 1 / 40).apexHeight;
  };

  const LADDER = [
    { name: 'street -> mezz', from: (r) => r.pos.y < 2, reach: CITY.MEZZ },
    { name: 'mezz -> roofs', from: (r) => r.pos.y >= CITY.MEZZ - 1 && r.pos.y < 20, reach: 30 },
    { name: 'roofs -> the spire', from: (r) => r.pos.y >= 24 && r.pos.y < 40, reach: CITY.SPIRE },
  ];
  const launchable = park.ramps.filter((r) => !r.transit && rampExitAngle(r) <= 0.95);
  for (const rung of LADDER) {
    const src = launchable.filter(rung.from);
    let best = 0, who = '';
    for (const r of src) {
      for (const sp of SPEEDS) {
        const a = apexOf(r, sp);
        if (a > best) { best = a; who = `${r.id} @${sp}`; }
      }
    }
    check(best >= rung.reach, `${rung.name} is inside one apex`,
      `${src.length} launches, best apex ${best.toFixed(0)} m vs ${rung.reach} needed (${who})`);
  }
}

// ── 3. The acceptance clip's furniture, and the near miss that pays ────────
{
  const sim = await Sim.create(setup, 'city');
  const park = sim.park;

  const spire = park.targets.find((t) => t.id === 'spire');
  check(!!spire && spire.aim.y >= 40, 'a skyscraper to leave',
    spire ? `spire roof at ${spire.aim.y} m` : 'no spire');

  const decks = park.targets.filter((t) => t.id.startsWith('stack_d'));
  check(decks.length >= 3, 'a parking garage to land on',
    `${decks.length} decks at ${decks.map((d) => d.aim.y.toFixed(0)).join(' / ')} m`);

  const heli = sim.movers.items.find((m) => m.spec.kind === 'heli');
  check(!!heli, 'a helicopter to miss', heli ? `hovers at ${heli.spec.y} m` : 'no helicopter');

  // Fly past it and see whether the pass is worth anything. Traffic's near
  // miss rule disqualifies you the moment the wheels leave the road, which is
  // every moment of this shot.
  sim.restartRun('stunt');
  sim.run.begin();
  for (let i = 0; i < Math.ceil(TUNING.RUN.COUNTDOWN / DT) + 6; i++) sim.step(DT, NEUTRAL_ACTIONS, {});
  const p = sim.players[0];
  let credited = 0, closest = Infinity;
  for (let i = 0; i < 90; i++) {
    p.car.body.setTranslation({ x: heli.x - 40 + i, y: heli.y, z: heli.z + 4 }, true);
    p.car.body.setLinvel({ x: 60, y: 0, z: 0 }, true);
    sim.step(DT, NEUTRAL_ACTIONS, {});
    closest = Math.min(closest, Math.hypot(p.car.position.x - heli.x,
      p.car.position.y - heli.y, p.car.position.z - heli.z));
    for (const ev of sim.drainEvents()) if (ev.type === 'nearMiss') credited += ev.per[0];
  }
  check(credited > 0, 'passing the helicopter pays a near miss',
    `${credited} credited, closest ${closest.toFixed(1)} m`);
}

console.log('');
console.log(fails.length
  ? `FAIL  ${fails.length} of the city's claims do not hold`
  : 'PASS  the city is an instrument, and the acceptance clip has its furniture');
process.exit(fails.length ? 1 : 0);
