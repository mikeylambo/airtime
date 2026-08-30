/**
 * Brake heat (R7's last debt).
 *
 * The rest of R7 held itself to a rule — the *decision* lives somewhere a
 * headless probe can drive it, never in the render loop next to the draw call
 * — and brake glow is the easiest thing in the game to get wrong by drawing it
 * from the brake button. A disc that lights the instant you press the pedal
 * and goes out the instant you let go is a light bulb, not a brake.
 *
 * So it is a temperature, and temperature is an integral:
 *
 *   heat += (work done stopping the car) · dt
 *   heat -= (cooling, faster the hotter it is and the faster the air moves)
 *
 * Which gives the three behaviours that make it read as metal rather than as
 * a lamp: it lags the input, it *keeps* glowing after a long stop while you
 * accelerate away, and a series of small brakes stacks into a glow that one
 * long brake at the same total pressure never reaches.
 *
 * Nothing here touches the simulation. Braking force is unchanged; this is a
 * readout of it. (Brake fade would be the version that does, and it is not
 * something a stunt game wants.)
 */

import TUNING from '../TUNING.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class BrakeHeat {
  constructor() { this.reset(); }

  reset() {
    this.heat = 0;        // 0..1, normalised against BRAKES.CAPACITY
    this.peak = 0;
  }

  /**
   * @param brake   0..1 pedal
   * @param speed   m/s over the ground
   * @param onGround wheels down — a brake in mid-air heats nothing, and a car
   *                 in this game spends a third of its life in mid-air
   */
  update(dt, brake, speed, onGround) {
    const B = TUNING.BRAKES;
    // Work, not pressure: stopping a fast car makes far more heat than
    // stopping a slow one at the same pedal, which is why the glow appears at
    // the end of a long straight and never in a car park.
    const work = onGround ? brake * speed : 0;
    const gain = (work / B.CAPACITY) * dt;
    // Cooling is proportional to how far above ambient it is, plus airflow.
    const cool = this.heat * (B.COOL + B.AIRFLOW_COOL * Math.min(1, speed / B.AIRFLOW_FULL)) * dt;
    this.heat = clamp01(this.heat + gain - cool);
    if (this.heat > this.peak) this.peak = this.heat;
    return this.heat;
  }

  /**
   * What the renderer wants: 0 below the visible threshold, then a ramp, so
   * discs are not faintly warm all the time. A glow that is always slightly on
   * is a glow that never means anything.
   */
  get glow() {
    const B = TUNING.BRAKES;
    if (this.heat <= B.GLOW_FROM) return 0;
    return clamp01((this.heat - B.GLOW_FROM) / (1 - B.GLOW_FROM));
  }

  /** Cherry through to white, the way metal actually goes. */
  get color() {
    const g = this.glow;
    // 0 -> deep red, 1 -> orange-white. Blue never rises much: brakes do not
    // get that hot, and a blue-white disc reads as a special effect.
    return { r: 0.55 + 0.45 * g, g: 0.06 + 0.62 * g * g, b: 0.03 + 0.22 * g * g * g };
  }
}

export default BrakeHeat;
