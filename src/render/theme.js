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
