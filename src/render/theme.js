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
};

/** Each split-screen player owns one accent colour end-to-end. */
export const PLAYER_COLORS = [THEME.MAGENTA, THEME.BLUE, THEME.GREEN, THEME.VIOLET];

/**
 * The alternate accents behind the colourblind option — separated by
 * lightness and hue distance that survive the three common axes. Trails add
 * a shape channel on top (solid/dashed/dotted/chevron), because colour alone
 * is never the only signal.
 */
export const PLAYER_COLORS_CB = [0xffffff, 0x2e9aff, 0xffb000, 0x777788];

export function playerColor(index, colorblind = false) {
  const set = colorblind ? PLAYER_COLORS_CB : PLAYER_COLORS;
  return set[index % set.length];
}

/** The same colour as CSS, for the HUD side of "one accent end-to-end". */
export function playerColorCss(index, colorblind = false) {
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
