/**
 * The mastery screens (R9): challenges, the seven boards, ghosts, The Gauntlet.
 *
 * Everything here is a *view* over data that lives elsewhere — the challenge
 * ladder is generated in game/challenges.js, the boards resolve through the
 * two-function adapter, ghosts are baked trajectories. This file only decides
 * what a player sees, which is the one part of R9 that is taste rather than
 * measurement.
 *
 * One rule carried over from R4: nothing here may cost more than one input to
 * get out of, and nothing here may sit between a finished run and the next
 * one. The result screen mentions what you earned; it never makes you read it.
 */

import { Screen, makeList } from './screens.js';
import {
  CHALLENGE_SETS, bySet, setProgress, completedCount, nextUnlock, CHALLENGES,
} from '../game/challenges.js';
import { BOARDS } from '../game/boards.js';
import * as Gauntlet from '../game/gauntlet.js';
import * as Horse from '../game/horse.js';

const num = (n) => (n || 0).toLocaleString();
const bar = (done, total) => {
  const k = total ? Math.round((done / total) * 12) : 0;
  return `<span class="meter">${'█'.repeat(k)}${'░'.repeat(12 - k)}</span>`;
};

export function buildMastery(mgr, game) {
  let list;

  // ── Challenges: the sets, then the set ──────────────────────────────────
  mgr.register(new Screen('challenges', {
    html: `<div class="veil"></div><div class="pane">
      <div class="eyebrow" id="ch-eyebrow">Challenges</div>
      <h2 class="title">SOMETHING TO BE GOOD AT</h2>
      <div class="list" id="ch-list"></div>
      <div class="card" id="ch-card" style="max-width:460px"></div>
      <div class="hint"><b>A</b> open · <b>B</b> back</div>
    </div>`,
    onEnter: () => {
      const p = game.profile;
      const next = nextUnlock(p);
      document.getElementById('ch-eyebrow').textContent =
        `Challenges · ${completedCount(p)}/${CHALLENGES.length}` +
        (next ? ` · ${next.remaining} to ${next.label}` : ' · everything unlocked');
      const card = document.getElementById('ch-card');
      const items = setProgress(p).map((s) => ({
        label: s.set, set: s.set,
        note: `${bar(s.done, s.total)} ${s.done}/${s.total}`,
      }));
      list = makeList(document.getElementById('ch-list'), items,
        (it) => mgr.push('challengeset', { set: it.set }),
        (it) => {
          const done = p.challenges || {};
          const rows = bySet(it.set);
          const nextUp = rows.find((c) => !done[c.id]);
          card.innerHTML = `<h3>${it.set}</h3>` +
            (nextUp
              ? `<p>${nextUp.name} — ${nextUp.brief}</p><div class="stat">${nextUp.teaches}</div>`
              : '<p>Every one of these is done.</p>');
        });
    },
    onMenu: (m) => { if (m.back) mgr.back('main'); else list.handle(m); },
  }));

  let setList;
  mgr.register(new Screen('challengeset', {
    html: `<div class="veil"></div><div class="pane">
      <div class="eyebrow" id="cs-eyebrow">Set</div>
      <h2 class="title" id="cs-title">—</h2>
      <div class="list" id="cs-list"></div>
      <div class="card" id="cs-card" style="max-width:460px"></div>
      <div class="hint"><b>B</b> back</div>
    </div>`,
    onEnter: (_c, data) => {
      const p = game.profile;
      const done = p.challenges || {};
      const rows = bySet(data.set);
      document.getElementById('cs-title').textContent = data.set;
      document.getElementById('cs-eyebrow').textContent =
        `${rows.filter((c) => done[c.id]).length} of ${rows.length} done`;
      const card = document.getElementById('cs-card');
      const items = rows.map((c) => ({
        label: c.name, ch: c,
        note: done[c.id] ? '✓' : (c.arena ? c.arena : c.car ? c.car : ''),
      }));
      setList = makeList(document.getElementById('cs-list'), items, () => {}, (it) => {
        const c = it.ch;
        const where = [c.arena && `in ${c.arena}`, c.car && `in the ${c.car}`,
          c.mode && `in ${c.mode}`].filter(Boolean).join(', ');
        card.innerHTML = `<h3>${c.name}</h3><p>${c.brief}</p>` +
          `<div class="stat">${c.teaches}</div>` +
          (where ? `<div class="stat">${where}</div>` : '') +
          (done[c.id] ? '<div class="stat">done</div>' : '');
      });
    },
    onMenu: (m) => { if (m.back) mgr.back('challenges'); else setList.handle(m); },
  }));

  // ── The seven boards ────────────────────────────────────────────────────
  // One screen, seven tabs. Seven screens would be six screens too many, and
  // the whole argument for seven boards is that they are views of one run.
  let boardList;
  let boardIndex = 0;

  const renderBoard = async () => {
    const b = BOARDS[boardIndex];
    const el = document.getElementById('bd-table');
    document.getElementById('bd-title').textContent = b.label;
    // R11: the daily board also carries the daily *set* — three challenges
    // chosen by the date, the same three for everybody, drawn from the ladder
    // that already exists rather than being a second kind of objective.
    if (b.id === 'daily') {
      const set = game.dailySet();
      const done = game.profile.challenges || {};
      document.getElementById('bd-note').innerHTML = `${b.blurb}<br><b>Today's three:</b> ` +
        set.challenges.map((c) => `${done[c.id] ? '✓ ' : ''}${c.name}`).join(' · ');
    } else {
      document.getElementById('bd-note').textContent = b.blurb;
    }
    document.getElementById('bd-eyebrow').textContent =
      `Board ${boardIndex + 1}/${BOARDS.length} · ${game.lastArena.label} · ${game.lastMode.label}`;
    el.innerHTML = '<tr><td>reading…</td></tr>';
    let rows = [];
    try { rows = await game.readBoard(b.id, 10); } catch { rows = []; }
    // A different tab may have been selected while that was in flight.
    if (BOARDS[boardIndex] !== b) return;
    el.innerHTML =
      '<tr><th>#</th><th>driver</th><th>car</th><th class="n">' +
      (b.id === 'stunt' ? 'best stunt' : 'score') + '</th></tr>' +
      (rows.length
        ? rows.map((r, i) => `<tr${r.slot === game.profile.slot ? ' class="me"' : ''}>` +
            `<td>${i + 1}</td><td>${r.name}</td><td>${r.car}</td>` +
            `<td class="n">${num(r.value ?? r.score)}</td></tr>`).join('')
        : `<tr><td colspan="4">nothing on this board yet${
            b.qualifies ? ' — it may be that no run has qualified' : ''}</td></tr>`);
  };

  mgr.register(new Screen('boards', {
    html: `<div class="veil"></div><div class="pane">
      <div class="eyebrow" id="bd-eyebrow">Boards</div>
      <h2 class="title" id="bd-title">ARENA</h2>
      <table class="brk" id="bd-table"></table>
      <div class="blurb" id="bd-note"></div>
      <div class="hint"><b>◀ ▶</b> board · <b>B</b> back</div>
    </div>`,
    onEnter: (_c, data) => {
      if (data && data.board) boardIndex = Math.max(0, BOARDS.findIndex((b) => b.id === data.board));
      renderBoard();
    },
    onMenu: (m) => {
      if (m.back) return mgr.back('main');
      // Left/right walks the seven. Up/down would fight the table.
      if (m.left) { boardIndex = (boardIndex + BOARDS.length - 1) % BOARDS.length; renderBoard(); }
      if (m.right) { boardIndex = (boardIndex + 1) % BOARDS.length; renderBoard(); }
    },
  }));

  // ── Ghosts ──────────────────────────────────────────────────────────────
  // Choosing one bakes it, which is a few thousand solver steps, which is why
  // it happens here and not at the start of a run (R4's budget is permanent).
  let ghostList;
  mgr.register(new Screen('ghosts', {
    html: `<div class="veil"></div><div class="pane">
      <div class="eyebrow" id="gh-eyebrow">Ghosts</div>
      <h2 class="title">RACE YOURSELF</h2>
      <div class="list" id="gh-list"></div>
      <div class="card" id="gh-card" style="max-width:460px"></div>
      <div class="hint"><b>A</b> load · <b>B</b> back</div>
    </div>`,
    onEnter: () => {
      const records = game.ghostRecords;
      const card = document.getElementById('gh-card');
      document.getElementById('gh-eyebrow').textContent =
        `Ghosts · ${records.length} saved` + (game.ghost ? ` · racing ${game.ghost.name}` : '');
      const items = [
        ...(game.ghost ? [{ label: 'NO GHOST', note: 'drive alone', clear: true }] : []),
        ...records.map((r) => ({
          label: `${r.arena.toUpperCase()} · ${num(r.score)}`,
          note: `${r.car} · ${new Date(r.created).toLocaleDateString()}`,
          record: r,
        })),
      ];
      if (!items.length) {
        card.innerHTML = '<h3>Nothing to race yet</h3><p>Finish a run and it becomes '
          + 'your ghost here. A ghost is the run itself, re-simulated — not a recording of it.</p>';
      }
      ghostList = makeList(document.getElementById('gh-list'), items, async (it) => {
        if (it.clear) { game.clearGhost(); return mgr.go('ghosts'); }
        card.innerHTML = '<h3>Baking…</h3><p>Re-simulating the run. This happens once, here, '
          + 'so that starting a race still costs one input.</p>';
        await game.loadGhost(it.record, (k) => {
          card.innerHTML = `<h3>Baking… ${Math.round(k * 100)}%</h3>`
            + '<p>Re-simulating the run, so the ghost is the run rather than a recording of it.</p>';
        });
        mgr.go('ghosts');
      }, (it) => {
        if (it.clear) {
          card.innerHTML = '<h3>Drive alone</h3><p>No ghost on the track.</p>';
          return;
        }
        const r = it.record;
        card.innerHTML = `<h3>${r.name} · ${num(r.score)}</h3>`
          + `<p>${r.arena} · ${r.mode} · ${r.car}</p>`
          + '<div class="stat">Loading re-simulates the run once. After that it costs a '
          + 'transform a frame and no physics at all.</div>';
      });
    },
    onMenu: (m) => { if (m.back) mgr.back('main'); else ghostList.handle(m); },
  }));

  // ── The Gauntlet ────────────────────────────────────────────────────────
  let gList;
  mgr.register(new Screen('gauntlet', {
    html: `<div class="veil"></div><div class="pane">
      <div class="eyebrow" id="ga-eyebrow">The Gauntlet</div>
      <h2 class="title">UNLOCKED, NOT OFFERED</h2>
      <div class="list" id="ga-list"></div>
      <div class="card" id="ga-card" style="max-width:480px"></div>
      <div class="hint"><b>A</b> begin · <b>B</b> back</div>
    </div>`,
    onEnter: () => {
      const p = game.profile;
      document.getElementById('ga-eyebrow').textContent =
        `The Gauntlet · best ${p.gauntlet || 0}/${Gauntlet.LENGTH}`;
      const card = document.getElementById('ga-card');
      const items = [
        { label: 'BEGIN', note: `${Gauntlet.LENGTH} stages · best ${p.gauntlet || 0}`, begin: true },
        ...Gauntlet.STAGES.map((st, i) => ({
          label: `${String(i + 1).padStart(2, '0')} ${st.name}`,
          note: i < (p.gauntlet || 0) ? '✓' : st.arena,
          stage: st,
        })),
      ];
      gList = makeList(document.getElementById('ga-list'), items, (it) => {
        if (it.begin) game.startGauntlet();
      }, (it) => {
        if (it.begin) {
          card.innerHTML = `<h3>${Gauntlet.LENGTH} stages</h3><p>One objective each, one short run each. `
            + 'A cleared stage rolls straight into the next; a failed one ends the attempt '
            + 'and costs nothing.</p><div class="stat">All five arenas. The last stage is '
            + 'the acceptance clip.</div>';
        } else {
          card.innerHTML = `<h3>${it.stage.name}</h3><p>${it.stage.brief}</p>`
            + `<div class="stat">${it.stage.arena} · ${it.stage.seconds}s</div>`;
        }
      });
    },
    onMenu: (m) => { if (m.back) mgr.back('main'); else gList.handle(m); },
  }));

  // Cleared a stage: one beat, one input, straight back out.
  mgr.register(new Screen('gauntletnext', {
    html: `<div class="veil full"></div><div class="pane">
      <div class="eyebrow" id="gn-eyebrow">Cleared</div>
      <h2 class="title" id="gn-title">—</h2>
      <div class="blurb" id="gn-next"></div>
      <div class="list" id="gn-actions"></div>
    </div>`,
    onEnter: (_c, data) => {
      const st = Gauntlet.stageAt(data.state.index);
      document.getElementById('gn-eyebrow').textContent =
        `Stage ${data.state.index} of ${Gauntlet.LENGTH} cleared`;
      document.getElementById('gn-title').textContent = data.cleared.name;
      document.getElementById('gn-next').textContent = st
        ? `Next: ${st.name} — ${st.brief}` : '';
      const l = makeList(document.getElementById('gn-actions'), [
        { label: 'CONTINUE', note: st ? `${st.arena} · ${st.seconds}s` : '' },
        { label: 'STOP', note: 'keep the depth, end the attempt' },
      ], (it) => {
        if (it.label === 'CONTINUE') game.playGauntletStage();
        else { game.abandonGauntlet(); mgr.go('gauntlet'); }
      });
      mgr.get('gauntletnext')._list = l;
    },
    onMenu: (m) => {
      const l = mgr.get('gauntletnext')._list;
      // START continues, because the one thing a mastery exam must never do
      // is make you navigate between attempts.
      if (m.start) return game.playGauntletStage();
      if (m.back) { game.abandonGauntlet(); return mgr.go('gauntlet'); }
      l.handle(m);
    },
  }));

  mgr.register(new Screen('gauntletresult', {
    html: `<div class="veil full"></div><div class="pane">
      <div class="eyebrow" id="gr-eyebrow">The Gauntlet</div>
      <div class="bigscore" id="gr-depth">0</div>
      <h2 class="title" id="gr-title">—</h2>
      <div class="blurb" id="gr-blurb"></div>
      <div class="list" id="gr-actions"></div>
    </div>`,
    onEnter: (_c, data) => {
      const d = Gauntlet.depth(data.state);
      const beat = data.state.failed
        ? Gauntlet.STAGES.find((s) => s.id === data.state.failed) : null;
      document.getElementById('gr-depth').textContent = `${d}/${Gauntlet.LENGTH}`;
      document.getElementById('gr-title').textContent =
        data.state.failed ? 'ATTEMPT OVER' : 'THE WHOLE THING';
      document.getElementById('gr-eyebrow').textContent =
        `Best ever ${game.profile.gauntlet || 0}/${Gauntlet.LENGTH}`;
      document.getElementById('gr-blurb').textContent = beat
        ? `${beat.name} — ${beat.brief}`
        : 'Every stage, including the shot the vision ends on.';
      const l = makeList(document.getElementById('gr-actions'), [
        { label: 'AGAIN', note: 'from stage one' },
        { label: 'BACK', note: '' },
      ], (it) => {
        if (it.label === 'AGAIN') game.startGauntlet();
        else mgr.go('gauntlet');
      });
      mgr.get('gauntletresult')._list = l;
    },
    onMenu: (m) => {
      const l = mgr.get('gauntletresult')._list;
      if (m.start) return game.startGauntlet();
      if (m.back) return mgr.go('gauntlet');
      l.handle(m);
    },
  }));

  // ── R11: run codes ──────────────────────────────────────────────────────
  // The replay architecture's quiet gift. A clip is inputs and a seed, so a
  // run is a few kilobytes of text — no upload, no account, no server — and
  // what the other person gets is not a video of your run, it is your run.
  let codeList;
  mgr.register(new Screen('codes', {
    html: `<div class="veil"></div><div class="pane">
      <div class="eyebrow" id="cd-eyebrow">Run codes</div>
      <h2 class="title">SEND SOMEBODY YOUR RUN</h2>
      <div class="list" id="cd-list"></div>
      <div class="card" id="cd-card" style="max-width:520px"></div>
      <div class="hint"><b>A</b> do it · <b>B</b> back</div>
    </div>`,
    onEnter: () => {
      const card = document.getElementById('cd-card');
      const here = game.ghostHere();
      document.getElementById('cd-eyebrow').textContent =
        here ? `Run codes · best here ${num(here.score)}` : 'Run codes · nothing saved here yet';
      codeList = makeList(document.getElementById('cd-list'), [
        { label: 'COPY MY RUN', note: here ? `${here.arena} · ${num(here.score)}` : 'nothing here yet', copy: true },
        { label: 'PASTE A RUN', note: 'it arrives as a ghost', paste: true },
      ], async (it) => {
        if (it.copy) {
          const code = await game.runCode();
          if (!code) {
            card.innerHTML = '<h3>Nothing to send</h3><p>Finish a run here first.</p>';
            return;
          }
          try { await navigator.clipboard.writeText(code); } catch { /* shown below anyway */ }
          card.innerHTML = `<h3>Copied — ${code.length} characters</h3>`
            + `<p style="word-break:break-all;font-size:.62rem;opacity:.7">${code.slice(0, 320)}${code.length > 320 ? '…' : ''}</p>`
            + '<div class="stat">Not a video. The whole run, re-simulated on their machine.</div>';
        } else {
          let text = '';
          try { text = await navigator.clipboard.readText(); } catch { text = ''; }
          if (!text) {
            card.innerHTML = '<h3>Nothing on the clipboard</h3>'
              + '<p>Copy a run code first, then come back.</p>';
            return;
          }
          card.innerHTML = '<h3>Baking…</h3><p>Re-simulating their run so you can race it.</p>';
          const out = await game.takeCode(text, (k) => {
            card.innerHTML = `<h3>Baking… ${Math.round(k * 100)}%</h3><p>Re-simulating their run.</p>`;
          });
          card.innerHTML = out.ok
            ? `<h3>${out.record.name} · ${num(out.record.score)}</h3>`
              + `<p>${out.record.arena} · ${out.record.car}. Loaded as your ghost.</p>`
            : `<h3>No</h3><p>${out.why}</p>`;
        }
      }, (it) => {
        card.innerHTML = it.copy
          ? '<h3>Copy my run</h3><p>Your best run here becomes a string. Send it to anybody.</p>'
            + '<div class="stat">A clip is inputs and a seed, so this is a few kilobytes rather than a file.</div>'
          : '<h3>Paste a run</h3><p>Somebody else\'s run, from your clipboard.</p>'
            + '<div class="stat">It arrives as a ghost, because the thing you do with somebody\'s run is beat it.</div>';
      });
    },
    onMenu: (m) => { if (m.back) mgr.back('main'); else codeList.handle(m); },
  }));

  // ── R11: HORSE ──────────────────────────────────────────────────────────
  mgr.register(new Screen('horseresult', {
    html: `<div class="veil full"></div><div class="pane">
      <div class="eyebrow">HORSE</div>
      <h2 class="title" id="hr-title">—</h2>
      <table class="brk" id="hr-table"></table>
      <div class="list" id="hr-actions"></div>
    </div>`,
    onEnter: (_c, data) => {
      const st = data.state;
      document.getElementById('hr-title').textContent =
        st.winner === null ? 'NOBODY' : `PLAYER ${st.winner + 1} WINS`;
      document.getElementById('hr-table').innerHTML =
        '<tr><th>player</th><th>letters</th><th></th></tr>' +
        Horse.standings(st).map((p) =>
          `<tr class="${p.out ? 'crash' : ''}"><td>PLAYER ${p.index + 1}</td>` +
          `<td>${p.word}</td><td>${p.out ? 'out' : ''}</td></tr>`).join('');
      const l = makeList(document.getElementById('hr-actions'), [
        { label: 'AGAIN', note: '' }, { label: 'MENU', note: '' },
      ], (it) => {
        if (it.label === 'AGAIN') mgr.go('party');
        else mgr.go('main');
      });
      mgr.get('horseresult')._list = l;
    },
    onMenu: (m) => {
      const l = mgr.get('horseresult')._list;
      if (m.back) return mgr.go('main');
      l.handle(m);
    },
  }));

  return mgr;
}
