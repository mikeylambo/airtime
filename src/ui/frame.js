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
import { MODES as SIM_MODES } from '../sim/modes.js';
import { medalCount, medalRank } from '../storage/profiles.js';
import { buildGarage } from './garage.js';
import { buildTheater } from './theater.js';
import { buildProgress } from './progress.js';
import { buildParty } from './party.js';
import { buildMastery } from './mastery.js';
import { BOARDS as BOARD_LIST } from '../game/boards.js';

import { LENGTH as GAUNTLET_LENGTH } from '../game/gauntlet.js';

const BOARD_COUNT = BOARD_LIST.length;

// The modes, and their rules, live with the rules themselves (src/sim/modes.js)
// so the menu can never describe a mode the simulation does not implement.
export const MODES = Object.values(SIM_MODES).map((m) => ({
  id: m.id, label: m.label, arena: m.arena, rules: m.rules,
  // R11: a mode may own its clock, and may be a party mode rather than a solo
  // one. Both travel with the rules so the menu cannot describe a mode the
  // simulation does not implement.
  seconds: m.seconds, party: !!m.party, scored: m.scored !== false,
}));

// Six instruments, and the blurb is the routing idea rather than the scenery
// — that is the thing a player is actually choosing between.
export const ARENAS = [
  { id: 'park', label: 'THE YARD', blurb: 'Everything points inward. The job is finding ways back out.', medals: 0 },
  { id: 'city', label: 'VERTICAL CITY', blurb: 'The centre is a pit. Altitude is the currency; refusing to come down is the game.', medals: 4 },
  { id: 'works', label: 'MEGA WORKS', blurb: 'The best surfaces move. Route in time, not just in space.', medals: 8 },
  { id: 'flood', label: 'FLOODWAY', blurb: 'The only arena with a direction. Forgives a bad line, punishes a slow one.', medals: 12 },
  { id: 'sky', label: 'SKYLINE', blurb: 'No ground. A missed landing is not a crash, it is a demotion.', medals: 16 },
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
        { label: 'CHALLENGES', note: `${game.challengeCount}/${game.challengeTotal}` },
        { label: 'BOARDS', note: `${BOARD_COUNT} of them` },
        { label: 'GHOSTS', note: game.ghost ? `racing ${game.ghost.name}` : `${game.ghostRecords.length} saved` },
        { label: 'RUN CODES', note: 'send somebody your run' },
        { label: 'DAILY LINE', note: game.dailyLabel() },
        { label: 'LICENCES', note: `${Object.keys(game.profile.licences).length}/${game.licences.length}` },
        // §8: unlocked, not offered. It is not in the menu until it is earned.
        ...(game.gauntletUnlocked
          ? [{ label: 'THE GAUNTLET', note: `best ${game.profile.gauntlet || 0}/${GAUNTLET_LENGTH}` }] : []),
        { label: 'OPTIONS', note: '' },
      ], (it) => {
        if (it.label === 'PLAY') mgr.push('mode');
        else if (it.label === 'GARAGE') mgr.push('garage');
        else if (it.label === 'REPLAYS') mgr.push('replays');
        else if (it.label === 'CHALLENGES') mgr.push('challenges');
        else if (it.label === 'BOARDS') mgr.push('boards');
        else if (it.label === 'GHOSTS') mgr.push('ghosts');
        else if (it.label === 'RUN CODES') mgr.push('codes');
        else if (it.label === 'DAILY LINE') mgr.push('boards', { board: 'daily' });
        else if (it.label === 'LICENCES') mgr.push('licences');
        else if (it.label === 'THE GAUNTLET') mgr.push('gauntlet');
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
        // R11: seven lenses on one game, and the ladder hands them out. Stunt
        // Run is never locked — it is the game; the rest are earned.
        MODES.map((m) => {
          const locked = m.id !== 'stunt' && !game.modeUnlocked(m.id);
          return {
            label: m.label, mode: m, locked,
            note: locked ? `locked · ${game.modeCost(m.id)} challenges` : `default: ${m.arena}`,
          };
        }),
        (it) => {
          if (it.locked) return;
          game.lastMode = it.mode;
          // Party shapes are a seat choice, not an arena choice.
          if (it.mode.party) mgr.push('party');
          else mgr.push('arena');
        },
        (it) => { rules.textContent = it.mode.rules + (it.locked ? '   —   locked' : ''); }
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
      <div class="earned" id="res-earned"></div>
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

      // R9: what this run bought. Stated, never dwelt on — R4's rule is that
      // one input separates a finished run from the next one, and a wall of
      // rewards to acknowledge is exactly the downtime that rule forbids.
      const earned = document.getElementById('res-earned');
      const bits = [];
      for (const c of game.challengesEarned || []) bits.push(`<b>${c.name}</b> ${c.brief}`);
      for (const u of game.unlocksEarned || []) bits.push(`<b>UNLOCKED</b> ${u.label}`);
      if (s.ghost) {
        const d = s.score - s.ghost.score;
        bits.push(`<b>${d >= 0 ? 'BEAT' : 'LOST TO'} ${s.ghost.name}</b> by ${Math.abs(d).toLocaleString()}`);
      }
      for (const pl of game.placings || []) {
        if (pl.rank && pl.rank <= 3) bits.push(`<b>${pl.board.label}</b> #${pl.rank}`);
      }
      earned.innerHTML = bits.length ? bits.map((b) => `<div>${b}</div>`).join('') : '';
      earned.className = bits.length ? 'earned show' : 'earned';

      resultList = makeList(document.getElementById('res-actions'), [
        { label: 'RETRY', note: `${game.lastMode.label} · ${game.lastArena.label}` },
        { label: 'REPLAY THEATER', note: `${game.replays.length} saved this run` },
        { label: 'CHALLENGES', note: `${game.challengeCount}/${game.challengeTotal}` },
        { label: 'MENU', note: '' },
      ], (it) => {
        if (it.label === 'RETRY') game.startRun(game.lastMode, game.lastArena);
        else if (it.label === 'REPLAY THEATER') mgr.push('replays');
        else if (it.label === 'CHALLENGES') mgr.push('challenges');
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
      { key: 'mute', label: 'AUDIO', values: [false, true], names: ['ON', 'MUTED'] },
      { key: 'manualAir', label: 'AIR CONTROL', values: [false, true], names: ['STICK', 'PER-PANEL'] },
      { key: 'invertPitch', label: 'INVERT PITCH', values: [false, true] },
      { key: 'showTelemetry', label: 'DEV TELEMETRY', values: [false, true] },
      { key: 'reduceEffects', label: 'REDUCE EFFECTS', values: [false, true] },
      { key: 'colorblindTrails', label: 'COLOURBLIND PALETTE', values: [false, true] },
      { key: 'haptics', label: 'HAPTICS', values: [true, false] },
    ].map((r) => ({
      ...r,
      label: r.label,
      note: r.names ? r.names[r.values.indexOf(o[r.key])] || String(o[r.key]).toUpperCase() : String(o[r.key]).toUpperCase(),
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
  buildTheater(mgr, game);
  buildProgress(mgr, game);
  buildParty(mgr, game);
  buildMastery(mgr, game);

  return mgr;
}
