/**
 * In-run HUD (§2.1).
 *
 * "Boost bar (one bar, §5), airtime timer + rising tone, trick ticker naming
 * tricks *after* they land in the bank, multiplier state, score. HUD fades 50%
 * when airborne — the camera is the UI up there."
 */

import TUNING from '../TUNING.js';

// AFTERGLOW tokens (mirrors render/theme.js): GREEN is the perfect landing,
// BLUE the routine one, VIOLET the scruffy save, PINK the crash — heat.
const QUALITY_COLOR = {
  perfect: '#39ff88', clean: '#2e9aff', sloppy: '#9a2eff', crash: '#ff6ec7',
};
/** Colour ramps with the count — the player should feel the tier before reading it. */
const FACET_COLOR = (n) =>
  n >= 9 ? '#ff2e9a' : n >= 7 ? '#ff6ec7' : n >= 5 ? '#39ff88' : n >= 3 ? '#2e9aff' : '#8f93ad';

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
        <div class="hud-combo"><b class="combo-v">x1.0</b><i>COMBO</i></div>
      </div>

      <div class="hud-air">
        <div class="airtime">0.00<span>s</span></div>
        <div class="air-sub">AIRTIME</div>
        <div class="bank">BANK <b>0</b></div>
        <div class="facets"><b class="facet-n">0</b><i class="facet-name"></i><u class="purity"></u></div>
      </div>

      <div class="hud-ticker"></div>
      <div class="hud-ghost"></div>

      <div class="hud-left">
        <div class="boost-wrap">
          <div class="boost-label">BOOST <em class="boost-note"></em></div>
          <div class="boost-track"><div class="boost-fill"></div><div class="boost-thrust"></div></div>
        </div>
        <div class="speed"><span class="speed-n">0</span><span class="speed-u">KM/H</span></div>
      </div>

      <div class="hud-parts"></div>
      <div class="hud-landing"></div>
      <div class="hud-gap"></div>
      <div class="hud-lines"></div>
      <div class="hud-dev"></div>
      <div class="hud-countdown"></div>`;

    const q = (s) => root.querySelector(s);
    this.el = {
      clock: q('.clock-v'), score: q('.score-v'), combo: q('.combo-v'),
      comboBox: q('.hud-combo'),
      boostFill: q('.boost-fill'), boostThrust: q('.boost-thrust'), boostNote: q('.boost-note'),
      ghost: q('.hud-ghost'),
      speed: q('.speed-n'), airtime: q('.airtime'), air: q('.hud-air'), bank: q('.bank b'),
      ticker: q('.hud-ticker'), parts: q('.hud-parts'), landing: q('.hud-landing'),
      gap: q('.hud-gap'), lines: q('.hud-lines'),
      facetN: q('.facet-n'), facetName: q('.facet-name'), purity: q('.purity'),
      dev: q('.hud-dev'), countdown: q('.hud-countdown'),
    };

    this.slots = ['DOOR_L', 'DOOR_R', 'HOOD', 'TRUNK', 'SPOILER'];
    // Aero surfaces, not bodywork. R2 collapsed eight panel verbs into one
    // stick and the panels became actuators rather than controls — this is what
    // that already was, finally saying so. "L·DOOR" reads like a bug report;
    // an aero system is what the player is actually flying.
    this.labels = {
      DOOR_L: 'L·AERO', DOOR_R: 'R·AERO', HOOD: 'SPLITTER', TRUNK: 'DIFFUSER', SPOILER: 'WING',
    };
    this.el.parts.innerHTML = this.slots
      .map((s) => `<div class="part" data-slot="${s}"><b>${this.labels[s]}</b><i></i></div>`).join('');
    this.partEls = Object.fromEntries(
      this.slots.map((s) => [s, this.el.parts.querySelector(`[data-slot="${s}"]`)])
    );

    this.opacity = 1;
    this.landingHold = 0;
    this.gapHold = 0;

    // Speed lines (R7): a fixed radial fan built once. Streaks are the cheapest
    // way to make speed read on footage, and they have to arrive *with* speed
    // rather than being always-on, or they stop meaning anything.
    for (let i = 0; i < 26; i++) {
      const s = document.createElement('i');
      const a = (i / 26) * 360 + (i % 2 ? 7 : -7);
      s.style.setProperty('--a', `${a}deg`);
      // Distances are from the screen centre, so anything much past 30vmax is
      // simply outside the frame — the first pass pushed the whole fan off the
      // edges and three streaks out of twenty-six were visible.
      s.style.setProperty('--d', `${13 + (i * 37) % 17}vmax`);
      s.style.height = `${20 + (i * 23) % 26}vmin`;
      this.el.lines.appendChild(s);
    }
    this.ticker = [];
    this.shownScore = 0;
  }

  /**
   * The cash-out. The count and its name lead, because the count is the point:
   * the player has to learn that *variety* is what breaks the score open.
   */
  showLanding(result) {
    const l = result;
    this.landingHold = 3.0;
    const tier = TIER_LABEL[l.tier] ? ` · ${TIER_LABEL[l.tier]} ×${l.tierMult}` : '';
    const head = l.landed
      ? (l.facetName || l.quality.toUpperCase())
      : 'BROKEN';
    const chain = l.combo > 1 ? ` · COMBO ×${l.combo.toFixed(2)}` : '';
    const sub = l.landed
      ? `${l.facetCount} FACETS ×${l.facetMult} · ${l.purity.label} ×${l.purity.mult} · ${l.quality.toUpperCase()} ×${l.landingMult}${tier}${chain}`
      : `${Math.round(l.bank).toLocaleString()} LOST`;
    this.el.landing.innerHTML =
      `<span style="color:${l.landed ? FACET_COLOR(l.facetCount) : QUALITY_COLOR.crash}">${head}</span>` +
      `<em>${sub}</em>` +
      (l.landed ? `<u>+${l.total.toLocaleString()}</u>` : '');
    this.el.landing.classList.add('show');
    this.el.landing.classList.toggle('big', l.facetCount >= 6);

    for (const t of l.facets) this.pushTicker(t.label, t.value, l.landed);
    // A named gap is a place, so it gets its own line rather than joining the
    // facet list — you crossed something, you did not do something.
    if (l.gap) {
      this.pushTicker(l.gap.first ? `${l.gap.name} — NEW` : l.gap.name, l.gap.bonus, true);
    }
  }

  /**
   * Speed streaks. Opacity and reach both track speed, so slow is clean and
   * fast is loud, and the transition is where the sense of speed comes from.
   */
  speedLines(speed, airborne) {
    const F = TUNING.FX;
    const v = Math.max(0, Math.min(1, (speed - F.LINES_FROM) / (F.LINES_FULL - F.LINES_FROM)));
    // Slightly stronger in the air: nothing else out there gives you a sense
    // of how fast you are moving.
    const k = v * (airborne ? 1.25 : 1);
    this.el.lines.style.opacity = (k * F.LINES_MAX_OPACITY).toFixed(3);
    // Streaks reach further out as speed rises, so the fan opens up.
    this.el.lines.style.setProperty('--reach', (1 + k * 0.3).toFixed(3));
  }

  /** A gap crossing, called out the moment it lands. */
  showGap(gap) {
    this.gapHold = 2.6;
    this.el.gap.innerHTML = (gap.first ? '<b>GAP DISCOVERED</b>' : '<b>GAP</b>') +
      `<span>${gap.name}</span><u>+${gap.bonus.toLocaleString()}</u>`;
    this.el.gap.className = `hud-gap show${gap.first ? ' first' : ''}`;
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

    // R9: the ghost's delta. This is the one number that turns a translucent
    // car into an opponent — a shape on the road is scenery until it is
    // attached to "you are 2,400 up on it right now".
    const g = extra.ghost;
    if (g) {
      const d = Math.round(g.delta);
      this.el.ghost.innerHTML =
        `<b>${d >= 0 ? '+' : '−'}${Math.abs(d).toLocaleString()}</b><i>${g.name}</i>`;
      this.el.ghost.className = `hud-ghost show ${d >= 0 ? 'ahead' : 'behind'}`;
    } else this.el.ghost.className = 'hud-ghost';

    this.el.speed.textContent = Math.round(state.groundSpeed * 3.6);
    this.el.airtime.innerHTML = `${state.airtime.toFixed(2)}<span>s</span>`;
    this.el.air.classList.toggle('up', state.airborne);
    this.el.bank.textContent = Math.round(state.bank).toLocaleString();
    this.el.air.classList.toggle('banking', state.bank > 0);

    // Live facet count, so the player can see the stack building mid-flight.
    const n = state.liveFacets ? state.liveFacets.count : 0;
    this.el.facetN.textContent = n || '';
    this.el.facetName.textContent = (state.liveFacets && state.liveFacets.name) || '';
    this.el.facetN.style.color = FACET_COLOR(n);
    const pur = state.liveFacets && state.liveFacets.purity;
    this.el.purity.textContent = state.airborne && pur ? pur.label : '';
    this.el.purity.className = `purity ${pur ? pur.id : ''}`;

    for (const s of this.slots) {
      const p = state.panels[s];
      const el = this.partEls[s];
      el.classList.toggle('on', p.deploy > 0.5);
      el.classList.toggle('gone', !p.attached);
      el.querySelector('i').style.transform = `scaleX(${p.deploy.toFixed(2)})`;
    }

    if (this.gapHold > 0) {
      this.gapHold -= dt;
      if (this.gapHold <= 0) this.el.gap.className = 'hud-gap';
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
