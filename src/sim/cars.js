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

/** §7: three archetypes — light, mid, heavy. */
export const CARS = [
  {
    id: 'dart', name: 'DART', archetype: 'light',
    blurb: 'Light and twitchy. Rotates for free, lands like a thrown brick.',
    mass: 0.78, inertia: 0.74, engine: 0.94, grip: 0.94,
    thrust: 1.18, aeroPanel: 1.15, suspension: 0.9,
    unlock: 0,
  },
  {
    id: 'vector', name: 'VECTOR', archetype: 'mid',
    blurb: 'The honest one. Everything the tuning file says, with nothing hidden.',
    mass: 1.0, inertia: 1.0, engine: 1.0, grip: 1.0,
    thrust: 1.0, aeroPanel: 1.0, suspension: 1.0,
    unlock: 3,
  },
  {
    id: 'anvil', name: 'ANVIL', archetype: 'heavy',
    blurb: 'Slow to turn over and slower to stop. Survives landings that end other cars.',
    mass: 1.34, inertia: 1.42, engine: 1.14, grip: 1.1,
    thrust: 0.86, aeroPanel: 0.84, suspension: 1.35,
    unlock: 8,
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
  const setup = {
    car,
    livery: findLivery(profile.livery),
    mass: C.MASS * massMul,
    inertiaScale: {
      x: C.INERTIA_SCALE.x * car.inertia * s(1 - t.aero, 0.18),
      y: C.INERTIA_SCALE.y * car.inertia * s(1 - t.aero, 0.18),
      z: C.INERTIA_SCALE.z * car.inertia * s(1 - t.aero, 0.18),
    },
    engineForce: D.ENGINE_FORCE * car.engine * s(t.weight, 0.12),
    engineForceBoost: D.ENGINE_FORCE_BOOST * car.engine * s(t.weight, 0.12),
    sideFriction: W.SIDE_FRICTION * car.grip,
    suspensionStiffness: W.SUSPENSION_STIFFNESS * car.suspension * s(t.suspension, 0.3),
    maxSuspensionForce: W.MAX_SUSPENSION_FORCE * car.suspension * s(t.suspension, 0.35),
    // §7: suspension is "landing tolerance angle" — a softer car forgives more.
    landingToleranceBonus: lerp(-0.06, 0.12, t.suspension) * car.suspension,
    thrustAccel: TH.EXTEND_ACCEL * car.thrust * s(t.thrust, 0.28),
    thrustDive: TH.DIVE_ACCEL * car.thrust * s(t.thrust, 0.28),
    thrustCost: TUNING.BOOST.THRUST_COST * lerp(0.78, 1.28, t.thrust),
    chassisAngDrag: A.CHASSIS_ANG_DRAG * s(1 - t.aero, 0.35),
    panels: {},
  };

  for (const slot of Object.keys(PANEL_SLOT_TO_PART)) {
    const v = findVariant(PANEL_SLOT_TO_PART[slot], (profile.parts || {})[PANEL_SLOT_TO_PART[slot]]);
    const base = TUNING.PANELS[slot];
    setup.panels[slot] = {
      gain: (base.gain ?? 1) * v.gain * car.aeroPanel * s(t.aero, 0.3),
      open: base.open * v.open,
      variant: v.id,
      lift: v.lift ?? 1,
    };
  }
  return setup;
}

/** The setup a fresh profile drives — used by tools and by the capture rig. */
export function defaultSetup() {
  return resolveSetup({
    car: 'dart', livery: 'stock',
    tune: { weight: 0.5, suspension: 0.5, thrust: 0.5, aero: 0.5 },
    parts: { doors: 'stock', hood: 'stock', trunk: 'stock', spoiler: 'stock' },
  });
}
