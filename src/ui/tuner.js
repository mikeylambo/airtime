/**
 * The visual tuner — a live panel over the running game (dev/feel tool).
 *
 * Every knob here writes straight into TUNING, the art palette, or the spectral
 * colours, and the scene shows it on the next frame: trail scalars are read
 * per-frame already; the atmosphere re-applies through `art.applyAtmosphere()`,
 * which touches fog, lights and exposure without re-materialising the world, so
 * a slider drags smoothly; the spectral colours push into the trails and the
 * CSS at once so the whole look moves together.
 *
 * It persists to localStorage, so a session of tweaking survives a reload, and
 * COPY dumps the current values as JSON — paste that back and the numbers get
 * baked into the source. Toggle with the backtick key. It is off by default and
 * changes nothing until opened.
 */

import TUNING from '../TUNING.js';
import { THEME } from '../render/theme.js';

const KEY = 'vtune';
const toHex = (n) => '#' + (n & 0xffffff).toString(16).padStart(6, '0');
const fromHex = (s) => parseInt(String(s).replace('#', ''), 16) || 0;

export function buildTuner(game) {
  const T = TUNING.TRAILS;
  const art = game.art;
  const trails = game.trails;

  const applyAtmos = () => art.applyAtmosphere();
  const applySpectral = () => {
    trails.setSpectral(THEME.IRIS, THEME.CYAN);
    const root = document.documentElement.style;
    root.setProperty('--iris', toHex(THEME.IRIS));
    root.setProperty('--cyan', toHex(THEME.CYAN));
  };

  // The knobs. Each get/set is a closure onto the real value, so there is no
  // path DSL to keep in sync — the control *is* the binding.
  // Live driving/feel knobs. car.update reads TUNING.DRIVE (and DRIFT_ASSIST)
  // fresh every fixed step, so these move the car on the next frame — no
  // re-spawn. (Grip/engine force are baked into the setup at spawn, so they are
  // not here; they need a car re-pick to change.)
  const D = TUNING.DRIVE;
  const AS = TUNING.DRIVE.DRIFT_ASSIST;
  const P = TUNING.PRESENCE;
  const LOW = TUNING.LOW;

  const GROUPS = [
    { name: 'HANDLING', rows: [
      { id: 'steerMax', label: 'Steer lock (low spd)', min: 0.3, max: 0.9, step: 0.02, get: () => D.STEER_MAX, set: (v) => { D.STEER_MAX = v; } },
      { id: 'steerMin', label: 'Steer lock (top spd)', min: 0.05, max: 0.5, step: 0.01, get: () => D.STEER_MIN, set: (v) => { D.STEER_MIN = v; } },
      { id: 'steerRate', label: 'Steer turn-in rate', min: 3, max: 14, step: 0.2, get: () => D.STEER_RATE, set: (v) => { D.STEER_RATE = v; } },
      { id: 'steerReturn', label: 'Steer self-centre', min: 3, max: 16, step: 0.2, get: () => D.STEER_RETURN_RATE, set: (v) => { D.STEER_RETURN_RATE = v; } },
      { id: 'hbGrip', label: 'Handbrake rear grip', min: 0.05, max: 0.6, step: 0.01, get: () => D.HANDBRAKE_SIDE_FRICTION, set: (v) => { D.HANDBRAKE_SIDE_FRICTION = v; } },
    ] },
    { name: 'DRIFT ASSIST', rows: [
      { id: 'assistOn', label: 'Assist on (0/1)', min: 0, max: 1, step: 1, get: () => (AS.ENABLED ? 1 : 0), set: (v) => { AS.ENABLED = v >= 0.5; } },
      { id: 'driftGrip', label: 'Drift rear grip', min: 0.05, max: 0.6, step: 0.01, get: () => AS.DRIFT_GRIP, set: (v) => { AS.DRIFT_GRIP = v; } },
      { id: 'driftMaxYaw', label: 'Anti-spin yaw cap', min: 1, max: 5, step: 0.1, get: () => AS.MAX_YAW, set: (v) => { AS.MAX_YAW = v; } },
      { id: 'driftHoldSpd', label: 'Hold speed (m/s)', min: 12, max: 40, step: 1, get: () => AS.HOLD_SPEED, set: (v) => { AS.HOLD_SPEED = v; } },
      { id: 'driftHoldForce', label: 'Hold force (N)', min: 4000, max: 30000, step: 500, get: () => AS.HOLD_FORCE, set: (v) => { AS.HOLD_FORCE = v; } },
    ] },
    { name: 'PRESENCE / THE LOW', rows: [
      { id: 'presBrighten', label: 'Afterimage burn', min: 0, max: 3, step: 0.1, get: () => P.BRIGHTEN, set: (v) => { P.BRIGHTEN = v; } },
      { id: 'presHot', label: 'Hot-white shift', min: 0, max: 1, step: 0.02, get: () => P.HOT, set: (v) => { P.HOT = v; } },
      { id: 'presSlip', label: 'Drift→light (rad)', min: 0.4, max: 1.4, step: 0.02, get: () => P.SLIP_FULL, set: (v) => { P.SLIP_FULL = v; } },
      { id: 'lowStart', label: 'The Low starts (m/s)', min: 20, max: 70, step: 1, get: () => LOW.SPEED_LO, set: (v) => { LOW.SPEED_LO = v; } },
      { id: 'lowFar', label: 'The Low fog pull', min: 0.1, max: 1, step: 0.02, get: () => LOW.FAR_MUL, set: (v) => { LOW.FAR_MUL = v; } },
      { id: 'lowDim', label: 'The Low world dim', min: 0.2, max: 1, step: 0.02, get: () => LOW.LIGHT_MUL, set: (v) => { LOW.LIGHT_MUL = v; } },
    ] },
    { name: 'TRAILS', rows: [
      { id: 'ribbonLife', label: 'Ribbon life', min: 0.3, max: 4, step: 0.1, get: () => T.RIBBON_LIFE, set: (v) => { T.RIBBON_LIFE = v; } },
      { id: 'ribbonWidth', label: 'Ribbon width', min: 0.05, max: 0.6, step: 0.01, get: () => T.RIBBON_WIDTH, set: (v) => { T.RIBBON_WIDTH = v; } },
      { id: 'lensFade', label: 'Lens fade (m)', min: 4, max: 30, step: 1, get: () => T.LENS_FADE, set: (v) => { T.LENS_FADE = v; } },
      { id: 'lineLife', label: 'Flight-line life', min: 2, max: 60, step: 1, get: () => T.LINE_LIFE, set: (v) => { T.LINE_LIFE = v; } },
      { id: 'ghostLife', label: 'Spin-ghost life', min: 0.1, max: 1, step: 0.02, get: () => T.GHOST_LIFE, set: (v) => { T.GHOST_LIFE = v; } },
      { id: 'stretchFull', label: 'Stretch full (m/s)', min: 30, max: 90, step: 1, get: () => T.STRETCH_FULL, set: (v) => { T.STRETCH_FULL = v; } },
    ] },
    { name: 'SPECTRAL', rows: [
      { id: 'iris', label: 'Iris — smear mid', color: true, get: () => THEME.IRIS, set: (v) => { THEME.IRIS = v; applySpectral(); } },
      { id: 'cyan', label: 'Cyan — smear tail', color: true, get: () => THEME.CYAN, set: (v) => { THEME.CYAN = v; applySpectral(); } },
    ] },
    { name: 'ATMOSPHERE', rows: [
      { id: 'exposure', label: 'Exposure', min: 0.6, max: 2, step: 0.02, get: () => art.palette.exposure ?? 1.25, set: (v) => { art.palette.exposure = v; applyAtmos(); } },
      { id: 'fogNear', label: 'Fog near (m)', min: 20, max: 500, step: 5, get: () => art.palette.fogNear, set: (v) => { art.palette.fogNear = v; applyAtmos(); } },
      { id: 'fogFar', label: 'Fog far (m)', min: 300, max: 1600, step: 10, get: () => art.palette.fogFar, set: (v) => { art.palette.fogFar = v; applyAtmos(); } },
      { id: 'hemiInt', label: 'Sky light', min: 0, max: 1.2, step: 0.02, get: () => art.palette.hemiInt, set: (v) => { art.palette.hemiInt = v; applyAtmos(); } },
      { id: 'sunInt', label: 'Key light', min: 0, max: 1, step: 0.02, get: () => art.palette.sunInt, set: (v) => { art.palette.sunInt = v; applyAtmos(); } },
      { id: 'fog', label: 'Fog / haze colour', color: true, get: () => art.palette.fog, set: (v) => { art.palette.fog = v; applyAtmos(); } },
      { id: 'hemiSky', label: 'Sky colour', color: true, get: () => art.palette.hemiSky, set: (v) => { art.palette.hemiSky = v; applyAtmos(); } },
      { id: 'ambient', label: 'Ambient colour', color: true, get: () => art.palette.ambient, set: (v) => { art.palette.ambient = v; applyAtmos(); } },
      { id: 'background', label: 'Void / sky', color: true, get: () => art.palette.background, set: (v) => { art.palette.background = v; applyAtmos(); } },
    ] },
  ];
  const ROWS = {};
  for (const g of GROUPS) for (const r of g.rows) ROWS[r.id] = r;

  const DEFAULTS = {};
  for (const id in ROWS) DEFAULTS[id] = ROWS[id].get();

  // ── DOM ───────────────────────────────────────────────────────────────
  const el = document.createElement('div');
  el.id = 'vtune';
  el.hidden = true;
  el.innerHTML = `<div class="vt-head"><b>VISUAL TUNER</b><span>\` to close</span></div>
    <div class="vt-body"></div>
    <div class="vt-foot"><button data-a="copy">COPY</button><button data-a="reset">RESET</button></div>`;
  const body = el.querySelector('.vt-body');
  const inputs = {};

  for (const g of GROUPS) {
    const h = document.createElement('div');
    h.className = 'vt-group'; h.textContent = g.name;
    body.appendChild(h);
    for (const r of g.rows) {
      const row = document.createElement('label');
      row.className = 'vt-row';
      if (r.color) {
        row.innerHTML = `<span>${r.label}</span>`;
        const c = document.createElement('input');
        c.type = 'color'; c.value = toHex(r.get());
        c.addEventListener('input', () => { r.set(fromHex(c.value)); save(); });
        row.appendChild(c);
        inputs[r.id] = { color: c };
      } else {
        row.innerHTML = `<span>${r.label}</span>`;
        const val = document.createElement('i');
        val.className = 'vt-val';
        const s = document.createElement('input');
        s.type = 'range'; s.min = r.min; s.max = r.max; s.step = r.step; s.value = r.get();
        val.textContent = (+r.get()).toFixed(r.step < 1 ? 2 : 0);
        s.addEventListener('input', () => {
          const v = parseFloat(s.value);
          r.set(v); val.textContent = v.toFixed(r.step < 1 ? 2 : 0); save();
        });
        row.appendChild(s); row.appendChild(val);
        inputs[r.id] = { range: s, val };
      }
      body.appendChild(row);
    }
  }

  const reflect = () => {
    for (const id in ROWS) {
      const r = ROWS[id]; const inp = inputs[id];
      if (inp.color) inp.color.value = toHex(r.get());
      else { inp.range.value = r.get(); inp.val.textContent = (+r.get()).toFixed(r.step < 1 ? 2 : 0); }
    }
  };

  // ── Persistence ─────────────────────────────────────────────────────────
  const save = () => {
    const out = {};
    for (const id in ROWS) out[id] = ROWS[id].get();
    try { localStorage.setItem(`airtime:${KEY}`, JSON.stringify(out)); } catch { /* private mode */ }
  };
  const load = () => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(`airtime:${KEY}`) || 'null'); } catch { saved = null; }
    if (!saved) return;
    for (const id in ROWS) if (id in saved && typeof saved[id] === 'number') ROWS[id].set(saved[id]);
    reflect();
  };

  el.querySelector('[data-a="reset"]').addEventListener('click', () => {
    for (const id in ROWS) ROWS[id].set(DEFAULTS[id]);
    reflect(); save();
  });
  el.querySelector('[data-a="copy"]').addEventListener('click', async (e) => {
    const out = {};
    for (const id in ROWS) out[id] = ROWS[id].color ? toHex(ROWS[id].get()) : +(+ROWS[id].get()).toFixed(3);
    const text = JSON.stringify(out, null, 2);
    try { await navigator.clipboard.writeText(text); } catch { /* fall back below */ }
    const btn = e.target; const was = btn.textContent;
    btn.textContent = 'COPIED'; setTimeout(() => { btn.textContent = was; }, 1200);
  });

  document.body.appendChild(el);

  // ── Toggle ───────────────────────────────────────────────────────────────
  window.addEventListener('keydown', (ev) => {
    if (ev.code === 'Backquote' && !ev.metaKey && !ev.ctrlKey) {
      ev.preventDefault();
      el.hidden = !el.hidden;
      if (!el.hidden) reflect();
    }
  });

  load();               // a saved session of tweaks survives the reload
  return {
    open: () => { el.hidden = false; reflect(); },
    toggle: () => { el.hidden = !el.hidden; if (!el.hidden) reflect(); },
  };
}
