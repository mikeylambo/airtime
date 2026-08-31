/**
 * Party, the highlight reel and the scoreboards (§9).
 *
 * "Party (the drunk-game rule, formalized)" — split-screen for 2-4 pads, or one
 * pad passed around in 45 second turns. Both end where every round ends: the
 * reel.
 */

import TUNING from '../TUNING.js';
import { Screen, makeList } from './screens.js';
import { playerColorCss } from '../render/theme.js';

const NAMES = ['P1', 'P2', 'P3', 'P4'];

export function buildParty(mgr, game) {
  let list;

  // ── Party: split-screen or pass-the-pad ─────────────────────────────────
  mgr.register(new Screen('party', {
    html: `<div class="veil"></div><div class="pane">
      <h2 class="title">PARTY</h2>
      <div class="list" id="party-list"></div>
      <div class="blurb" id="party-note"></div>
      <div class="hint"><b>A</b> start · <b>B</b> back</div>
    </div>`,
    onEnter: () => {
      const pads = game.input.padCount;
      const note = document.getElementById('party-note');
      const items = [
        { label: 'SPLIT-SCREEN · 2', n: 2, kind: 'split' },
        { label: 'SPLIT-SCREEN · 3', n: 3, kind: 'split' },
        { label: 'SPLIT-SCREEN · 4', n: 4, kind: 'split' },
        { label: 'PASS THE PAD · 2', n: 2, kind: 'pad' },
        { label: 'PASS THE PAD · 3', n: 3, kind: 'pad' },
        { label: 'PASS THE PAD · 4', n: 4, kind: 'pad' },
      ].map((it) => ({
        ...it,
        locked: it.kind === 'split' && pads < it.n && !(it.n === 2 && pads >= 1),
        note: it.kind === 'split'
          ? `${it.n} pads · restrained camera`
          : `${TUNING.MODES.PARTY.TURN_SECONDS}s turns · full camera`,
      }));
      list = makeList(document.getElementById('party-list'), items, (it) => {
        if (it.kind === 'split') game.startRun(game.lastMode, game.lastArena, { players: it.n });
        else game.startPassThePad(it.n);
      }, (it) => {
        note.textContent = it.kind === 'split'
          ? 'Everyone at once, same arena, same clock. Per-viewport cameras stay on chase-pullback — an orbit does not survive a quartered screen.'
          : 'One controller, one driver at a time, scoreboard between turns. The full cinematic camera, because the screen is whole.';
      });
      note.textContent = `${pads} pad${pads === 1 ? '' : 's'} connected. ` +
        'Player one can use the keyboard; players two to four need pads.';
    },
    onMenu: (m) => { if (m.back) mgr.back('mode'); else list.handle(m); },
  }));

  // ── The highlight reel (§9) ─────────────────────────────────────────────
  mgr.register(new Screen('reel', {
    html: `<div class="pane theater-pane">
      <div class="reel-bar">
        <div class="reel-tag" id="reel-tag">HIGHLIGHT 1 / 3</div>
        <div class="reel-score" id="reel-score">0</div>
        <div class="reel-info" id="reel-info"></div>
      </div>
      <div class="reel-foot"><div class="hint"><b>A</b> next · <b>B</b> skip the reel</div></div>
    </div>`,
    onEnter: (_c, data) => {
      if (!data) return;
      const { clip, index, count } = data;
      // The chyron wears the colour of whoever earned the landing (AFTERGLOW).
      document.querySelector('#screen-reel .reel-bar, .reel-bar')
        ?.style.setProperty('--pc', playerColorCss(clip.info.player || 0));
      document.getElementById('reel-tag').textContent = `HIGHLIGHT ${index + 1} / ${count}`;
      document.getElementById('reel-score').textContent = (clip.info.total || 0).toLocaleString();
      const who = clip.info.player != null && game.playerCount > 1 ? `${NAMES[clip.info.player]} · ` : '';
      document.getElementById('reel-info').textContent =
        `${who}${clip.info.quality.toUpperCase()} · ${clip.info.airtime}s · ` +
        (clip.info.tricks.length ? clip.info.tricks.join(' + ') : 'no named tricks');
    },
    onTick: () => {
      // The clip loops itself in the main loop; advance when it has played once.
      const pb = game.playback;
      if (pb && pb.player.done) game.reelNext();
    },
    onMenu: (m) => {
      if (m.back) game.skipReel();
      else if (m.confirm) game.reelNext();
    },
  }));

  // ── Between turns (§9 pass-the-pad) ─────────────────────────────────────
  mgr.register(new Screen('handover', {
    html: `<div class="veil full"></div><div class="pane center">
      <div class="eyebrow">Pass the pad</div>
      <h1 class="logo" id="ho-who" style="font-size:clamp(2.4rem,9vw,5rem)">P2</h1>
      <div class="blurb" id="ho-note"></div>
      <table class="brk" id="ho-table" style="max-width:420px;margin:0 auto"></table>
      <div class="hint blink" style="margin-top:1.4rem"><b>PRESS A WHEN YOU HAVE IT</b></div>
    </div>`,
    onEnter: (_c, data) => {
      document.getElementById('ho-who').textContent = NAMES[data.turn] || `P${data.turn + 1}`;
      document.getElementById('ho-note').textContent =
        `${TUNING.MODES.PARTY.TURN_SECONDS} seconds. Same arena, same car, no excuses.`;
      document.getElementById('ho-table').innerHTML =
        '<tr><th>driver</th><th class="n">score</th></tr>' +
        data.scores.map((s, i) =>
          `<tr><td>${NAMES[i]}</td><td class="n">${s.score.toLocaleString()}</td></tr>`).join('');
    },
    onMenu: (m) => { if (m.confirm || m.start) game.playTurn(); },
  }));

  // ── Scoreboard (§9, both party modes) ───────────────────────────────────
  let sbList;
  mgr.register(new Screen('scoreboard', {
    html: `<div class="veil full"></div><div class="pane">
      <div class="eyebrow" id="sb-eyebrow">Scoreboard</div>
      <h2 class="title" id="sb-winner">P1 WINS</h2>
      <table class="brk" id="sb-table"></table>
      <div class="list" id="sb-actions" style="margin-top:1.2rem"></div>
    </div>`,
    onEnter: (_c, data) => {
      const all = (data.all || []).slice();
      const ranked = all.map((s, i) => ({ ...s, seat: s.player ?? i }))
        .sort((a, b) => b.score - a.score);
      document.getElementById('sb-eyebrow').textContent =
        data.kind === 'pad' ? 'Pass the pad' : 'Split-screen';
      const win = ranked[0];
      document.getElementById('sb-winner').textContent =
        ranked.length > 1 && win.score > (ranked[1]?.score ?? 0)
          ? `${NAMES[win.seat]} WINS`
          : ranked.length > 1 ? 'DEAD HEAT' : 'ROUND OVER';
      document.getElementById('sb-table').innerHTML =
        '<tr><th>#</th><th>driver</th><th class="n">score</th><th class="n">landed</th>' +
        '<th class="n">chain</th><th>best</th></tr>' +
        ranked.map((s, i) => {
          const best = s.best ? `${s.best.quality} ${s.best.total.toLocaleString()}` : '—';
          return `<tr><td>${i + 1}</td><td>${NAMES[s.seat]}${s.alive === false ? ' · out' : ''}</td>` +
            `<td class="n">${s.score.toLocaleString()}</td><td class="n">${s.landed}/${s.jumps}</td>` +
            `<td class="n">${s.bestChain}</td><td>${best}</td></tr>`;
        }).join('');
      sbList = makeList(document.getElementById('sb-actions'), [
        { label: 'AGAIN', note: `${game.lastMode.label} · ${game.lastArena.label}` },
        { label: 'MENU', note: '' },
      ], (it) => {
        if (it.label === 'AGAIN') {
          if (data.kind === 'pad') game.startPassThePad(all.length);
          else game.startRun(game.lastMode, game.lastArena, { players: all.length });
        } else { game.setPlayerCount(1); mgr.go('main'); }
      });
    },
    onMenu: (m) => {
      if (m.back) { game.setPlayerCount(1); mgr.go('main'); }
      else sbList.handle(m);
    },
  }));

  return mgr;
}
