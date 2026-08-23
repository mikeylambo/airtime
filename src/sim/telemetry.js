/**
 * Session telemetry — §0.1 pillar 3: "Build logs landing rate per session so
 * this is tuned from data." Target band is a ~25% landing rate for a new
 * player and ~75% an hour in; both live in TUNING so the band is one place.
 */

import TUNING from '../TUNING.js';

export class Telemetry {
  constructor() {
    this.startedAt = Date.now();
    this.jumps = 0;
    this.landed = 0;
    this.byQuality = { perfect: 0, clean: 0, sloppy: 0, crash: 0 };
    this.byTier = {};
    this.thrustBursts = { extend: 0, correct: 0, dive: 0 };
    this.partDeploys = { DOOR_L: 0, DOOR_R: 0, HOOD: 0, TRUNK: 0, SPOILER: 0 };
    this.tearOffs = 0;
    this.totalAirtime = 0;
    this.totalTime = 0;
    this.groundTime = 0;
    this.longestAirtime = 0;
    this.recent = [];
  }

  tick(dt, airborne) {
    this.totalTime += dt;
    if (airborne) this.totalAirtime += dt; else this.groundTime += dt;
  }

  recordLanding(l) {
    if (!l.counted) return;
    this.jumps++;
    if (l.quality !== 'crash') this.landed++;
    this.byQuality[l.quality]++;
    this.byTier[l.tier] = (this.byTier[l.tier] || 0) + 1;
    this.longestAirtime = Math.max(this.longestAirtime, l.airtime);
    this.recent.push({ q: l.quality, t: +l.airtime.toFixed(2), deg: +l.angleDeg.toFixed(1), tier: l.tier });
    if (this.recent.length > 30) this.recent.shift();
    if (TUNING.TELEMETRY.LOG_TO_CONSOLE) console.info('[AIRTIME] landing', l);
  }

  recordThrust(mode) { if (mode) this.thrustBursts[mode]++; }
  recordDeploy(slot) { this.partDeploys[slot]++; }
  recordTearOff(n) { this.tearOffs += n; }

  get landingRate() { return this.jumps ? this.landed / this.jumps : 0; }
  /** §5: "a perfect run still spends 70% of its time on the ground." */
  get groundFraction() { return this.totalTime ? this.groundTime / this.totalTime : 1; }

  summary() {
    const T = TUNING.TELEMETRY;
    return {
      sessionSeconds: +((Date.now() - this.startedAt) / 1000).toFixed(1),
      jumps: this.jumps,
      landed: this.landed,
      landingRate: +this.landingRate.toFixed(3),
      targetBand: [T.TARGET_LANDING_RATE_NEW, T.TARGET_LANDING_RATE_HOUR],
      groundFraction: +this.groundFraction.toFixed(3),
      longestAirtime: +this.longestAirtime.toFixed(2),
      byQuality: { ...this.byQuality },
      byTier: { ...this.byTier },
      thrustBursts: { ...this.thrustBursts },
      partDeploys: { ...this.partDeploys },
      tearOffs: this.tearOffs,
      recent: this.recent.slice(-10),
    };
  }
}

export default Telemetry;
