/**
 * One run (§3: 90–120 seconds, final score = sum of landed banks).
 *
 * Owns the clock, the score, the chain multiplier and the list of landings —
 * which is also the score breakdown the result screen reads, one row per
 * landing (§2.1).
 */

import TUNING from '../TUNING.js';
import { clamp } from './mathx.js';

export const RUN_STATE = { COUNTDOWN: 'countdown', RUNNING: 'running', OVER: 'over' };

export class Run {
  constructor(mode = 'stunt', duration = TUNING.RUN.DURATION) {
    this.mode = mode;
    this.duration = duration;
    this.reset();
  }

  reset() {
    this.state = RUN_STATE.COUNTDOWN;
    this.countdown = TUNING.RUN.COUNTDOWN;
    this.timeLeft = this.duration ?? TUNING.RUN.DURATION;
    this.score = 0;
    this.landings = [];
    this.combo = 1;
    this.comboTimer = 0;
    this.chain = 0;
    this.best = null;
    this.crashes = 0;
  }

  /** Skip the countdown — used by the capture rig and the garage preview. */
  begin() { this.state = RUN_STATE.RUNNING; this.countdown = 0; }

  update(dt) {
    if (this.state === RUN_STATE.COUNTDOWN) {
      this.countdown -= dt;
      if (this.countdown <= 0) { this.countdown = 0; this.state = RUN_STATE.RUNNING; }
      return;
    }
    if (this.state !== RUN_STATE.RUNNING) return;

    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) { this.combo = 1; this.chain = 0; }
    }
    if (this.timeLeft <= 0) this.state = RUN_STATE.OVER;
  }

  get running() { return this.state === RUN_STATE.RUNNING; }
  get over() { return this.state === RUN_STATE.OVER; }

  /** The multiplier the *next* landing will be paid at. */
  get nextCombo() { return this.combo; }

  /**
   * Bank a resolved flight. `result` comes from TrickTracker.resolve, which
   * has already applied the landing and tier multipliers.
   */
  addLanding(result) {
    if (!this.running) return result;
    this.landings.push(result);
    this.score += result.total;

    if (result.landed) {
      this.chain++;
      this.comboTimer = TUNING.RUN.COMBO_WINDOW;
      this.combo = clamp(1 + this.chain * TUNING.RUN.COMBO_STEP, 1, TUNING.RUN.COMBO_MAX);
      if (!this.best || result.total > this.best.total) this.best = result;
    } else {
      this.crashes++;
      this.chain = 0;
      this.combo = 1;
      this.comboTimer = 0;
    }
    return result;
  }

  /** §8: per-arena, per-mode medals on score. */
  get medal() {
    const M = TUNING.SCORE.MEDAL;
    if (this.score >= M.platinum) return 'platinum';
    if (this.score >= M.gold) return 'gold';
    if (this.score >= M.silver) return 'silver';
    if (this.score >= M.bronze) return 'bronze';
    return null;
  }

  summary(extra = {}) {
    const landed = this.landings.filter((l) => l.landed);
    return {
      mode: this.mode,
      duration: this.duration,
      // Counters the licence tests ask about (§8).
      thrustBursts: extra.thrustBursts ?? 0,
      coins: extra.coins ?? 0,
      nearMisses: extra.nearMisses ?? 0,
      score: this.score,
      medal: this.medal,
      jumps: this.landings.length,
      landed: landed.length,
      crashes: this.crashes,
      landingRate: this.landings.length ? landed.length / this.landings.length : 0,
      best: this.best,
      bestChain: this.landings.length ? Math.max(0, ...this.landings.map((_, i) => i)) : 0,
      landings: this.landings,
    };
  }
}

export default Run;
