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
import { CARS, PART_VARIANTS, LIVERIES, SLIDERS, findCar, findVariant, resolveSetup } from '../sim/cars.js';
import { medalCount } from '../storage/profiles.js';
import { wallClips } from '../storage/clips.js';
import { REGIONS } from '../sim/wear.js';

const TABS = ['CAR', 'TUNE', 'PARTS', 'LIVERY', 'BODY'];
// §3: "no bars." A slider reads as a restrained percentage between its two
// named ends, not a wall of blocks — the number is the whole message.
const pct = (v) => `${Math.round(v * 100)}%`;

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
        note: `${s.low} · ${pct(p.tune[s.key])} · ${s.high}`,
      }));
    }
    if (tab === 4) {
      // R7: the paintwork. Scuffing is the only thing in the game that
      // accumulates across runs, and the only way to clear it is here —
      // which is what makes a session visible on the car.
      const w = game.wear;
      const rows = REGIONS.map((r) => ({
        label: r.toUpperCase(), region: r,
        note: `${pct(w ? w.scuffAt(r) : 0)} scuffed`,
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

  // Shows the equipped car by default, or a car passed in — so scrolling the
  // CAR list can describe whichever car is highlighted, not only the equipped
  // one.
  // §3: the garage is a materiality showcase, not a stat sheet. A number and a
  // word by default, restrained and no bars; DETAILS opens the full sheet for
  // anyone who wants it. Toggled with Y (the `details` flag).
  let details = false;
  const renderCard = (car = null) => {
    const p = game.profile;
    const c = car || findCar(p.car);
    const setup = resolveSetup({ ...p, car: c.id });
    const w = setup.wheel;
    const comZ = TUNING.CAR.COM.z;
    // Static weight split: the front axle carries the fraction of the car that
    // sits behind the CoM (nearer the rear), and vice versa.
    const frontFrac = (w.rearZ - comZ) / (w.rearZ - w.frontZ);
    const front = Math.round(frontFrac * 100);
    if (details) {
      $('#gar-card').innerHTML = `
        <h3>${c.name}</h3><p>${c.blurb}</p>
        <div class="stat">${Math.round(setup.mass).toLocaleString()} KG · ${front} / ${100 - front} · ${c.archetype.toUpperCase()}</div>
        <div class="stat">${Object.keys(PART_VARIANTS).map((s) => `${s}: ${findVariant(s, p.parts[s]).name}`).join(' · ')}</div>
        <div class="stat">${SLIDERS.map((s) => `${s.label} ${pct(p.tune[s.key])}`).join(' · ')}</div>
        <div class="stat" style="opacity:.5">Y — hide details</div>`;
    } else {
      // One number, one word — the whole message (§3).
      $('#gar-card').innerHTML = `
        <h3>${c.name}</h3>
        <div class="stat" style="font-size:1.3em">${Math.round(setup.mass).toLocaleString()} KG</div>
        <div class="stat" style="opacity:.5">${c.owns || c.archetype} · Y for details</div>`;
    }
  };

  // Highlighting a car on the CAR tab previews it doing the jump — every car
  // shown, not just the equipped one — without committing the choice. The
  // preview rebuilds the world, so it is debounced to the frame the cursor
  // settles on rather than fired on every step of a fast scroll.
  let previewTimer = 0;
  const onMove = (it) => {
    if (tab !== 0 || !it || !it.car) return;
    renderCard(it.car);
    clearTimeout(previewTimer);
    const id = it.car.id;
    previewTimer = setTimeout(() => game.previewJump(id), 90);
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
      <div class="hint"><b>←→</b> change · <b>Q/E</b> tab · <b>Y</b> details · <b>A</b> equip · <b>B</b> back</div>
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
      }, onMove);
      renderTabs();
      renderCard();
      renderWall();
      game.previewJump();
    },
    onExit: () => game.endPreview(),
    onMenu: (m) => {
      if (m.back) return mgr.back('main');
      const p = game.profile;

      // Y opens the full tuning sheet; default is a number and a word (§3).
      if (m.alt) {
        details = !details;
        renderCard(tab === 0 && list.item && list.item.car ? list.item.car : null);
        return;
      }

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
