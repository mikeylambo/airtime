/**
 * Licence tests (§8). The boards live in ui/mastery.js since R9.
 */

import TUNING from '../TUNING.js';
import { Screen, makeList } from './screens.js';
import { LICENCES, licenceScore, licenceRank } from '../game/licences.js';

const gradeDot = (g) => (g ? `<span class="medal ${g}">${g}</span>` : '—');

export function buildProgress(mgr, game) {
  let list;

  // ── Licence tests (§8: GT-style grid, bronze -> gold) ───────────────────
  mgr.register(new Screen('licences', {
    html: `<div class="veil"></div><div class="pane">
      <div class="eyebrow" id="lic-eyebrow">Licences</div>
      <h2 class="title">LICENCES</h2>
      <p class="kicker">learn by being asked</p>
      <div class="list" id="lic-list"></div>
      <div class="card" id="lic-card" style="max-width:440px"></div>
      <div class="hint"><b>A</b> attempt · <b>B</b> back</div>
    </div>`,
    onEnter: () => {
      const p = game.profile;
      document.getElementById('lic-eyebrow').textContent =
        `Licences · ${licenceScore(p)}/${LICENCES.length * 3} points`;
      const card = document.getElementById('lic-card');
      const items = LICENCES.map((t, i) => {
        // Each test needs the one before it, so the order teaches in order.
        const prev = i === 0 ? true : !!p.licences[LICENCES[i - 1].id];
        return {
          label: t.name, test: t, locked: !prev,
          note: prev ? gradeDot(p.licences[t.id]) : 'locked',
        };
      });
      list = makeList(document.getElementById('lic-list'), items,
        (it) => game.startLicence(it.test),
        (it) => {
          const g = p.licences[it.test.id];
          card.innerHTML = `<h3>${it.test.name}</h3><p>${it.test.brief}</p>
            <div class="stat">${it.test.teaches}</div>
            <div class="stat">bronze ${it.test.tiers.bronze} · silver ${it.test.tiers.silver} · gold ${it.test.tiers.gold} ${it.test.unit}
            ${g ? ` — you have ${g}` : ''}</div>`;
        });
      const first = LICENCES[0];
      card.innerHTML = `<h3>${first.name}</h3><p>${first.brief}</p><div class="stat">${first.teaches}</div>`;
    },
    onMenu: (m) => { if (m.back) mgr.back('main'); else list.handle(m); },
  }));

  // The leaderboard screen moved to ui/mastery.js in R9, where it became
  // seven boards behind one screen. Nothing here needs to know about them.

  // ── Licence result ─────────────────────────────────────────────────────
  mgr.register(new Screen('licresult', {
    html: `<div class="veil full"></div><div class="pane">
      <div class="eyebrow" id="lr-eyebrow">Licence</div>
      <div class="bigscore" id="lr-value">0</div>
      <div class="medal" id="lr-grade"></div>
      <div class="blurb" id="lr-brief"></div>
      <div class="list" id="lr-actions"></div>
    </div>`,
    onEnter: (_c, data) => {
      const { test, result } = data;
      document.getElementById('lr-eyebrow').textContent = `Licence · ${test.name}`;
      document.getElementById('lr-value').textContent = `${result.value} ${result.unit}`;
      const g = document.getElementById('lr-grade');
      g.textContent = result.grade ? `${result.grade} licence` : 'not passed';
      g.className = `medal ${result.grade || ''}`;
      document.getElementById('lr-brief').textContent = test.teaches;
      const l = makeList(document.getElementById('lr-actions'), [
        { label: 'AGAIN', note: test.brief },
        { label: 'LICENCES', note: '' },
      ], (it) => {
        if (it.label === 'AGAIN') game.startLicence(test);
        else mgr.go('licences');
      });
      mgr.get('licresult')._list = l;
    },
    onMenu: (m, ctx) => {
      const l = mgr.get('licresult')._list;
      if (m.back) mgr.go('licences'); else l.handle(m);
    },
  }));

  return mgr;
}
