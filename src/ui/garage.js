/**
 * The garage (§7).
 *
 * "The garage question is 'what can my car do in the air', not 'what are its
 * stats'." So every change re-resolves the setup and fires the live preview
 * jump — you are never reading a number to find out what a part does, you are
 * watching the car do it.
 */

import TUNING from '../TUNING.js';
import { Screen, makeList } from './screens.js';
import { CARS, PART_VARIANTS, LIVERIES, SLIDERS, findCar, findVariant } from '../sim/cars.js';
import { medalCount } from '../storage/profiles.js';
import { wallClips } from '../storage/clips.js';
import { REGIONS } from '../sim/wear.js';

const TABS = ['CAR', 'TUNE', 'PARTS', 'LIVERY', 'BODY'];
const bar = (v) => {
  const n = Math.round(v * 12);
  return `<span class="slider">${'█'.repeat(n)}${'░'.repeat(12 - n)}</span>`;
};

export function buildGarage(mgr, game) {
  let tab = 0;
  let list;
  const $ = (s) => document.querySelector(s);

  const unlocked = (need) => medalCount(game.profile) >= need;

  const items = () => {
    const p = game.profile;
    if (tab === 0) {
      return CARS.map((c) => ({
        // Never gated. A car is a different way to play, not a stronger one,
        // so unlocking one would be selling a tier — see ROADMAP.
        label: c.name, car: c, locked: false,
        note: p.car === c.id ? '● equipped' : (c.owns || c.archetype),
      }));
    }
    if (tab === 1) {
      return SLIDERS.map((s) => ({
        label: s.label, slider: s,
        note: `${s.low} ${bar(p.tune[s.key])} ${s.high}`,
      }));
    }
    if (tab === 4) {
      // R7: the paintwork. Scuffing is the only thing in the game that
      // accumulates across runs, and the only way to clear it is here —
      // which is what makes a session visible on the car.
      const w = game.wear;
      const rows = REGIONS.map((r) => ({
        label: r.toUpperCase(), region: r,
        note: `${bar(w ? w.scuffAt(r) : 0)} ${Math.round((w ? w.scuffAt(r) : 0) * 100)}%`,
      }));
      return [...rows, { label: 'RESPRAY', repair: true, note: 'clear every mark' }];
    }
    if (tab === 2) {
      return Object.keys(PART_VARIANTS).map((slot) => {
        const v = findVariant(slot, p.parts[slot]);
        return { label: slot.toUpperCase(), slot, note: `${v.name} — ${v.note}` };
      });
    }
    return LIVERIES.map((l) => ({
      label: l.name, livery: l, locked: !unlocked(l.unlock),
      note: !unlocked(l.unlock) ? `${l.unlock} medals` : (p.livery === l.id ? '● equipped' : ''),
    }));
  };

  const renderTabs = () => {
    $('#gar-tabs').innerHTML = TABS
      .map((t, i) => `<span class="tab${i === tab ? ' on' : ''}">${t}</span>`).join('');
  };

  /** §8: "best clips auto-hang in the garage; the trophy case is your own footage." */
  const renderWall = () => {
    const clips = wallClips(game.profileIndex, 5);
    $('#gar-wall').innerHTML = clips.length
      ? `<div class="wall-label">GARAGE WALL</div>` + clips.map((c) =>
          `<div class="wall-clip"><b>${(c.info.total || 0).toLocaleString()}</b>` +
          `<em>${c.info.quality} · ${c.info.airtime}s</em></div>`).join('')
      : `<div class="wall-label">GARAGE WALL — empty. Land something worth keeping.</div>`;
  };

  const renderCard = () => {
    const p = game.profile;
    const c = findCar(p.car);
    $('#gar-card').innerHTML = `
      <h3>${c.name}</h3><p>${c.blurb}</p>
      <div class="stat">
        ${Object.keys(PART_VARIANTS).map((s) => `${s}: ${findVariant(s, p.parts[s]).name}`).join(' · ')}
      </div>`;
  };

  const refresh = (preview = true) => {
    list.setItems(items());
    renderTabs();
    renderCard();
    renderWall();
    if (preview) game.previewJump();
  };

  mgr.register(new Screen('garage', {
    html: `<div class="veil"></div><div class="pane">
      <div class="eyebrow">Garage</div>
      <div id="gar-tabs" class="tabs"></div>
      <div class="list" id="gar-list"></div>
      <div class="card" id="gar-card" style="max-width:430px"></div>
      <div id="gar-wall" class="wall"></div>
      <div class="hint"><b>←→</b> change · <b>Q/E</b> tab · <b>A</b> equip · <b>B</b> back</div>
    </div>`,
    onEnter: () => {
      list = makeList(document.getElementById('gar-list'), items(), (it) => {
        const p = game.profile;
        if (it.car) p.car = it.car.id;
        else if (it.livery) p.livery = it.livery.id;
        else if (it.repair) game.repairCar();
        else if (it.slot) cycleVariant(it.slot, 1);
        game.saveProfiles();
        refresh();
      });
      renderTabs();
      renderCard();
      renderWall();
      game.previewJump();
    },
    onExit: () => game.endPreview(),
    onMenu: (m) => {
      if (m.back) return mgr.back('main');
      const p = game.profile;

      // Tabs on the shoulder-ish keys; left/right edits whatever is selected.
      if (game.input.keys.has('KeyQ') || game.input.keys.has('KeyE')) {
        tab = (tab + (game.input.keys.has('KeyE') ? 1 : -1) + TABS.length) % TABS.length;
        game.input.keys.delete('KeyQ'); game.input.keys.delete('KeyE');
        refresh(false);
        return;
      }
      if (m.left || m.right) {
        const it = list.item;
        const d = m.right ? 1 : -1;
        if (it.slider) {
          p.tune[it.slider.key] = Math.max(0, Math.min(1, p.tune[it.slider.key] + d * 0.1));
        } else if (it.slot) cycleVariant(it.slot, d);
        else if (it.car && !it.locked) p.car = it.car.id;
        else if (it.livery && !it.locked) p.livery = it.livery.id;
        game.saveProfiles();
        refresh();
        return;
      }
      list.handle(m);
    },
  }));

  function cycleVariant(slot, d) {
    const p = game.profile;
    const all = PART_VARIANTS[slot].filter((v) => unlocked(v.unlock));
    const i = all.findIndex((v) => v.id === p.parts[slot]);
    p.parts[slot] = all[((i < 0 ? 0 : i) + d + all.length) % all.length].id;
  }

  return mgr;
}
