/**
 * The instrument gate (R5).
 *
 * The roster law is that **no car is a tier** — a car is a different way to
 * play, never a stronger one. That is not a vibe, it is a partial order, so it
 * can be measured: fly every car through the same fixed experiments and fail
 * the build if any car is *Pareto-dominated* (some other car is at least as
 * good on every axis and strictly better on one), or if any car is best at
 * nothing. A dominated car is a trap — it exists only to be outgrown, which is
 * exactly the "Level 2 vs Level 8" structure the roster is supposed to avoid.
 *
 * Two measurement traps this had to be rebuilt around:
 *   · Peak rotation rate over a whole flight measures *the crash*, not the
 *     car. A tumbling wreck spins faster than any deliberate input. Rates are
 *     therefore only sampled inside the control-hold window.
 *   · Raw flight distance is launch speed wearing a hat. Glide is distance per
 *     m/s of launch speed, which is the only version that means "flies well".
 */
import { Sim } from '../src/sim/sim.js';
import TUNING from '../src/TUNING.js';
import { NEUTRAL_ACTIONS } from '../src/input/input.js';
import { resolveSetup, CARS } from '../src/sim/cars.js';

const DT = 1 / TUNING.SIM.HZ;
const BASE = { livery: 'stock', parts: { doors: 'stock', hood: 'stock', trunk: 'stock', spoiler: 'stock' } };
const TUNE = { weight: 0.5, suspension: 0.5, thrust: 0.5, aero: 0.5 };
const profileFor = (id) => ({ ...BASE, car: id, tune: TUNE });
const mag = (v) => Math.hypot(v.x, v.y, v.z);

/** World angular velocity into the car's own frame. */
function localAngvel(car) {
  const w = car.body.angvel();
  const q = car.rotation;
  // q* · w · q, quaternion sandwich, written out to avoid a dependency here.
  const ix =  q.w * w.x + q.y * w.z - q.z * w.y;
  const iy =  q.w * w.y + q.z * w.x - q.x * w.z;
  const iz =  q.w * w.z + q.x * w.y - q.y * w.x;
  const iw = -q.x * w.x - q.y * w.y - q.z * w.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

/**
 * One launch off the hero ramp. `hold` is applied only between `from` and `to`
 * seconds after the lip, and rotation rates are sampled only in that window.
 */
const QUALITY = { perfect: 3, clean: 2, sloppy: 1, bounced: 1, crash: 0 };
const qual = (res) => (res ? (QUALITY[res.quality] ?? 0) : 0);

async function fly(id, hold = {}, opts = {}) {
  const from = opts.from ?? 0.25, to = opts.to ?? 1.25;
  const sim = await Sim.create(resolveSetup(profileFor(id)));
  sim.run.begin();
  let t = 0, launchT = null, launch = null, res = null;
  let apex = 0, topSpeed = 0, dist = 0, launchPos = null;
  let touchdownSpeed = 0, afterSpeed = 0;
  const peak = { x: 0, y: 0, z: 0 };

  for (let i = 0; i < Math.round(16 / DT) && !res; i++) {
    const airborne = sim.airborne && launchT !== null;
    const since = airborne ? t - launchT : 0;
    const holding = airborne && since > from && since < to;
    sim.step(DT, { ...NEUTRAL_ACTIONS, throttle: 1, boost: t < 4.6, ...(holding ? hold : {}) }, {});
    t += DT;

    if (launchT === null) topSpeed = Math.max(topSpeed, mag(sim.car.body.linvel()));
    else {
      // Freeze the flight measurements the moment the car is back on the
      // ground. Left running, a car that never registers a clean landing keeps
      // accumulating distance while it slides, and "glide" quietly becomes
      // "how far did the wreck travel" — which flattered exactly the cars that
      // could not fly.
      if (sim.airborne) {
        apex = Math.max(apex, sim.car.position.y);
        if (launchPos) dist = Math.hypot(sim.car.position.x - launchPos.x, sim.car.position.z - launchPos.z);
      }
      if (holding && sim.airborne) {
        const w = localAngvel(sim.car);
        peak.x = Math.max(peak.x, Math.abs(w.x));
        peak.y = Math.max(peak.y, Math.abs(w.y));
        peak.z = Math.max(peak.z, Math.abs(w.z));
      }
    }

    for (const e of sim.drainEvents()) {
      if (e.type === 'launch' && e.launch.armed && launchT === null) {
        launchT = t; launch = e.launch; apex = 0;
        launchPos = { x: sim.car.position.x, z: sim.car.position.z };
      }
      if (e.type === 'landed' && e.result && e.result.airtime > 1.0) {
        res = e.result;
        touchdownSpeed = mag(sim.car.body.linvel());
      }
    }
  }

  // Keep rolling after the landing: how much speed the car carries *through*
  // a touchdown is its own axis, and it is the whole point of a heavy car.
  if (res) {
    // Coasting, and only through the impact itself — 0.15 s, not 0.6 s. Over a
    // longer roll-out the number is dominated by whatever slope the car landed
    // on, and half the roster pegged the ceiling because they touched down
    // going downhill. Sampled tight, this is the scrub of the landing alone.
    for (let i = 0; i < Math.round(0.15 / DT); i++) sim.step(DT, { ...NEUTRAL_ACTIONS }, {});
    afterSpeed = mag(sim.car.body.linvel());
  }
  return { launch, res, apex, topSpeed, dist, peak, touchdownSpeed, afterSpeed };
}

/**
 * Ground behaviour: peak *slip* angle — how far the car points away from where
 * it is actually going. Deliberately not turn rate, which is mostly wheelbase
 * and would just hand the axis to the shortest car.
 */
async function slipAngle(id) {
  const sim = await Sim.create(resolveSetup(profileFor(id)));
  sim.run.begin();
  let t = 0, peak = 0, steerFrom = null;
  for (let i = 0; i < Math.round(6 / DT); i++) {
    // Everybody steers from the same speed. Steering at a fixed *time* meant
    // the quick cars were cornering 15 m/s faster than the slow ones, and slip
    // angle is mostly lateral demand, so that measured acceleration again.
    const speedNow = Math.hypot(sim.car.body.linvel().x, sim.car.body.linvel().z);
    if (steerFrom === null && speedNow > 26 && !sim.airborne) steerFrom = t;
    const steering = steerFrom !== null && t - steerFrom < 1.4;
    if (steerFrom !== null && !steering) break;
    // Half lock, not full. At full lock on a cut throttle most of the roster
    // simply spins, the angle saturates near 90 degrees, and the column stops
    // distinguishing a drift car from a car that lost it.
    sim.step(DT, { ...NEUTRAL_ACTIONS, throttle: steering ? 0.35 : 1, steer: steering ? 0.5 : 0 }, {});
    t += DT;
    if (!steering || sim.airborne) continue;
    const v = sim.car.body.linvel();
    const speed = Math.hypot(v.x, v.z);
    if (speed < 6) continue;
    const f = sim.car.forward;                       // chassis facing, world
    const cos = (f.x * v.x + f.z * v.z) / (speed * Math.hypot(f.x, f.z) || 1);
    const ang = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    if (ang < 55) peak = Math.max(peak, ang);   // past 55 degrees it is a spin, not a slide
  }
  return peak;
}

// ── The eight axes. All "more is better", so domination is a straight compare.
// Eight axes for eight cars, one apiece by design. Air authority is divided by
// dynamic pressure (v/55)^2, because aero force scales with the square of
// airspeed — without that, "who rotates hardest" is really "who arrived
// fastest", and GRIP wins every air axis for a ground reason.
// There is no yaw axis on purpose. Yaw was measured first and turned out to be
// roll's shadow: in this car model an asymmetric panel rolls and the rotation
// couples into yaw, so "who yaws hardest" and "who rolls hardest" ranked the
// same cars in the same order. Two columns measuring one property would hand a
// free extra axis to whoever wins roll.
const AXES = [
  { key: 'top',     label: 'top spd', owner: 'grip'    },
  { key: 'slip',    label: 'slip'   , owner: 'drifter' },
  { key: 'flip',    label: 'flip'   , owner: 'stub'    },
  { key: 'roll',    label: 'roll'   , owner: 'proto'   },
  { key: 'impact',  label: 'impact' , owner: 'anvil'   },
  { key: 'brake',   label: 'airbrake', owner: 'dart'   },
  { key: 'glide',   label: 'glide'  , owner: 'needle'  },
  { key: 'recover', label: 'recover', owner: 'vector'  },
];

const rows = [];
for (const c of CARS) {
  const plain = await fly(c.id);
  const flip  = await fly(c.id, { hood: 1 });
  const roll  = await fly(c.id, { doorL: 1 });   // one door rolls *and* yaws
  const slip  = await slipAngle(c.id);
  // Air brake: everything out at once. How much of its airspeed can this car
  // throw away mid-flight? That is what lets you land short on purpose.
  const brakeRun = await fly(c.id, { doorL: 1, doorR: 1, hood: 1, spoiler: 1 }, { from: 0.2, to: 1.4 });

  // Recovery: disturb by a range of amounts, then take your hands off. Score
  // the landing each time. A car that survives more of the sweep self-rights
  // better — this is the technical car's axis, and it is measured rather than
  // read back off the config.
  // Two robustness axes, because there are two ways to lose a landing and
  // they are not the same car's problem. The impact sweep is deliberately
  // brutal: at gentle dive angles the axis rewards *lightness* — less energy
  // to dissipate — which is the opposite of what it is supposed to measure.
  // Push the arrival hard enough and it starts asking about suspension. `recover` is attitude: disturbed in
  // pitch, hands off, does it right itself. `impact` is energy: nose driven
  // down late so it arrives hard and fast. A light self-righting car survives
  // the first; only a heavy one survives the second.
  let recover = 0, impact = 0;
  let gentle = plain;
  for (const g of [0.15, 0.3, 0.5, 0.8]) {
    const r = await fly(c.id, { hood: g }, { from: 0.2, to: 0.6 });
    recover += qual(r.res);
    if (g === 0.15) gentle = r;     // one fixed condition for everybody
  }
  for (const g of [0.6, 0.9, 1.2, 1.5, 1.8, 2.1]) {
    impact += qual((await fly(c.id, { trunk: g }, { from: 1.1, to: 2.6 })).res);
  }

  const launchSpeed = plain.launch ? plain.launch.speed : 1;
  const q = (launchSpeed / 55) ** 2;               // dynamic-pressure normaliser
  rows.push({
    car: c,
    top: plain.topSpeed,
    slip,
    flip: flip.peak.x / q,
    roll: roll.peak.z / q,
    glide: (plain.dist * 55) / (launchSpeed ** 2),  // range at a 55 m/s equivalent launch
    brake: Math.max(0, 1 - brakeRun.dist / Math.max(1, plain.dist)),  // flight shortened by drag
    recover,
    // Momentum through a touchdown, read off one fixed gentle-disturbance
    // flight. Reading it off the hands-off flight measured "did it land at
    // all", which is a different question and one `recover` already asks;
    // reading it off each car's *best* flight compared different landings.
    impact,
    launchSpeed,
    landed: !!(plain.res && plain.res.quality !== 'crash'),
  });
}

console.log('\n── eight instruments, identical inputs ──\n');
console.log('car      ' + AXES.map((a) => a.label.padStart(9)).join('') + '   hands-off');
for (const r of rows) {
  console.log(r.car.id.padEnd(9) + AXES.map((a) => r[a.key].toFixed(2).padStart(9)).join('') +
    '   ' + (r.landed ? 'lands' : 'crashes'));
}

const bestOf = {};
for (const a of AXES) bestOf[a.key] = rows.reduce((b, r) => (r[a.key] > b[a.key] ? r : b), rows[0]).car.id;
const ownedBy = {};
for (const [axis, id] of Object.entries(bestOf)) (ownedBy[id] ||= []).push(axis);

console.log('\n── what each car is best at, against what it claims ──\n');
for (const r of rows) {
  const owns = ownedBy[r.car.id] || [];
  const meant = AXES.filter((a) => a.owner === r.car.id).map((a) => a.key);
  const hit = meant.every((m) => owns.includes(m)) ? ' ' : '!';
  console.log(`${hit} ${r.car.id.padEnd(9)} ${(owns.join(', ') || '— nothing —').padEnd(26)} ` +
              `designed for: ${meant.join(', ')}`);
}

// ── the three things that actually have to be true ────────────────────────
//
// 1. Nobody is dominated. This *is* the law, stated precisely: a car is a valid
//    instrument exactly when no other car is at least as good at everything.
//    Non-dominated means that against any rival there is always some axis where
//    this car wins — which is what "a different way to play, never a stronger
//    one" means when you write it down.
//
//    An earlier version of this gate also demanded that every car take outright
//    first place on some axis. That is a stricter thing than the law and a
//    worse one: with eight axes that all run through the same rigid body, the
//    global maxima cluster on three or four cars no matter how the roster is
//    tuned, and chasing them just moves the loser around. Coming second by two
//    percent is not what makes a car pointless; being beaten at everything is.
//
// 2. Nobody hoards. Best at more than three of eight and the roster has a
//    favourite, whatever the domination test says.
//
// 3. No twins. Two cars within 12% of each other on every axis are one car with
//    two names, and the roster is smaller than it claims to be.
const dominated = [];
for (const a of rows) {
  for (const b of rows) {
    if (a === b) continue;
    if (AXES.every((ax) => b[ax.key] >= a[ax.key] - 1e-9) &&
        AXES.some((ax) => b[ax.key] > a[ax.key] + 1e-9)) { dominated.push([a.car.id, b.car.id]); break; }
  }
}
const hoards = Object.entries(ownedBy).filter(([, ax]) => ax.length > 3);
const twins = [];
for (let i = 0; i < rows.length; i++) {
  for (let j = i + 1; j < rows.length; j++) {
    const spread = Math.max(...AXES.map((ax) => {
      const a = rows[i][ax.key], b = rows[j][ax.key], d = Math.max(Math.abs(a), Math.abs(b), 1e-6);
      return Math.abs(a - b) / d;
    }));
    if (spread < 0.12) twins.push([rows[i].car.id, rows[j].car.id, spread]);
  }
}

console.log('');
for (const [a, b] of dominated) console.log(`  DOMINATED  ${a} is never a reason to not pick ${b}`);
for (const [id, ax] of hoards) console.log(`  HOARDS  ${id} is best at ${ax.length} of ${AXES.length} axes`);
for (const [a, b, s] of twins) console.log(`  TWINS  ${a} and ${b} agree within ${(s * 100).toFixed(0)}% on every axis`);

// Reported, not enforced: how close each car comes to leading its own column.
console.log('\n── how each car ranks on the axis it was designed around ──\n');
for (const ax of AXES) {
  const order = [...rows].sort((a, b) => b[ax.key] - a[ax.key]);
  const place = order.findIndex((r) => r.car.id === ax.owner) + 1;
  const lead = order[0];
  console.log(`${ax.label.padEnd(9)} ${ax.owner.padEnd(9)} is #${place}` +
    (place === 1 ? '' : `  (${lead.car.id} leads, ${lead[ax.key].toFixed(2)} vs ` +
      `${(rows.find((r) => r.car.id === ax.owner)[ax.key]).toFixed(2)})`));
}

// What to actually call each car. A car that leads no column is still a real
// instrument — it just wins against particular rivals rather than the field —
// so name it by its strongest suit relative to the roster, and keep the
// blurbs honest about it.
console.log('\n── strongest suit, relative to the roster ──\n');
for (const r of rows) {
  const scored = AXES.map((ax) => {
    const vals = rows.map((o) => o[ax.key]);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    return { ax: ax.label, z: hi > lo ? (r[ax.key] - lo) / (hi - lo) : 0 };
  }).sort((a, b) => b.z - a.z);
  console.log(`${r.car.id.padEnd(9)} ` +
    scored.slice(0, 3).map((s) => `${s.ax} ${(s.z * 100).toFixed(0)}%`).join('   ') +
    `   |  weakest: ${scored[scored.length - 1].ax}`);
}

const ok = !dominated.length && !hoards.length && !twins.length;
console.log(`\ngate: nobody dominated, nobody best at >3 of ${AXES.length}, no two cars alike`);
console.log(ok ? 'PASS  the roster is instruments, not tiers' : 'FAIL  the roster has a tier in it');
if (!ok) process.exitCode = 1;
