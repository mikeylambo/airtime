/**
 * Replay theater (§6.1, §2.1) — a headline feature, not an afterthought.
 *
 * The clip is inputs and a seed, so the theater is not playing footage back:
 * it re-runs the jump. That is what makes every control here possible. You can
 * put a different camera on a landing that already happened, fly a free camera
 * through it, keyframe your own move, and render the result — all from four
 * kilobytes of button presses.
 */

import TUNING from '../TUNING.js';
import { Screen, makeList } from './screens.js';
import { BEHAVIOR } from '../render/camera-rig.js';
import { deleteClip, clipStale } from '../storage/clips.js';

const CAMERAS = [
  { id: null, label: 'AS IT HAPPENED' },
  { id: BEHAVIOR.CHASE, label: 'CHASE-PULLBACK' },
  { id: BEHAVIOR.ORBIT, label: 'ORBIT' },
  { id: BEHAVIOR.TARGET, label: 'TARGET LOCK' },
  { id: BEHAVIOR.FREE, label: 'FREE CAM' },
  { id: BEHAVIOR.DIRECTOR, label: 'DIRECTOR' },
];

const ago = (ms) => {
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export function buildTheater(mgr, game) {
  let list;

  // ── Replay list ─────────────────────────────────────────────────────────
  mgr.register(new Screen('replays', {
    html: `<div class="veil"></div><div class="pane">
      <div class="eyebrow">Replays</div><h2 class="title">EVERY LANDING WORTH KEEPING</h2>
      <div class="list" id="rep-list"></div>
      <div class="blurb" id="rep-blurb"></div>
      <div class="hint"><b>A</b> open · <b>DEL</b> discard · <b>B</b> back</div>
    </div>`,
    onEnter: () => {
      const blurb = document.getElementById('rep-blurb');
      const items = game.replays.length
        ? game.replays.map((c) => ({
            label: `${(c.info.total || 0).toLocaleString()}`,
            clip: c,
            note: `${clipStale(c) ? 'OLD PHYSICS · ' : ''}${c.info.quality} · ${c.info.airtime}s · ${c.info.arena} · ${ago(c.meta.created)}`,
          }))
        : [{ label: 'NOTHING SAVED YET', locked: true, note: `land over ${TUNING.REPLAY.AUTOSAVE_SCORE} points` }];
      list = makeList(document.getElementById('rep-list'), items, (it) => {
        if (it.clip) mgr.push('theater', it.clip);
      }, (it) => {
        blurb.textContent = it.clip
          ? (it.clip.info.tricks.length ? it.clip.info.tricks.join(' + ') : 'no named tricks — just the landing')
          : 'Every landing over the threshold saves itself. Nothing is lost.';
      });
      blurb.textContent = game.replays.length
        ? 'Re-simulated from inputs, so any of these can be re-shot.'
        : `Land over ${TUNING.REPLAY.AUTOSAVE_SCORE} points and the clip saves itself.`;
    },
    onMenu: (m) => { if (m.back) mgr.back('main'); else list.handle(m); },
  }));

  // ── The theater itself ──────────────────────────────────────────────────
  let camIndex = 0;
  let clip = null;
  mgr.register(new Screen('theater', {
    html: `<div class="pane theater-pane">
      <div class="th-bar">
        <div class="th-head"><b id="th-score">0</b><span id="th-info"></span></div>
        <div class="th-cam"><span class="k">CAMERA</span> <b id="th-cam">AS IT HAPPENED</b></div>
      </div>
      <div class="th-foot">
        <div class="scrub"><div class="scrub-fill" id="th-fill"></div></div>
        <div class="hint" id="th-hint"></div>
        <div class="hint" id="th-status"></div>
      </div>
    </div>`,
    onEnter: (_ctx, data) => {
      clip = data || game.replays[0];
      camIndex = 0;
      if (!clip) return mgr.back('replays');
      document.getElementById('th-score').textContent = (clip.info.total || 0).toLocaleString();
      document.getElementById('th-info').textContent =
        ` ${clip.info.quality.toUpperCase()} · ${clip.info.airtime}s · ${clip.info.tricks.join(' + ') || 'no named tricks'}`;
      document.getElementById('th-hint').innerHTML =
        '<b>SPACE</b> play/pause · <b>←→</b> scrub · <b>C</b> camera · <b>K</b> keyframe · ' +
        '<b>WASD/RF</b> free cam · <b>X</b> export 16:9 · <b>Z</b> export 9:16 · <b>B</b> back';
      game.playClip(clip, { behavior: null });
    },
    onExit: () => { game.stopPlayback(); game.stopExport(); },
    onTick: (dt) => {
      const pb = game.playback;
      if (!pb) return;
      const u = Math.max(0, Math.min(1, (pb.player.step - clip.start) / Math.max(1, clip.end - clip.start)));
      document.getElementById('th-fill').style.width = `${u * 100}%`;
      game.director.directorT = u;
      const st = document.getElementById('th-status');
      const msg = game.exportStatus();
      if (st.textContent !== msg) st.textContent = msg;
    },
    onMenu: (m) => {
      if (m.back) return mgr.back('replays');
      const pb = game.playback;
      if (!pb) return;
      if (m.left) game.seekPlayback(pb.player.step - Math.round(0.5 * TUNING.SIM.HZ));
      if (m.right) game.seekPlayback(pb.player.step + Math.round(0.5 * TUNING.SIM.HZ));
      if (m.confirm) pb.paused = !pb.paused;
    },
  }));

  /** Theater keys that are not menu navigation. */
  game.theaterKeys = (input) => {
    const pb = game.playback;
    if (!pb) return;
    if (input.pressed2('KeyC')) {
      camIndex = (camIndex + 1) % CAMERAS.length;
      pb.behavior = CAMERAS[camIndex].id;
      document.getElementById('th-cam').textContent = CAMERAS[camIndex].label;
      if (pb.behavior === BEHAVIOR.FREE && !game.director.freeCam) game.seedFreeCam();
    }
    if (input.pressed2('KeyK')) game.addKeyframe();
    if (input.pressed2('KeyX')) game.startExport(16 / 9);
    if (input.pressed2('KeyZ')) game.startExport(9 / 16);
    if (input.pressed2('Delete') || input.pressed2('Backspace')) {
      game.replays = deleteClip(game.profileIndex, clip.id);
      mgr.back('replays');
    }
  };

  return mgr;
}
