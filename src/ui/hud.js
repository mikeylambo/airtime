/**
 * In-run HUD (§2.1). At Gate A this is deliberately a diagnostic panel as much
 * as a HUD: the boost bar and airtime timer are the real thing, and everything
 * under them exists so a playtester can see why the car did what it did.
 *
 * "HUD fades 50% when airborne — the camera is the UI up there" (§2.1).
 */

import TUNING from '../TUNING.js';

const QUALITY_COLOR = {
  perfect: '#39f0a0', clean: '#59d0ff', sloppy: '#ffd166', crash: '#ff5470',
};

export class Hud {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-left">
        <div class="boost-wrap">
          <div class="boost-label">BOOST</div>
          <div class="boost-track"><div class="boost-fill"></div><div class="boost-thrust"></div></div>
        </div>
        <div class="speed"><span class="speed-n">0</span><span class="speed-u">KM/H</span></div>
      </div>
      <div class="hud-air">
        <div class="airtime">0.00<span>s</span></div>
        <div class="air-sub">AIRTIME</div>
      </div>
      <div class="hud-right">
        <div class="cam-line"><span class="k">CAMERA</span> <span class="cam-v">—</span></div>
        <div class="cam-line"><span class="k">STYLE</span> <span class="style-v">—</span></div>
        <div class="cam-line"><span class="k">THRUST</span> <span class="thrust-v">—</span></div>
      </div>
      <div class="hud-parts"></div>
      <div class="hud-landing"></div>
      <div class="hud-tel"></div>`;

    this.el = {
      boostFill: root.querySelector('.boost-fill'),
      boostThrust: root.querySelector('.boost-thrust'),
      speed: root.querySelector('.speed-n'),
      airtime: root.querySelector('.airtime'),
      air: root.querySelector('.hud-air'),
      cam: root.querySelector('.cam-v'),
      style: root.querySelector('.style-v'),
      thrust: root.querySelector('.thrust-v'),
      parts: root.querySelector('.hud-parts'),
      landing: root.querySelector('.hud-landing'),
      tel: root.querySelector('.hud-tel'),
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
  }

  showLanding(l) {
    this.landingHold = 2.4;
    const tier = l.tier && l.tier !== 'road' ? ` · ${l.tier.toUpperCase()}` : '';
    this.el.landing.innerHTML =
      `<span style="color:${QUALITY_COLOR[l.quality]}">${l.quality.toUpperCase()}</span>` +
      `<em>${l.angleDeg.toFixed(0)}° · ${l.wheels} wheels · ${l.airtime.toFixed(2)}s${tier}</em>`;
    this.el.landing.classList.add('show');
  }

  update(dt, state, cameraBehavior, style, telemetry) {
    const T = TUNING.HUD;
    const B = TUNING.BOOST;

    // §2.1: fade back while airborne so the camera can do the talking.
    const want = state.airborne ? T.AIRBORNE_FADE : 1;
    this.opacity += (want - this.opacity) * (1 - Math.exp(-dt / (T.FADE_TIME / 3)));
    this.root.style.opacity = this.opacity.toFixed(3);

    this.el.boostFill.style.width = `${(state.boost / B.MAX) * 100}%`;
    this.el.boostFill.classList.toggle('burning', state.boosting);
    // Marks the slice one air burst costs, so the §5 tradeoff is legible.
    this.el.boostThrust.style.left = `${Math.max(0, (state.boost - B.THRUST_COST) / B.MAX) * 100}%`;
    this.el.boostThrust.style.opacity = state.boost >= B.THRUST_COST ? '1' : '0.15';

    this.el.speed.textContent = Math.round(state.groundSpeed * 3.6);
    this.el.airtime.innerHTML = `${state.airtime.toFixed(2)}<span>s</span>`;
    this.el.air.classList.toggle('up', state.airborne);

    this.el.cam.textContent = cameraBehavior;
    this.el.style.textContent = style;
    this.el.thrust.textContent = state.thrustActive
      ? `${state.thrustMode.toUpperCase()} ▮` : (state.thrustLast ? state.thrustLast : '—');
    this.el.thrust.className = `thrust-v ${state.thrustActive ? 'live' : ''}`;

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

    if (T.SHOW_TELEMETRY && telemetry) {
      const s = telemetry.summary();
      this.el.tel.innerHTML =
        `jumps ${s.jumps} · landed ${s.landed} · rate ${(s.landingRate * 100).toFixed(0)}%` +
        ` <em>(target ${s.targetBand[0] * 100}–${s.targetBand[1] * 100}%)</em>` +
        ` · ground ${(s.groundFraction * 100).toFixed(0)}% <em>(§5 wants ~70%)</em>` +
        ` · best air ${s.longestAirtime.toFixed(2)}s`;
    }
  }
}

export default Hud;
