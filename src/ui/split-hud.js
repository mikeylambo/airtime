/**
 * Per-viewport HUD for split-screen (§9).
 *
 * Deliberately thin. A quartered screen has no room for the trick ticker or the
 * part indicators, and §2.1's rule that the camera is the UI in the air matters
 * more, not less, when the picture is a quarter the size.
 */

import TUNING from '../TUNING.js';
import { layout } from '../render/viewports.js';
import { playerColorCss } from '../render/theme.js';

const QUALITY_COLOR = {
  perfect: '#39ff88', clean: '#2e9aff', sloppy: '#9a2eff', crash: '#ff6ec7',
};
const NAMES = ['P1', 'P2', 'P3', 'P4'];

export class SplitHud {
  constructor(root) {
    this.root = root;
    this.count = 0;
    this.panels = [];
  }

  setCount(n) {
    if (n === this.count) return;
    this.count = n;
    this.root.innerHTML = '';
    this.panels = [];
    const rects = layout(n);
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = `vp vp-${n}`;
      // One accent end-to-end (AFTERGLOW): the quarter wears its player's colour.
      el.style.setProperty('--pc', playerColorCss(i));
      const r = rects[i];
      // CSS y runs down; the viewport rects run up.
      el.style.left = `${r[0] * 100}%`;
      el.style.bottom = `${r[1] * 100}%`;
      el.style.width = `${r[2] * 100}%`;
      el.style.height = `${r[3] * 100}%`;
      el.innerHTML = `
        <div class="vp-tag">${NAMES[i]}</div>
        <div class="vp-score"><b>0</b><i>x1.0</i></div>
        <div class="vp-air">0.00<span>s</span></div>
        <div class="vp-boost"><div></div></div>
        <div class="vp-land"></div>
        <div class="vp-out">OUT</div>`;
      this.root.appendChild(el);
      this.panels.push({
        el,
        score: el.querySelector('.vp-score b'),
        combo: el.querySelector('.vp-score i'),
        air: el.querySelector('.vp-air'),
        boost: el.querySelector('.vp-boost > div'),
        land: el.querySelector('.vp-land'),
        out: el.querySelector('.vp-out'),
        hold: 0,
      });
    }
  }

  /** The colourblind option swapped the palette — repaint the quarters. */
  recolor() {
    this.panels.forEach((p, i) => p.el.style.setProperty('--pc', playerColorCss(i)));
  }

  showLanding(i, result) {
    const p = this.panels[i];
    if (!p) return;
    p.hold = 2.0;
    p.land.innerHTML = `<span style="color:${QUALITY_COLOR[result.quality]}">${
      result.landed ? result.quality.toUpperCase() : 'BROKEN'}</span>` +
      (result.landed ? `<em>+${result.total.toLocaleString()}</em>` : '');
    p.land.classList.add('show');
  }

  update(dt, states) {
    for (let i = 0; i < this.panels.length; i++) {
      const p = this.panels[i];
      const s = states[i];
      if (!s) continue;
      p.score.textContent = Math.round(s.score).toLocaleString();
      p.combo.textContent = `x${s.combo.toFixed(2)}`;
      p.combo.style.color = s.combo > 1 ? 'var(--pc)' : 'var(--faint)';
      p.air.innerHTML = `${s.airtime.toFixed(2)}<span>s</span>`;
      p.air.classList.toggle('up', s.airborne);
      p.boost.style.width = `${(s.boost / TUNING.BOOST.MAX) * 100}%`;
      p.out.style.display = s.alive ? 'none' : '';
      p.el.classList.toggle('dead', !s.alive);
      if (p.hold > 0) {
        p.hold -= dt;
        if (p.hold <= 0) p.land.classList.remove('show');
      }
    }
  }
}

export default SplitHud;
