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
import { DEFAULT_BINDINGS, BINDING_LABELS, keyLabel } from '../input/input.js';
import { exportSaveText, saveFilename, importSave, describeImport } from '../storage/savefile.js';

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
  { id: 'hall', label: 'THE CONCOURSE', blurb: 'It has a ceiling. You cannot solve anything here by going up.', medals: 20 },
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
        <div class="eyebrow">Drive recklessly · stick the landing</div>
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
      <h2 class="title">PROFILE</h2>
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
      // Seven items, down from eleven. The premium main menu names a
      // destination and trusts it — the greyed "car, tuning, parts, livery"
      // subtitles were noise, and five of the old items were really two
      // rooms: PROGRESS (what to chase) and REPLAYS (recorded runs).
      mainList = makeList(document.getElementById('main-list'), [
        { label: 'PLAY', note: last },
        { label: 'GARAGE', note: '' },
        { label: 'PROGRESS', note: `${game.challengeCount}/${game.challengeTotal}` },
        { label: 'REPLAYS', note: game.ghost ? `racing ${game.ghost.name}` : '' },
        { label: 'BOARDS', note: '' },
        // §8: unlocked, not offered. It is not in the menu until it is earned.
        ...(game.gauntletUnlocked
          ? [{ label: 'THE GAUNTLET', note: `best ${game.profile.gauntlet || 0}/${GAUNTLET_LENGTH}` }] : []),
        { label: 'OPTIONS', note: '' },
      ], (it) => {
        if (it.label === 'PLAY') mgr.push('mode');
        else if (it.label === 'GARAGE') mgr.push('garage');
        else if (it.label === 'PROGRESS') mgr.push('progresshub');
        else if (it.label === 'REPLAYS') mgr.push('replayhub');
        else if (it.label === 'BOARDS') mgr.push('boards');
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
      <h2 class="title">MODE</h2>
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
      <h2 class="title">ARENA</h2>
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
        (it) => {
          game.lastArena = it.arena;
          // §A: the notice comes before the first round anybody plays, not
          // buried in options. After that it never appears again.
          mgr.push(game.options.seenPhotoWarning ? 'prerun' : 'photowarn');
        },
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
    // B no longer abandons the run outright — it pauses. The run freezes while
    // the pause menu is up (the clock and the world hold), so a stray B can't
    // dump you to the main menu and the timer can't run out behind your back.
    onMenu: (m) => { if (m.back) mgr.push('pause'); },
  });

  // ── Pause (§: a run holds while this is up) ──────────────────────────────
  let pauseList;
  S('pause', {
    html: `<div class="veil full"></div><div class="pane">
      <h2 class="title">PAUSED</h2>
      <div class="list" id="pause-list"></div>
      <div class="hint"><b>A</b> select · <b>B</b> resume · <b>START</b> restart</div>
    </div>`,
    onEnter: () => {
      pauseList = makeList(document.getElementById('pause-list'), [
        { label: 'RESUME', act: 'resume' },
        { label: 'RESTART', act: 'restart' },
        { label: 'QUIT TO MENU', act: 'quit' },
      ], (it) => {
        if (it.act === 'resume') mgr.back('run');
        else if (it.act === 'restart') game.restartNow();
        else game.abandonRun();
      });
    },
    onMenu: (m) => { if (m.back) return mgr.back('run'); pauseList.handle(m); },
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

  // ── Progress hub (§UI: folds challenges, licences and the daily line) ────
  // These three are the same question — "what should I be chasing?" — so they
  // are one room now instead of three top-level menu items. back() pops the
  // stack, so each destination returns here on its own.
  let progList;
  const progItems = () => {
    const p = game.profile;
    return [
      { label: 'CHALLENGES', note: `${game.challengeCount}/${game.challengeTotal}`, go: 'challenges' },
      { label: 'LICENCES', note: `${Object.keys(p.licences).length}/${game.licences.length}`, go: 'licences' },
      { label: 'DAILY LINE', note: game.dailyLabel(), go: 'daily' },
    ];
  };
  S('progresshub', {
    html: `<div class="veil"></div><div class="pane">
      <div class="eyebrow">Your standing</div><h2 class="title">PROGRESS</h2>
      <div class="list" id="prog-list"></div>
      <div class="hint"><b>A</b> open · <b>B</b> back</div>
    </div>`,
    onEnter: () => {
      progList = makeList(document.getElementById('prog-list'), progItems(),
        (it) => (it.go === 'daily' ? mgr.push('boards', { board: 'daily' }) : mgr.push(it.go)));
    },
    onMenu: (m) => { if (m.back) mgr.back('main'); else progList.handle(m); },
  });

  // ── Replays hub (§UI: folds the theater, ghosts and run codes) ───────────
  let repList;
  const repItems = () => [
    { label: 'WATCH', note: `${game.replays.length} saved`, go: 'replays' },
    { label: 'GHOSTS', note: game.ghost ? `racing ${game.ghost.name}` : `${game.ghostRecords.length} saved`, go: 'ghosts' },
    { label: 'RUN CODES', note: 'paste or share a run', go: 'codes' },
  ];
  S('replayhub', {
    html: `<div class="veil"></div><div class="pane">
      <div class="eyebrow">Recorded runs</div><h2 class="title">REPLAYS</h2>
      <div class="list" id="rep-list"></div>
      <div class="hint"><b>A</b> open · <b>B</b> back</div>
    </div>`,
    onEnter: () => {
      repList = makeList(document.getElementById('rep-list'), repItems(), (it) => mgr.push(it.go));
    },
    onMenu: (m) => { if (m.back) mgr.back('main'); else repList.handle(m); },
  });

  // ── Options (§2.1) ───────────────────────────────────────────────────────
  let optList;
  let warnList;
  const optionItems = () => {
    const o = game.options;
    return [
      { key: 'artStyle', label: 'ART STYLE', values: STYLES },
      { key: 'cameraStyle', label: 'CAMERA', values: ['cinematic', 'classic'] },
      { key: 'traffic', label: 'TRAFFIC', values: ['reactive', 'ambient', 'off'] },
      { key: 'mute', label: 'AUDIO', values: [false, true], names: ['ON', 'MUTED'] },
      { key: 'manualAir', label: 'AIR CONTROL', values: [false, true], names: ['STICK', 'PER-PANEL'] },
      { key: 'invertPitch', label: 'INVERT PITCH', values: [false, true] },
      { key: 'showTelemetry', label: 'DEV TELEMETRY', values: [false, true] },
      { key: 'reduceEffects', label: 'REDUCE EFFECTS', values: [false, true] },
      { key: 'colorblindTrails', label: 'COLOURBLIND PALETTE', values: [false, true] },
      { key: 'haptics', label: 'HAPTICS', values: [true, false] },
      { key: 'controls', label: 'CONTROLS', values: null },
      { key: 'tuner', label: 'VISUAL TUNER', values: null },
      { key: 'save', label: 'SAVE DATA', values: null },
    ].map((r) => ({
      ...r,
      label: r.label,
      note: r.values === null ? (r.key === 'save' ? 'MANAGE \u203a' : r.key === 'tuner' ? 'OPEN \u203a' : 'REBIND \u203a')
        : r.names ? r.names[r.values.indexOf(o[r.key])] || String(o[r.key]).toUpperCase()
          : String(o[r.key]).toUpperCase(),
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
      if (m.confirm && optList.item.key === 'controls') return mgr.push('controls');
      if (m.confirm && optList.item.key === 'save') return mgr.push('savedata');
      if (m.confirm && optList.item.key === 'tuner') { mgr.go('main'); game.tuner?.open(); return; }
      if (m.left || m.right) {
        const row = optList.item;
        if (row.values === null) return;
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

  // ── Controls (§A: remapping is a release requirement, not a nicety) ──────
  // Listening for the *next* keydown rather than offering a list of keys: a
  // picker cannot express a keyboard it has never seen, and the players who
  // need this most are the ones on layouts a picker would get wrong.
  let bindList;
  let capturing = null;          // the verb waiting for a key, or null
  const bindingItems = () => Object.keys(BINDING_LABELS).map((verb) => {
    const codes = game.options.bindings?.[verb] || DEFAULT_BINDINGS[verb];
    return {
      key: verb,
      label: BINDING_LABELS[verb],
      note: capturing === verb ? 'PRESS A KEY' : codes.map(keyLabel).join(' / '),
    };
  });
  const captureKey = (e) => {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { capturing = null; bindList.setItems(bindingItems()); return; }
    const code = e.code || e.key;
    if (!code) return;
    // One key, one verb. Leaving a duplicate in place is how a player ends up
    // with a car that boosts when they brake and no way to tell why.
    const next = { ...(game.options.bindings || {}) };
    for (const verb of Object.keys(BINDING_LABELS)) {
      const cur = next[verb] || DEFAULT_BINDINGS[verb];
      const stripped = cur.filter((c) => c !== code);
      if (stripped.length !== cur.length) next[verb] = stripped;
    }
    next[capturing] = [code];
    // A verb left with nothing bound is a verb the player cannot use and
    // cannot see is missing, so anything emptied falls back to its default.
    for (const verb of Object.keys(next)) {
      if (!next[verb] || !next[verb].length) delete next[verb];
    }
    game.applyOption('bindings', next);
    capturing = null;
    // Drop the key we just consumed, or the same press is still down next
    // frame and the menu reads it as "rebind the next row too".
    game.input.keys.delete(code);
    bindList.setItems(bindingItems());
  };
  S('controls', {
    html: `<div class="veil"></div><div class="pane">
      <div class="eyebrow">Options · Controls</div><h2 class="title">KEYBOARD</h2>
      <div class="list" id="bind-list"></div>
      <div class="hint"><b>A</b> rebind · <b>Y</b> reset all · <b>B</b> back</div>
    </div>`,
    onEnter: () => {
      capturing = null;
      bindList = makeList(document.getElementById('bind-list'), bindingItems(), () => {});
      window.addEventListener('keydown', captureKey, true);
    },
    onExit: () => {
      capturing = null;
      window.removeEventListener('keydown', captureKey, true);
    },
    onMenu: (m) => {
      if (capturing) return;                  // the raw handler owns the keyboard
      if (m.back) return mgr.back('options');
      if (m.alt) { game.applyOption('bindings', {}); bindList.setItems(bindingItems()); return; }
      if (m.confirm) {
        capturing = bindList.item.key;
        bindList.setItems(bindingItems());
        return;
      }
      bindList.handle(m);
    },
  });

  // ── Save data (§S) ──────────────────────────────────────────────────────
  // localStorage is the most fragile place a save has ever lived: a cleared
  // browser, a private window or a new machine takes it without warning, and a
  // hundred and forty-eight challenges is a lot of hours to keep somewhere a
  // "clear browsing data" can erase by accident.
  let saveList;
  let saveNote = '';
  const savePick = (it) => {
    if (it.key === 'export') {
      const blob = new Blob([exportSaveText()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = saveFilename();
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on the next turn of the loop rather than immediately: some
      // browsers have not started reading the blob when click() returns.
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      saveNote = `written to ${saveFilename()}`;
      saveList.setItems(saveItems());
      return;
    }
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'application/json,.json';
    picker.addEventListener('change', async () => {
      const file = picker.files && picker.files[0];
      if (!file) return;
      const r = importSave(await file.text());
      saveNote = describeImport(r);
      saveList.setItems(saveItems());
      // Everything downstream reads storage at construction, so the only
      // honest thing to do after replacing it wholesale is start again.
      if (r.ok) setTimeout(() => window.location.reload(), 1200);
    });
    picker.click();
  };
  const saveItems = () => [
    { key: 'export', label: 'EXPORT SAVE TO A FILE', note: '' },
    { key: 'import', label: 'IMPORT SAVE FROM A FILE', note: '' },
    { key: 'note', label: saveNote ? '' : ' ', note: saveNote, locked: true },
  ];
  S('savedata', {
    html: `<div class="veil"></div><div class="pane">
      <div class="eyebrow">Options · Save data</div><h2 class="title">SAVE</h2>
      <p class="blurb">Everything — profiles, medals, challenges, ghosts, boards and
        settings — as one file. Runs recorded under different physics are left
        out of an import rather than replayed into nonsense.</p>
      <div class="list" id="save-list"></div>
      <div class="hint"><b>A</b> choose · <b>B</b> back</div>
    </div>`,
    onEnter: () => {
      saveNote = '';
      saveList = makeList(document.getElementById('save-list'), saveItems(), savePick);
    },
    onMenu: (m) => {
      if (m.back) return mgr.back('options');
      saveList.handle(m);
    },
  });

  // ── The photosensitivity notice (§A) ────────────────────────────────────
  // Shown once, before the first round, and acknowledged rather than dismissed.
  // It offers the switch on the spot, because a warning that tells you a risk
  // and then makes you go and find the setting is a disclaimer, not a guard.
  S('photowarn', {
    html: `<div class="veil"></div><div class="pane">
      <div class="eyebrow">Before you play</div><h2 class="title">FLASHING LIGHTS</h2>
      <p class="blurb">AIRTIME uses bright flashes on landings and scoring, over a
        dark background. If you are sensitive to flashing light, turn on
        <b>Reduce Effects</b> — it caps every flash, dims the neon and shortens
        the trails, and the game plays exactly the same.</p>
      <div class="list" id="warn-list"></div>
      <div class="hint"><b>A</b> choose</div>
    </div>`,
    onEnter: () => {
      warnList = makeList(document.getElementById('warn-list'), [
        { label: 'TURN ON REDUCE EFFECTS', key: 'on' },
        { label: 'CONTINUE WITHOUT IT', key: 'off' },
      ], (it) => {
        if (it.key === 'on') game.applyOption('reduceEffects', true);
        game.applyOption('seenPhotoWarning', true);
        mgr.go('prerun');
      });
    },
    onMenu: (m) => warnList.handle(m),
  });

  buildGarage(mgr, game);
  buildTheater(mgr, game);
  buildProgress(mgr, game);
  buildParty(mgr, game);
  buildMastery(mgr, game);

  return mgr;
}
