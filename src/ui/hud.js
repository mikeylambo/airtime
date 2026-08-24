/**
 * In-run HUD (§2.1).
 *
 * "Boost bar (one bar, §5), airtime timer + rising tone, trick ticker naming
 * tricks *after* they land in the bank, multiplier state, score. HUD fades 50%
 * when airborne — the camera is the UI up there."
 */

import TUNING from '../TUNING.js';

const QUALITY_COLOR = {
  perfect: '#39f0a0', clean: '#59d0ff', sloppy: '#ffd166', crash: '#ff5470',
};
const TIER_LABEL = {
  road: null, rooftop: 'ROOFTOP', billboard: 'BILLBOARD',
  moving: 'MOVING VEHICLE', pool: 'POOL', secret: 'SECRET',
};

const clock = (s) => {
  const m = Math.floor(Math.max(0, s) / 60);
  const r = Math.max(0, s) % 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(0).padStart(2, '0')}`;
};

export class Hud {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-top">
        <div class="hud-clock"><b class="clock-v">1:30</b><i>TIME</i></div>
        <div class="hud-score"><b class="score-v">0</b><i>SCORE</i></div>
        <div class="hud-combo"><b class="combo-v">x1.0</b><i>CHAIN</i></div>
      </div>

      <div class="hud-air">
        <div class="airtime">0.00<span>s</span></div>
        <div class="air-sub">AIRTIME</div>
        <div class="bank">BANK <b>0</b></div>
      </div>

      <div class="hud-ticker"></div>

      <div class="hud-left">
        <div class="boost-wrap">
          <div class="boost-label">BOOST <em class="boost-note"></em></div>
          <div class="boost-track"><div class="boost-fill"></div><div class="boost-thrust"></div></div>
        </div>
        <div class="speed"><span class="speed-n">0</span><span class="speed-u">KM/H</span></div>
      </div>

      <div class="hud-parts"></div>
      <div class="hud-landing"></div>
      <div class="hud-dev"></div>
      <div class="hud-countdown"></div>`;

    const q = (s) => root.querySelector(s);
    this.el = {
      clock: q('.clock-v'), score: q('.score-v'), combo: q('.combo-v'),
      comboBox: q('.hud-combo'),
      boostFill: q('.boost-fill'), boostThrust: q('.boost-thrust'), boostNote: q('.boost-note'),
      speed: q('.speed-n'), airtime: q('.airtime'), air: q('.hud-air'), bank: q('.bank b'),
      ticker: q('.hud-ticker'), parts: q('.hud-parts'), landing: q('.hud-landing'),
      dev: q('.hud-dev'), countdown: q('.hud-countdown'),
    };

    this.slots = ['DOOR_L', 'DOOR_R', 'HOOD', 'TRUNK', 'SPOILER'];
    this.labels = { DOOR_L: 'L·DOOR', DOOR_R: 'R·DOOR', HOOD: 'HOOD', TRUNK: 'TAIL', SPOILER: 'WING' };
    this.el.parts.innerHTML = this.slots
      .map((s) => `<div class="part" data-slot="${s}"><b>${this.labels[s]}</b><i></i></div>`).join('');
    this.partEls = Object.fromEntries(
      this.slots.map((s) => [s, this.el.parts.querySelector(`[data-slot="${s}"]`)])
    );

    this.opacity = 1;
    this.landingHold = 0;
    this.ticker = [];
    this.shownScore = 0;
  }

  /** §2.1: the ticker names tricks only once they are in the bank. */
  showLanding(result) {
    const l = result;
    this.landingHold = 2.6;
    const tier = TIER_LABEL[l.tier] ? ` · ${TIER_LABEL[l.tier]} x${l.tierMult}` : '';
    const head = l.landed ? l.quality.toUpperCase() : 'CRASHED';
    const sub = l.landed
      ? `${Math.round(l.bank)} × ${l.landingMult}${tier}${l.combo > 1 ? ` · CHAIN x${l.combo.toFixed(2)}` : ''}`
      : 'BANK LOST';
    this.el.landing.innerHTML =
      `<span style="color:${QUALITY_COLOR[l.quality]}">${head}</span>` +
      `<em>${sub}</em>` +
      (l.landed ? `<u>+${l.total.toLocaleString()}</u>` : '');
    this.el.landing.classList.add('show');

    for (const t of l.tricks) this.pushTicker(t.name, t.value, l.landed);
  }

  pushTicker(name, value, landed = true) {
    this.ticker.push({ name, value, landed, life: TUNING.UI.TICKER_LIFE });
    while (this.ticker.length > TUNING.UI.TICKER_MAX) this.ticker.shift();
  }

  countdown(n) {
    this.el.countdown.textContent = n > 0 ? String(Math.ceil(n)) : 'GO';
    this.el.countdown.className = `hud-countdown show ${n > 0 ? '' : 'go'}`;
  }

  hideCountdown() { this.el.countdown.className = 'hud-countdown'; }

  update(dt, state, extra = {}) {
    const T = TUNING.HUD;
    const B = TUNING.BOOST;

    // §2.1: fade back while airborne so the camera can do the talking.
    const want = state.airborne ? T.AIRBORNE_FADE : 1;
    this.opacity += (want - this.opacity) * (1 - Math.exp(-dt / (T.FADE_TIME / 3)));
    this.root.style.opacity = this.opacity.toFixed(3);

    this.el.clock.textContent = clock(state.timeLeft);
    this.el.clock.parentElement.classList.toggle('urgent', state.timeLeft <= 10);

    // Score counts up rather than snapping — a jump should feel like it pays.
    this.shownScore += (state.score - this.shownScore) * (1 - Math.exp(-dt * 9));
    if (Math.abs(state.score - this.shownScore) < 1) this.shownScore = state.score;
    this.el.score.textContent = Math.round(this.shownScore).toLocaleString();

    this.el.combo.textContent = `x${state.combo.toFixed(2)}`;
    this.el.comboBox.classList.toggle('live', state.combo > 1);

    this.el.boostFill.style.width = `${(state.boost / B.MAX) * 100}%`;
    this.el.boostFill.classList.toggle('burning', state.boosting);
    this.el.boostThrust.style.left = `${Math.max(0, (state.boost - B.THRUST_COST) / B.MAX) * 100}%`;
    this.el.boostThrust.style.opacity = state.boost >= B.THRUST_COST ? '1' : '0.15';
    this.el.boostNote.textContent = state.oncoming ? 'ONCOMING' : (extra.nearMiss ? 'NEAR MISS' : '');

    this.el.speed.textContent = Math.round(state.groundSpeed * 3.6);
    this.el.airtime.innerHTML = `${state.airtime.toFixed(2)}<span>s</span>`;
    this.el.air.classList.toggle('up', state.airborne);
    this.el.bank.textContent = Math.round(state.bank).toLocaleString();
    this.el.air.classList.toggle('banking', state.bank > 0);

    for (const s of this.slots) {
      const p = state.panels[s];
      const el = this.partEls[s];
      el.classList.toggle('on', p.deploy > 0.5);
      el.classList.toggle('gone', !p.attached);
      el.querySelector('i').style.transform = `scaleX(${p.deploy.toFixed(2)})`;
    }

    if (this.landingHold > 0) {
      this.landingHold -= dt;
      if (this.landingHold <= 0) this.el.landing.classList.remove('show');
    }

    let dirty = false;
    for (const t of this.ticker) { t.life -= dt; if (t.life <= 0) dirty = true; }
    if (dirty) this.ticker = this.ticker.filter((t) => t.life > 0);
    if (dirty || this._tickerCount !== this.ticker.length) {
      this._tickerCount = this.ticker.length;
      this.el.ticker.innerHTML = this.ticker
        .map((t) => `<div class="trick${t.landed ? '' : ' lost'}">${t.name}<b>${t.value}</b></div>`)
        .join('');
    }

    if (T.SHOW_TELEMETRY && extra.telemetry) {
      const s = extra.telemetry.summary();
      this.el.dev.innerHTML =
        `${extra.camera} · ${extra.style} · thrust ${state.thrustLast || '—'}` +
        ` · jumps ${s.jumps} landed ${s.landed} (${(s.landingRate * 100).toFixed(0)}%)` +
        ` · ground ${(s.groundFraction * 100).toFixed(0)}%` +
        ` · near miss ${state.nearMisses} · coins ${state.coinsTaken}`;
    } else if (this.el.dev.innerHTML) this.el.dev.innerHTML = '';
  }
}

export default Hud;
