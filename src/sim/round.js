/**
 * The round clock, and one score per player (§3, §9).
 *
 * Split-screen means several cars sharing one clock and one arena but keeping
 * their own banks, chains and landings — so the timer lives on the Round and
 * everything a player earns lives on their Score. A solo run is the same thing
 * with one player in the list.
 */

import TUNING from '../TUNING.js';
import { clamp } from './mathx.js';

export const RUN_STATE = { COUNTDOWN: 'countdown', RUNNING: 'running', OVER: 'over' };

export class Round {
  constructor(mode = 'stunt', duration = TUNING.RUN.DURATION) {
    this.mode = mode;
    this.duration = duration ?? TUNING.RUN.DURATION;
    this.reset();
  }

  reset() {
    this.state = RUN_STATE.COUNTDOWN;
    this.countdown = TUNING.RUN.COUNTDOWN;
    this.timeLeft = this.duration;
    this.elapsed = 0;
  }

  /** Skip the countdown — the capture rig and the garage preview use this. */
  begin() { this.state = RUN_STATE.RUNNING; this.countdown = 0; }

  end() { this.state = RUN_STATE.OVER; this.timeLeft = 0; }

  update(dt) {
    if (this.state === RUN_STATE.COUNTDOWN) {
      this.countdown -= dt;
      if (this.countdown <= 0) { this.countdown = 0; this.state = RUN_STATE.RUNNING; }
      return;
    }
    if (this.state !== RUN_STATE.RUNNING) return;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.elapsed += dt;
    if (this.timeLeft <= 0) this.state = RUN_STATE.OVER;
  }

  get running() { return this.state === RUN_STATE.RUNNING; }
  get over() { return this.state === RUN_STATE.OVER; }
}

/**
 * One player's take. Reads the clock off the shared Round so callers can keep
 * treating it as "the run" in single player.
 */
export class Score {
  constructor(round, index = 0) {
    this.round = round;
    this.index = index;
    this.reset();
  }

  reset() {
    this.score = 0;
    this.landings = [];
    this.combo = 1;
    this.comboTimer = 0;
    this.chain = 0;
    this.best = null;
    this.crashes = 0;
    this.alive = true;          // §9 Last Car Standing
    this.eliminatedAt = null;
  }

  // ── Clock, borrowed from the round ─────────────────────────────────────
  get mode() { return this.round.mode; }
  get state() { return this.round.state; }
  get countdown() { return this.round.countdown; }
  get timeLeft() { return this.round.timeLeft; }
  get duration() { return this.round.duration; }
  get running() { return this.round.running && this.alive; }
  get over() { return this.round.over; }
  begin() { this.round.begin(); }

  get nextCombo() { return this.combo; }

  update(dt) {
    if (!this.round.running) return;
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) { this.combo = 1; this.chain = 0; }
    }
  }

  /** Bank a resolved flight (multipliers already applied by resolveTrick). */
  addLanding(result) {
    if (!this.round.running || !this.alive) return result;
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

  eliminate(t) { this.alive = false; this.eliminatedAt = t; }

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
    let bestChain = 0, n = 0;
    for (const l of this.landings) { if (l.landed) { n++; bestChain = Math.max(bestChain, n); } else n = 0; }
    return {
      player: this.index,
      mode: this.round.mode,
      duration: this.round.duration,
      score: this.score,
      medal: this.medal,
      jumps: this.landings.length,
      landed: landed.length,
      crashes: this.crashes,
      alive: this.alive,
      landingRate: this.landings.length ? landed.length / this.landings.length : 0,
      best: this.best,
      bestChain,
      landings: this.landings,
      thrustBursts: extra.thrustBursts ?? 0,
      coins: extra.coins ?? 0,
      nearMisses: extra.nearMisses ?? 0,
    };
  }
}

export default Round;
