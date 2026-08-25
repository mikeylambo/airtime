/**
 * The garage, as physics (§7).
 *
 * "The garage question is 'what can my car do in the air', not 'what are its
 * stats'." So a setup is not a stat block — it resolves to the actual numbers
 * the rigid body, the suspension, the thrust and the panels are built from.
 * Change a slider and the car is a different object in the world.
 *
 * Everything here is a multiplier on the baseline in TUNING, so the tuning file
 * stays the single source of truth and a car is a deviation from it.
 */

import TUNING from '../TUNING.js';

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * The roster: eight instruments (ROADMAP "The vehicle roster").
 *
 * The law is that **no car is a tier**. A car is a different way to play, never
 * a stronger one, so nothing here is gated behind medals and every one of them
 * has to be measurably the best at something. `npm run probe:cars` enforces
 * both: it measures all eight on seven axes and fails if any car is Pareto-
 * dominated or best at nothing.
 *
 * Every field is a multiplier on the TUNING baseline, so VECTOR (all 1.0) is
 * literally the tuning file and everything else is a signed deviation from it.
 *
 *   half        chassis box, per axis. z is length — it drives pitch inertia
 *               through the box formula, so a long car resists flipping.
 *   wheelbase   axle separation. Short = flick-happy on the ground and off the
 *               lip; long = plants the launch.
 *   track       width. Wide resists tipping, narrow gets on two wheels.
 *   inertia     per-axis rotational scaling (x pitch, y yaw, z roll). The
 *               single biggest knob on how a car tumbles.
 *   angDrag     per-axis air resistance to rotation. High = the air stops the
 *               spin for you; low = you have to stop it yourself.
 *   copSide     centre-of-pressure offset (metres, +z is rearward) for side
 *               force. Further back weathercocks harder: the car snaps
 *               nose-first and flies far, at the cost of yaw authority.
 *   copLift     same for vertical force. Further from the CoM = pitch trims
 *               itself; near zero = pitch stays yours.
 */
export const CARS = [
  {
    id: 'vector', name: 'VECTOR', archetype: 'technical',
    blurb: 'The reference. Everything the tuning file says, with nothing hidden.',
    owns: 'the baseline - and it takes a hit',
    mass: 1.0, engine: 1.00, grip: 1.0, chassisCd: 1.00, bodyLift: 0.15, gripRear: 1.00, thrust: 1.0, aeroPanel: 1.00, suspension: 1.00,
    half: { x: 1.00, y: 1.00, z: 1.00 }, wheelbase: 1.0, track: 1.0,
    inertia: { x: 1.00, y: 1.00, z: 1.00 },
    angDrag: { pitch: 1.00, yaw: 1.00, roll: 1.00 },
    copSide: 0, copLift: 0.34,
  },
  {
    id: 'dart', name: 'DART', archetype: 'light',
    blurb: 'Oversized surfaces on almost no car. Throws away speed like an anchor.',
    owns: 'shedding speed in mid-air',
    mass: 0.80, engine: 0.98, grip: 0.95, gripRear: 0.95, thrust: 1.24, aeroPanel: 1.85, chassisCd: 0.94, bodyLift: 0.20, suspension: 0.98,
    half: { x: 1.00, y: 0.96, z: 0.94 }, wheelbase: 0.88, track: 0.94,
    inertia: { x: 1.20, y: 0.70, z: 0.95 },
    angDrag: { pitch: 1.00, yaw: 0.70, roll: 0.98 },
    copSide: -0.35, copLift: -0.06,
  },
  {
    id: 'anvil', name: 'ANVIL', archetype: 'heavy',
    blurb: 'Arrives like a dropped safe and gets up anyway. Nothing else survives what it lands from.',
    owns: 'arriving hard and surviving it',
    mass: 1.58, engine: 1.02, grip: 1.55, chassisCd: 1.05, bodyLift: 0.04, gripRear: 1.05, thrust: 0.84, aeroPanel: 0.90, suspension: 2.60,
    half: { x: 1.06, y: 1.04, z: 1.04 }, wheelbase: 1.02, track: 1.08,
    inertia: { x: 1.05, y: 1.05, z: 1.05 },
    angDrag: { pitch: 1.05, yaw: 1.05, roll: 1.05 },
    copSide: 0.10, copLift: 0.02,
  },
  {
    id: 'needle', name: 'NEEDLE', archetype: 'long',
    blurb: 'Long, flat and arrow-stable. Makes its own lift and puts its own nose back down.',
    owns: 'flying itself level - hands-off recovery',
    mass: 0.94, engine: 1.00, grip: 0.98, gripRear: 1.00, thrust: 1.02, aeroPanel: 0.95, chassisCd: 0.15, bodyLift: 1.00, suspension: 1.00,
    half: { x: 1.00, y: 0.88, z: 1.42 }, wheelbase: 1.24, track: 0.90,
    inertia: { x: 1.10, y: 1.15, z: 1.10 },
    angDrag: { pitch: 1.00, yaw: 1.30, roll: 1.15 },
    copSide: 0.55, copLift: -0.40,
  },
  {
    id: 'stub', name: 'STUB', archetype: 'compact',
    blurb: 'No overhang, no patience. Flips end over end almost by accident.',
    owns: 'flip rate',
    mass: 0.84, engine: 0.98, grip: 1.02, gripRear: 1.00, thrust: 1.08, aeroPanel: 1.00, chassisCd: 1.85, bodyLift: 0.10, suspension: 1.00,
    half: { x: 1.02, y: 1.00, z: 0.80 }, wheelbase: 0.74, track: 1.02,
    inertia: { x: 0.22, y: 0.95, z: 0.98 },
    angDrag: { pitch: 0.20, yaw: 0.98, roll: 0.98 },
    copSide: -0.20, copLift: -0.04,
  },
  {
    id: 'drifter', name: 'DRIFTER', archetype: 'loose',
    blurb: 'The rear never quite agrees with the front. Approach lines nobody else can take.',
    owns: 'ground line control',
    mass: 1.02, engine: 1.02, grip: 1.30, gripRear: 0.14, thrust: 1.04, aeroPanel: 1.00, chassisCd: 1.02, bodyLift: 0.15, suspension: 0.98,
    half: { x: 1.00, y: 0.98, z: 1.02 }, wheelbase: 0.98, track: 0.92,
    inertia: { x: 1.00, y: 0.90, z: 1.00 },
    angDrag: { pitch: 1.00, yaw: 0.90, roll: 1.00 },
    copSide: -0.10, copLift: -0.04,
  },
  {
    id: 'grip', name: 'GRIP', archetype: 'precision',
    blurb: 'Glued down and geared long. Arrives at the lip faster than anything else.',
    owns: 'outright speed',
    mass: 1.06, engine: 1.60, grip: 1.34, gripRear: 1.05, thrust: 0.94, aeroPanel: 0.95, chassisCd: 1.05, bodyLift: 0.08, suspension: 1.02,
    half: { x: 1.04, y: 1.00, z: 1.02 }, wheelbase: 1.06, track: 1.10,
    inertia: { x: 1.05, y: 1.05, z: 1.05 },
    angDrag: { pitch: 1.02, yaw: 1.05, roll: 1.05 },
    copSide: 0.28, copLift: -0.08,
  },
  {
    id: 'proto', name: 'PROTOTYPE', archetype: 'aero',
    blurb: 'Barely a car. Narrow body, enormous wings, no self-preservation instinct.',
    owns: 'roll rate and glide',
    mass: 0.80, engine: 0.98, grip: 0.86, gripRear: 1.00, thrust: 1.14, aeroPanel: 1.05, chassisCd: 1.02, bodyLift: 0.35, suspension: 0.98,
    half: { x: 0.90, y: 0.92, z: 1.02 }, wheelbase: 1.0, track: 1.10,
    inertia: { x: 0.95, y: 0.90, z: 0.30 },
    angDrag: { pitch: 0.95, yaw: 0.90, roll: 0.24 },
    copSide: -0.48, copLift: -0.04,
  },
];

/**
 * §7: "parts as verbs" — each slot has variants that change the physics, not
 * a number on a card. Values multiply the panel's own aero gain and open angle.
 */
export const PART_VARIANTS = {
  doors: [
    { id: 'stock', name: 'STOCK', gain: 1.0, open: 1.0, note: 'Balanced roll and brake.', unlock: 0 },
    { id: 'scissor', name: 'SCISSOR', gain: 1.28, open: 1.12, note: 'Rolls faster, brakes less cleanly.', unlock: 2 },
    { id: 'glider', name: 'GLIDER', gain: 0.72, open: 1.35, note: 'Rush 2049 wings. Long, flat, forgiving.', unlock: 6 },
  ],
  hood: [
    { id: 'stock', name: 'STOCK', gain: 1.0, open: 1.0, note: 'Pitches back hard.', unlock: 0 },
    { id: 'gullwing', name: 'GULLWING', gain: 1.35, open: 0.9, note: 'Brakes harder, pitches less.', unlock: 3 },
  ],
  trunk: [
    { id: 'stock', name: 'STOCK', gain: 1.0, open: 1.0, note: 'Drops the nose.', unlock: 0 },
    { id: 'diffuser', name: 'DIFFUSER', gain: 1.3, open: 1.1, note: 'More authority, more drag.', unlock: 4 },
  ],
  spoiler: [
    { id: 'stock', name: 'STOCK', gain: 1.0, open: 1.0, lift: 1.0, note: 'Steadies yaw and pitch.', unlock: 0 },
    { id: 'splittail', name: 'SPLIT-TAIL', gain: 1.2, open: 1.0, lift: 1.6, note: 'Adds the micro-lift of §5.1.', unlock: 5 },
  ],
};

export const LIVERIES = [
  { id: 'stock', name: 'STOCK', body: 0x9fa8b2, panel: 0xffb066, unlock: 0 },
  { id: 'ember', name: 'EMBER', body: 0xd6452f, panel: 0xffd166, unlock: 1 },
  { id: 'signal', name: 'SIGNAL', body: 0x2b6f92, panel: 0x59d0ff, unlock: 2 },
  { id: 'bone', name: 'BONE', body: 0xe8e2d4, panel: 0x2d3142, unlock: 4 },
];

export const findCar = (id) => CARS.find((c) => c.id === id) || CARS[0];
export const findVariant = (slot, id) =>
  (PART_VARIANTS[slot] || []).find((v) => v.id === id) || (PART_VARIANTS[slot] || [])[0];
export const findLivery = (id) => LIVERIES.find((l) => l.id === id) || LIVERIES[0];

/**
 * The four sliders (§7). Each is 0..1 and trades one thing against another —
 * there is no "better", only "different in the air".
 */
export const SLIDERS = [
  { key: 'weight', label: 'WEIGHT', low: 'airtime', high: 'launch speed' },
  { key: 'suspension', label: 'SUSPENSION', low: 'soft', high: 'landing tolerance' },
  { key: 'thrust', label: 'THRUST', low: 'recharge', high: 'burst strength' },
  { key: 'aero', label: 'AERO', low: 'stability', high: 'rotation speed' },
];

const PANEL_SLOT_TO_PART = {
  DOOR_L: 'doors', DOOR_R: 'doors', HOOD: 'hood', TRUNK: 'trunk', SPOILER: 'spoiler',
};

/**
 * Resolve archetype + sliders + parts into the concrete numbers the sim builds
 * from. Called once when a run starts; the sim never sees a slider again.
 */
export function resolveSetup(profile) {
  const car = findCar(profile.car);
  const t = profile.tune || { weight: 0.5, suspension: 0.5, thrust: 0.5, aero: 0.5 };
  const C = TUNING.CAR, W = TUNING.WHEEL, D = TUNING.DRIVE, TH = TUNING.THRUST, A = TUNING.AERO;

  // Sliders are symmetric around 0.5, so the middle of every slider is exactly
  // the baseline the whole game was tuned against.
  const s = (v, spread) => lerp(1 - spread, 1 + spread, v);

  const massMul = car.mass * s(t.weight, 0.16);
  const aeroInertia = s(1 - t.aero, 0.18);
  const setup = {
    car,
    livery: findLivery(profile.livery),
    mass: C.MASS * massMul,
    // Chassis geometry is per-car, not a constant: length drives pitch inertia
    // through the box formula and wheelbase decides how the car leaves a lip.
    half: {
      x: C.HALF.x * car.half.x, y: C.HALF.y * car.half.y, z: C.HALF.z * car.half.z,
    },
    wheel: {
      halfTrack: W.HALF_TRACK * car.track,
      frontZ: W.AXLE_FRONT_Z * car.wheelbase,
      rearZ: W.AXLE_REAR_Z * car.wheelbase,
    },
    inertiaScale: {
      x: C.INERTIA_SCALE.x * car.inertia.x * aeroInertia,
      y: C.INERTIA_SCALE.y * car.inertia.y * aeroInertia,
      z: C.INERTIA_SCALE.z * car.inertia.z * aeroInertia,
    },
    // Engine force scales with mass, so `engine` means power-to-weight and a
    // light car does not get free acceleration on top of everything else its
    // lightness already buys. Without this, mass is a super-knob: dropping
    // DART to 0.52 handed it top speed, roll rate *and* momentum at once, and
    // no amount of tuning the other seven cars could take those back.
    engineForce: D.ENGINE_FORCE * car.engine * massMul * s(t.weight, 0.12),
    engineForceBoost: D.ENGINE_FORCE_BOOST * car.engine * massMul * s(t.weight, 0.12),
    sideFriction: W.SIDE_FRICTION * car.grip,
    sideFrictionRear: W.SIDE_FRICTION * car.grip * (car.gripRear ?? 1),
    chassisCd: car.chassisCd ?? 1,
    bodyLift: car.bodyLift ?? 0.15,
    suspensionStiffness: W.SUSPENSION_STIFFNESS * car.suspension * s(t.suspension, 0.3),
    maxSuspensionForce: W.MAX_SUSPENSION_FORCE * car.suspension * s(t.suspension, 0.35),
    // §7: suspension is "landing tolerance angle" — a softer car forgives more.
    landingToleranceBonus: lerp(-0.06, 0.12, t.suspension) * car.suspension,
    thrustAccel: TH.EXTEND_ACCEL * car.thrust * s(t.thrust, 0.28),
    thrustDive: TH.DIVE_ACCEL * car.thrust * s(t.thrust, 0.28),
    thrustCost: TUNING.BOOST.THRUST_COST * lerp(0.78, 1.28, t.thrust),
    // The aero slider scales all three axes together (§7 stability vs
    // rotation); the car then bends each axis separately, which is most of
    // what makes one instrument feel unlike another in the air.
    angDragScale: s(1 - t.aero, 0.35),
    angDrag: {
      pitch: A.ANG_DRAG.pitch * car.angDrag.pitch,
      yaw: A.ANG_DRAG.yaw * car.angDrag.yaw,
      roll: A.ANG_DRAG.roll * car.angDrag.roll,
    },
    // Per-axis centre of pressure, shifted along the car's length. Rearward
    // weathercocks harder (flies nose-first, goes further, turns less).
    cops: {
      side: { ...A.COP_SIDE, z: A.COP_SIDE.z + car.copSide },
      lift: { ...A.COP_LIFT, z: A.COP_LIFT.z + car.copLift },
      axial: { ...A.COP_AXIAL },
    },
    panels: {},
  };

  for (const slot of Object.keys(PANEL_SLOT_TO_PART)) {
    const v = findVariant(PANEL_SLOT_TO_PART[slot], (profile.parts || {})[PANEL_SLOT_TO_PART[slot]]);
    const base = TUNING.PANELS[slot];
    setup.panels[slot] = {
      gain: (base.gain ?? 1) * v.gain * car.aeroPanel * s(t.aero, 0.3),
      open: base.open * v.open,
      // The whole panel rides the chassis box — hinge, plate and mass. Moving
      // the hinge alone leaves a baseline-sized door bolted to a shrunken car,
      // and the door's fixed mass then swamps the chassis it is trying to
      // rotate: a 6% smaller DART lost three quarters of its roll authority
      // to that alone. Scale the bodywork and the ratios stay honest.
      hinge: {
        x: base.hinge.x * car.half.x,
        y: base.hinge.y * car.half.y,
        z: base.hinge.z * car.half.z,
      },
      centerOffset: {
        x: base.centerOffset.x * car.half.x,
        y: base.centerOffset.y * car.half.y,
        z: base.centerOffset.z * car.half.z,
      },
      size: {
        x: base.size.x * car.half.x,
        y: base.size.y * car.half.y,
        z: base.size.z * car.half.z,
      },
      mass: TUNING.PANELS.MASS * massMul,
      variant: v.id,
      lift: v.lift ?? 1,
    };
  }
  return setup;
}

/** The setup a fresh profile drives — used by tools and by the capture rig. */
export function defaultSetup() {
  return resolveSetup({
    car: 'vector', livery: 'stock',
    tune: { weight: 0.5, suspension: 0.5, thrust: 0.5, aero: 0.5 },
    parts: { doors: 'stock', hood: 'stock', trunk: 'stock', spoiler: 'stock' },
  });
}
