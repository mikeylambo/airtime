/**
 * The frame (§2 / §2.1) — every screen, and the tissue between them.
 *
 * Frame rule (§2.1): every screen must answer "what do I press to be in the
 * air in <= 3 inputs." From the main menu that is A (Play last), countdown,
 * throttle — so the returning player never navigates at all.
 */

import TUNING from '../TUNING.js';
import { Screen, makeList } from './screens.js';
import { STYLES } from '../render/art.js';
import { medalCount, medalRank } from '../storage/profiles.js';
import { buildGarage } from './garage.js';

export const MODES = [
  { id: 'stunt', label: 'STUNT', arena: 'park',
    rules: 'Most points in a timed round. The Rush rule.' },
  { id: 'shot', label: 'CALL YOUR SHOT', arena: 'city',
    rules: 'Name a landing target before you launch. Hit it for a multiplier.' },
  { id: 'standing', label: 'LAST CAR STANDING', arena: 'park',
    rules: 'Crash and you are out. Last car live wins.' },
  { id: 'potato', label: 'HOT POTATO', arena: 'city',
    rules: 'One marked zone, relocating every 20s. Only landings inside it score.' },
  { id: 'party', label: 'PARTY', arena: 'park',
    rules: 'Split-screen, or one pad passed around. 45s turns.' },
];

export const ARENAS = [
  { id: 'park', label: 'STUNT PARK', blurb: 'Ramps, gaps and pipes. Nothing to hit but the ground.', medals: 0 },
  { id: 'city', label: 'CITY BLOCK', blurb: 'Every rooftop is a landing. Every billboard is a dare.', medals: 4 },
];

const medalDot = (m) => (m ? `<span class="medal ${m}">${m[0].toUpperCase()}</span>` : '·');

export function buildFrame(mgr, game) {
  const S = (name, opts) => mgr.register(new Screen(name, opts));

  // ── Title / attract (§2.1) ───────────────────────────────────────────────
  S('title', {
    html: `
      <div class="veil full"></div>
      <div class="pane center">
        <h1 class="logo">AIRTIME</h1>
        <div class="eyebrow">Rush 2049 stunt frame</div>
        <div class="hint blink" style="margin-top:2rem"><b>PRESS START</b></div>
        <div class="hint">Three.js + Rapier · tease-thrust · body-as-trick · dynamic airtime camera</div>
      </div>`,
    onEnter: () => { game.idle = 0; },
    onMenu: (m) => { if (m.confirm || m.start) mgr.go('profile'); },
  });

  // ── Profile select (§2: 3 slots) ─────────────────────────────────────────
  let profileList;
  S('profile', {
    html: `<div class="veil"></div><div class="pane">
      <div class="eyebrow">Profile</div>
      <h2 class="title">WHO IS DRIVING</h2>
      <div class="list" id="profile-list"></div>
      <div class="hint"><b>↑↓</b> choose · <b>A</b> select · <b>B</b> back</div>
    </div>`,
    onEnter: () => {
      const items = game.profiles.map((p) => ({
        label: p.name,
        note: p.created
          ? `${medalCount(p)} medals · ${p.runs} runs · best ${(p.best['park:stunt'] || 0).toLocaleString()}`
          : 'empty slot',
      }));
      profileList = makeList(document.getElementById('profile-list'), items, (_it, i) => {
        game.selectProfile(i);
        mgr.go('main');
      });
    },
    onMenu: (m) => { if (m.back) mgr.go('title'); else profileList.handle(m); },
  });

  // ── Main menu (§2.1: car centre-stage, menu items beside it) ─────────────
  let mainList;
  S('main', {
    html: `<div class="veil"></div><div class="pane">
      <div class="eyebrow" id="main-who">DRIVER 1</div>
      <h1 class="logo" style="font-size:clamp(2rem,6vw,3.6rem)">AIRTIME</h1>
      <div class="list" id="main-list"></div>
      <div class="card" id="daily" style="max-width:380px;margin-top:1rem"></div>
      <div class="hint"><b>A</b> select · <b>B</b> back · <b>START</b> play last</div>
    </div>`,
    onEnter: () => {
      document.getElementById('main-who').textContent =
        `${game.profile.name} · ${medalCount(game.profile)} medals`;
      const last = `${game.lastMode.label} · ${game.lastArena.label}`;
      mainList = makeList(document.getElementById('main-list'), [
        { label: 'PLAY', note: last },
        { label: 'GARAGE', note: 'car, tuning, parts, livery' },
        { label: 'REPLAYS', note: `${game.replays.length} saved` },
        { label: 'DAILY LINE', note: game.dailyLabel() },
        { label: 'LICENCES', note: `${Object.keys(game.profile.licences).length}/${game.licences.length}` },
        { label: 'OPTIONS', note: '' },
      ], (it) => {
        if (it.label === 'PLAY') mgr.push('mode');
        else if (it.label === 'GARAGE') mgr.push('garage');
        else if (it.label === 'REPLAYS') mgr.push('replays');
        else if (it.label === 'DAILY LINE') game.startRun(game.lastMode, game.lastArena, { daily: true });
        else if (it.label === 'LICENCES') mgr.push('licences');
        else if (it.label === 'OPTIONS') mgr.push('options');
      });
      document.getElementById('daily').innerHTML =
        `<h3>DAILY LINE</h3><p>${game.dailyLabel()}</p>` +
        `<div class="stat">best today ${(game.dailyBest() || 0).toLocaleString()}</div>`;
    },
    onMenu: (m) => {
      if (m.back) mgr.go('profile');
      // §2.1: one press from the menu and you are already driving.
      else if (m.start) game.startRun(game.lastMode, game.lastArena);
      else mainList.handle(m);
    },
  });

  // ── Mode select (§2.1: five cards) ───────────────────────────────────────
  let modeList;
  S('mode', {
    html: `<div class="veil"></div><div class="pane">
      <div class="eyebrow">Mode</div><h2 class="title">WHAT ARE WE PLAYING</h2>
      <div class="list" id="mode-list"></div>
      <div class="blurb" id="mode-rules"></div>
      <div class="hint"><b>A</b> select · <b>B</b> back</div>
    </div>`,
    onEnter: () => {
      const rules = document.getElementById('mode-rules');
      modeList = makeList(
        document.getElementById('mode-list'),
        MODES.map((m) => ({ label: m.label, note: `default: ${m.arena}`, mode: m,
          locked: m.id !== 'stunt' })),
        (it) => { game.lastMode = it.mode; mgr.push('arena'); },
        (it) => { rules.textContent = it.mode.rules + (it.locked ? '   —   not in this build' : ''); }
      );
      rules.textContent = MODES[0].rules;
    },
    onMenu: (m) => { if (m.back) mgr.back('main'); else modeList.handle(m); },
  });

  // ── Arena select (§2.1: any mode on any arena) ───────────────────────────
  let arenaList;
  S('arena', {
    html: `<div class="veil"></div><div class="pane">
      <div class="eyebrow">Arena</div><h2 class="title">WHERE</h2>
      <div class="list" id="arena-list"></div>
      <div class="blurb" id="arena-blurb"></div>
      <div class="hint"><b>A</b> select · <b>B</b> back</div>
    </div>`,
    onEnter: () => {
      const blurb = document.getElementById('arena-blurb');
      arenaList = makeList(
        document.getElementById('arena-list'),
        ARENAS.map((a) => {
          const key = `${a.id}:${game.lastMode.id}`;
          const locked = medalCount(game.profile) < a.medals;
          return {
            label: a.label, arena: a, locked,
            note: locked ? `needs ${a.medals} medals`
              : `${medalDot(game.profile.medals[key])}  best ${(game.profile.best[key] || 0).toLocaleString()}`,
          };
        }),
        (it) => { game.lastArena = it.arena; mgr.push('prerun'); },
        (it) => { blurb.textContent = it.arena.blurb; }
      );
      blurb.textContent = ARENAS[0].blurb;
    },
    onMenu: (m) => { if (m.back) mgr.back('mode'); else arenaList.handle(m); },
  });

  // ── Pre-run (§2.1: one card, countdown on ready) ─────────────────────────
  S('prerun', {
    html: `<div class="veil"></div><div class="pane">
      <div class="eyebrow">Ready</div>
      <h2 class="title" id="pre-title">STUNT · STUNT PARK</h2>
      <div class="blurb" id="pre-rules"></div>
      <div class="cards" id="pre-cards"></div>
      <div class="hint"><b>A</b> go · <b>B</b> back</div>
    </div>`,
    onEnter: () => {
      document.getElementById('pre-title').textContent =
        `${game.lastMode.label} · ${game.lastArena.label}`;
      document.getElementById('pre-rules').textContent = game.lastMode.rules;
      const p = game.profile;
      const key = `${game.lastArena.id}:${game.lastMode.id}`;
      document.getElementById('pre-cards').innerHTML = `
        <div class="card"><h3>${p.car.toUpperCase()}</h3><p>${p.livery} livery</p>
          <div class="stat">thrust ${(p.tune.thrust * 100) | 0} · aero ${(p.tune.aero * 100) | 0}</div></div>
        <div class="card"><h3>${TUNING.RUN.DURATION}s ROUND</h3><p>Final score is the sum of landed banks.</p>
          <div class="stat">your best ${(p.best[key] || 0).toLocaleString()}</div></div>
        <div class="card"><h3>GHOST</h3><p>Your best run, wireframe, non-collidable.</p>
          <div class="stat">${p.best[key] ? 'available' : 'none yet'}</div></div>`;
    },
    onMenu: (m) => {
      if (m.back) mgr.back('arena');
      else if (m.confirm || m.start) game.startRun(game.lastMode, game.lastArena);
    },
  });

  // ── In-run: the HUD is its own layer, so this screen is empty ────────────
  S('run', {
    html: '',
    onEnter: () => { game.hudRoot.classList.remove('hidden'); },
    onExit: () => { game.hudRoot.classList.add('hidden'); },
    onMenu: (m) => { if (m.back) game.abandonRun(); },
  });

  // ── Result (§2.1: breakdown by landing, each row a landing) ──────────────
  let resultList;
  S('result', {
    html: `<div class="veil full"></div><div class="pane">
      <div class="eyebrow">Run complete</div>
      <div class="bigscore" id="res-score">0</div>
      <div class="medal" id="res-medal"></div>
      <table class="brk" id="res-table"></table>
      <div class="list" id="res-actions" style="margin-top:1.2rem"></div>
    </div>`,
    onEnter: (_ctx, data) => {
      const s = data || game.lastSummary || { score: 0, landings: [] };
      document.getElementById('res-score').textContent = s.score.toLocaleString();
      const med = document.getElementById('res-medal');
      med.textContent = s.medal ? `${s.medal} medal` : 'no medal';
      med.className = `medal ${s.medal || ''}`;

      const rows = s.landings.filter((l) => l.airtime > TUNING.AIRTIME.MIN_LOGGED_AIRTIME).slice(-9);
      document.getElementById('res-table').innerHTML =
        `<tr><th>landing</th><th>air</th><th>tricks</th><th class="n">bank</th><th class="n">×</th><th class="n">score</th></tr>` +
        (rows.length ? rows.map((l) => {
          const names = l.tricks.map((t) => t.name).join(', ') || '—';
          const mult = l.landed ? `${(l.landingMult * l.tierMult * l.combo).toFixed(1)}` : '0';
          return `<tr class="${l.landed ? '' : 'crash'}"><td>${l.quality}</td><td>${l.airtime.toFixed(2)}s</td>` +
                 `<td>${names}</td><td class="n">${Math.round(l.bank)}</td><td class="n">${mult}</td>` +
                 `<td class="n">${l.total.toLocaleString()}</td></tr>`;
        }).join('') : '<tr><td colspan="6">no landings</td></tr>');

      resultList = makeList(document.getElementById('res-actions'), [
        { label: 'RETRY', note: `${game.lastMode.label} · ${game.lastArena.label}` },
        { label: 'REPLAY THEATER', note: `${game.replays.length} saved this run` },
        { label: 'MENU', note: '' },
      ], (it) => {
        if (it.label === 'RETRY') game.startRun(game.lastMode, game.lastArena);
        else if (it.label === 'REPLAY THEATER') mgr.push('replays');
        else mgr.go('main');
      });
    },
    onMenu: (m) => { if (m.back) mgr.go('main'); else resultList.handle(m); },
  });

  // ── Options (§2.1) ───────────────────────────────────────────────────────
  let optList;
  const optionItems = () => {
    const o = game.options;
    return [
      { key: 'artStyle', label: 'ART STYLE', values: STYLES },
      { key: 'cameraStyle', label: 'CAMERA', values: ['cinematic', 'classic'] },
      { key: 'traffic', label: 'TRAFFIC', values: ['reactive', 'ambient'] },
      { key: 'showTelemetry', label: 'DEV TELEMETRY', values: [false, true] },
      { key: 'colorblindTrails', label: 'COLOURBLIND TRAILS', values: [false, true] },
      { key: 'haptics', label: 'HAPTICS', values: [true, false] },
    ].map((r) => ({
      ...r,
      label: r.label,
      note: String(o[r.key]).toUpperCase(),
    }));
  };
  S('options', {
    html: `<div class="veil"></div><div class="pane">
      <div class="eyebrow">Options</div><h2 class="title">SETTINGS</h2>
      <div class="list" id="opt-list"></div>
      <div class="hint"><b>←→</b> change · <b>B</b> back</div>
    </div>`,
    onEnter: () => {
      optList = makeList(document.getElementById('opt-list'), optionItems(), () => {});
    },
    onMenu: (m) => {
      if (m.back) return mgr.back('main');
      if (m.left || m.right) {
        const row = optList.item;
        const cur = game.options[row.key];
        const i = row.values.findIndex((v) => v === cur);
        const next = row.values[((i < 0 ? 0 : i) + (m.right ? 1 : -1) + row.values.length) % row.values.length];
        game.applyOption(row.key, next);
        optList.setItems(optionItems());
        return;
      }
      optList.handle(m);
    },
  });

  buildGarage(mgr, game);

  return mgr;
}
