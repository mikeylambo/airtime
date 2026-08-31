/**
 * AFTERGLOW — the palette (airtime-art-direction.md).
 *
 * "A dark world where speed and rotation are the only light sources." Every
 * hex in the game lives here or in art.js's palettes; no colour decisions
 * anywhere else. VOID and ASPHALT own ≥85% of any frame; neon is *earned* —
 * it comes from motion, deployment and payout, never from static decoration.
 */

export const THEME = {
  VOID: 0x0a0a12,        // world base / sky
  ASPHALT: 0x16161f,     // ground, unlit geometry
  MAGENTA: 0xff2e9a,     // player 1 / primary trail
  PINK: 0xff6ec7,        // heat, boost, crash
  BLUE: 0x2e9aff,        // player 2 / UI primary
  GREEN: 0x39ff88,       // player 3 / perfect landing
  VIOLET: 0x9a2eff,      // player 4 / secrets
  WHITE_HOT: 0xf4f4ff,   // landing hit, score punch
  // SPECTRAL BLUR: the shared haze the trails cool into. A ribbon is its
  // player's hot colour at the car and dissolves toward CYAN down its length —
  // and because magenta→cyan crosses violet in RGB, that single sweep paints
  // the whole cyan→iris→magenta spectrum without a third stop.
  CYAN: 0x59d0ff,
  IRIS: 0x7a5cff,
};

/** Each split-screen player owns one accent colour end-to-end. */
export const PLAYER_COLORS = [THEME.MAGENTA, THEME.BLUE, THEME.GREEN, THEME.VIOLET];

/**
 * The alternate accents behind the colourblind option — measured, not
 * eyeballed: under simulated protanopia / deuteranopia / tritanopia the
 * minimum pairwise RGB distance is 124 / 120 / 133 (the standard set falls
 * to 90 / 44 / 33), and the four luminance steps (1.00 / 0.31 / 0.52 / 0.19)
 * survive even total colour loss. Trails add a shape channel on top
 * (solid/dashed/dotted/chevron), because colour alone is never the only
 * signal.
 */
export const PLAYER_COLORS_CB = [0xffffff, 0x2e9aff, 0xffb000, 0x777788];

// One switch for the whole game: the option flips this, and every consumer
// of playerColor()/playerColorCss() follows without carrying its own flag.
// (An explicit argument still overrides, for callers that need a fixed set.)
let CB = false;
export function setColorblind(on) { CB = !!on; }
export function isColorblind() { return CB; }

/**
 * Reduce Effects — one switch for the whole game (§A, and binding).
 *
 * The art brief makes this non-negotiable: "must exist same day the look
 * ships." It shipped with AFTERGLOW covering the trails, and then three more
 * emissive systems arrived — the signs, the brake discs, the ghost — and every
 * one of them ignored it, because each carried the flag itself or not at all.
 *
 * So it is a switch here, next to the colourblind one, for the same reason:
 * every consumer follows without carrying its own copy, and a system added
 * later cannot quietly opt out by forgetting to ask.
 */
let REDUCED = false;
export function setReduceEffects(on) { REDUCED = !!on; }
export function isReduced() { return REDUCED; }

export function playerColor(index, colorblind = CB) {
  const set = colorblind ? PLAYER_COLORS_CB : PLAYER_COLORS;
  return set[index % set.length];
}

/** The same colour as CSS, for the HUD side of "one accent end-to-end". */
export function playerColorCss(index, colorblind = CB) {
  return `#${playerColor(index, colorblind).toString(16).padStart(6, '0')}`;
}

/**
 * Trim archetypes — the handoff-3 "3 archetypes". Every hull is generated
 * from physics (render/wedge.js), so the archetype is not a model, it is a
 * *drawing style for the cut-lines*: which creases light up (edge threshold,
 * degrees), and how the light is split between body and glasshouse.
 *
 *   BLADE    the arrows — full silhouette, every panel line drawn
 *   BRUTE    the bricks — only the hard creases, heavier and sparser
 *   PHANTOM  the experiments — body barely traced, the canopy is the light
 */
export const TRIM = {
  blade:   { threshold: 24, body: 1.0,  glass: 0.55 },
  brute:   { threshold: 40, body: 1.0,  glass: 0.30 },
  phantom: { threshold: 16, body: 0.5,  glass: 1.0 },
};

/** Car id → trim archetype, following the roster's own archetype axis. */
export const TRIM_FOR_CAR = {
  vector: 'blade', needle: 'blade', dart: 'blade', grip: 'blade',
  anvil: 'brute', stub: 'brute',
  proto: 'phantom', drifter: 'phantom',
};

export function trimFor(carId) {
  return TRIM[TRIM_FOR_CAR[carId]] || TRIM.blade;
}

/** Arena dressing constants that are colour decisions (no hex elsewhere). */
export const DRESSING = {
  WINDOW: 0x8f9cc9,          // the sparse lit windows of the lightless city
  WINDOW_FRACTION: 0.18,     // fraction of eligible tower faces that are lit
};

/**
 * Ramp edge-strips encode the grade — how hard a surface throws you — so a
 * park reads as an instrument in the dark: blue rolls, green launches, pink
 * walls. Thresholds are exit slope in radians.
 */
export const RAMP_GRADE = [
  { below: 0.35, color: THEME.BLUE },     // roll-ons, banks, overpass wedges
  { below: 0.60, color: THEME.GREEN },    // kickers — the launch surfaces
  { below: Infinity, color: THEME.PINK }, // quarter pipes and anything vertical
];

export function rampGradeColor(exitAngle) {
  for (const g of RAMP_GRADE) if (exitAngle < g.below) return g.color;
  return THEME.PINK;
}
