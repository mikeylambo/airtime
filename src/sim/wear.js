/**
 * Wear — panel deformation, and session-long scuffing (R7's debts).
 *
 * Two systems that look like one and are not, and the difference is a §R
 * requirement rather than a matter of taste:
 *
 * - **Deformation is physical, and lives for one run.** A panel dragged hard
 *   enough to nearly tear off is *bent*: its hinge no longer rests closed, so
 *   it hangs ajar and the air does what the air does with a door that will not
 *   shut. That is a real change to the aerodynamics, which means it has to be
 *   derived from the run's own inputs — and it is, because the strain that
 *   causes it is measured from the same relative-velocity test that decides
 *   tear-off. A replay re-simulating those inputs bends the same panels by the
 *   same amount, so a clip still reproduces its run bit for bit.
 *
 * - **Scuffing is cosmetic, and lives for a session.** The car's emissive
 *   cut-lines go dark where it has been hit, and they stay dark across runs
 *   until the garage repairs them. Nothing about it touches the simulation,
 *   and that is not an accident: session state that affected physics would
 *   mean a clip recorded in hour three does not reproduce in hour one, and §R
 *   exists precisely to stop that being discoverable only in hindsight.
 *
 * So: what you can *feel* resets every run; what you can *see* accumulates.
 * Which is also, conveniently, exactly the right way round for a game about
 * doing ridiculous things — the car looks like your session and drives like
 * itself.
 *
 * AFTERGLOW does the drawing: a dark world where the car's own light is the
 * subject means "damaged" reads as *the light going out where you hit things*,
 * not as a dent nobody can see at night.
 */

import TUNING from '../TUNING.js';
import { SLOTS } from './panels.js';

/**
 * Six directions on the chassis, in its own frame. A scuff is attributed to
 * whichever one the impact came from, so a session of landing nose-first and a
 * session of scraping the left flank do not look the same.
 */
export const REGIONS = ['nose', 'tail', 'left', 'right', 'roof', 'floor'];

const AXIS = {
  nose: { x: 0, y: 0, z: -1 }, tail: { x: 0, y: 0, z: 1 },
  left: { x: -1, y: 0, z: 0 }, right: { x: 1, y: 0, z: 0 },
  roof: { x: 0, y: 1, z: 0 }, floor: { x: 0, y: -1, z: 0 },
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Which region a chassis-local direction points at. */
export function regionOf(dir) {
  let best = 'floor', bestDot = -Infinity;
  const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
  for (const r of REGIONS) {
    const a = AXIS[r];
    const d = (dir.x * a.x + dir.y * a.y + dir.z * a.z) / l;
    if (d > bestDot) { bestDot = d; best = r; }
  }
  return best;
}

export class Wear {
  constructor() {
    this.reset();
    this.resetSession();
  }

  /** Per-run: the panels straighten out when they are reattached. */
  reset() {
    this.panels = {};
    for (const s of SLOTS) this.panels[s] = 0;
  }

  /** Per-session: paint does not un-scuff on its own. */
  resetSession() {
    this.scuff = {};
    for (const r of REGIONS) this.scuff[r] = 0;
    this.hits = 0;
  }

  // ── Deformation ─────────────────────────────────────────────────────────

  /**
   * A panel took a strain. `strain` is the relative speed between the panel
   * and the chassis — the same quantity `Panels.checkTearOff` thresholds on,
   * so a panel that nearly came off is bent by nearly the amount that would
   * have removed it, and one that did come off is not this system's problem.
   */
  strain(slot, strain) {
    const W = TUNING.WEAR;
    if (strain <= W.BEND_FROM) return 0;
    const k = (strain - W.BEND_FROM) / Math.max(0.001, W.BEND_FULL - W.BEND_FROM);
    const add = clamp01(k) * W.BEND_PER_HIT;
    this.panels[slot] = clamp01(this.panels[slot] + add);
    return this.panels[slot];
  }

  /** How bent, 0..1. */
  panelDamage(slot) { return this.panels[slot] || 0; }

  /**
   * The rest angle a bent hinge settles at, as a fraction of the panel's own
   * open angle. This is the whole physical consequence: a door that will not
   * shut is a permanently deployed aero surface, and the car flies differently
   * because of it.
   */
  hingeSag(slot) { return this.panelDamage(slot) * TUNING.WEAR.SAG_FRACTION; }

  get worstPanel() {
    return SLOTS.reduce((a, s) => Math.max(a, this.panels[s] || 0), 0);
  }

  // ── Scuffing ────────────────────────────────────────────────────────────

  /**
   * The car hit something, coming from `dir` in its own frame.
   * @param severity 0..1 — how hard, already normalised by the caller
   */
  scuffFrom(dir, severity) {
    const W = TUNING.WEAR;
    if (severity < W.SCUFF_MIN) return null;
    const r = regionOf(dir);
    // Saturating, not linear: the first scrape on a clean panel is the one
    // you notice, and the fortieth changes nothing. Without this the car is
    // uniformly black by minute ten and the system stops saying anything.
    const room = 1 - this.scuff[r];
    this.scuff[r] = clamp01(this.scuff[r] + room * severity * W.SCUFF_GAIN);
    this.hits++;
    return r;
  }

  scuffAt(region) { return this.scuff[region] || 0; }

  /** One number for the garage: how used this car looks. */
  get total() {
    return REGIONS.reduce((a, r) => a + this.scuff[r], 0) / REGIONS.length;
  }

  /**
   * How bright the trim still is in a direction — what the renderer multiplies
   * an edge's colour by. Blended across regions rather than snapped to one, or
   * a scuffed nose would end at a hard line across the middle of the car.
   */
  brightnessAt(dir) {
    const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
    let sum = 0, weight = 0;
    for (const r of REGIONS) {
      const a = AXIS[r];
      const d = (dir.x * a.x + dir.y * a.y + dir.z * a.z) / l;
      if (d <= 0) continue;
      const w = d * d;
      sum += this.scuff[r] * w;
      weight += w;
    }
    const s = weight ? sum / weight : 0;
    return 1 - s * TUNING.WEAR.SCUFF_DARKEN;
  }

  /** The garage. Paint and panels both, because that is what a garage is. */
  repair() { this.reset(); this.resetSession(); }

  // Scuffing survives a session, so it survives a reload of the page.
  serialize() { return { scuff: { ...this.scuff }, hits: this.hits }; }
  restore(d) {
    if (!d || !d.scuff) return this;
    for (const r of REGIONS) this.scuff[r] = clamp01(d.scuff[r] || 0);
    this.hits = d.hits || 0;
    return this;
  }
}

export default Wear;
