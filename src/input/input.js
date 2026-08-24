/**
 * Input — gamepad first, keyboard mirror, touch stubbed (§1 input priority).
 *
 * The map is context sensitive, because §5.1 says panels are "deployable only
 * in air" and that frees the triggers to be throttle/brake on the ground:
 *
 *              GROUND                      AIR
 *   RT         throttle                    trunk   (pitch forward)  [analog]
 *   LT         brake / reverse             hood    (pitch back)     [analog]
 *   LB         —                           left door
 *   RB         —                           right door
 *   A / ✕      boost (hold)                thrust burst (§5)
 *   X / □      handbrake                   —
 *   Y / △      —                           spoiler
 *   L-stick    steer                       thrust mode select (§5)
 *   Start      reset car                   reset car
 *
 * Keyboard: W/S throttle-brake, A/D steer, Shift boost/thrust, Space handbrake,
 * Q/E doors, R hood, F trunk, C spoiler, arrows = thrust-mode stick, Enter reset.
 *
 * The sim only ever reads the flat `actions` object, so remapping (§2.1 Options)
 * and replay playback (§6.1) both plug in at the same seam.
 */

import TUNING from '../TUNING.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const NAMED_KEYS = new Set([
  'Enter', 'Escape', 'Backspace', 'Tab',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

/**
 * KeyboardEvent.code, or the closest thing we can reconstruct from .key.
 *
 * Not every source of key events fills in `code` — synthetic events, some
 * remote-input and accessibility paths, and older engines leave it empty. Keying
 * the whole game off `code` alone means those inputs silently do nothing, which
 * looks exactly like the game being broken.
 */
function keyCodeOf(e) {
  if (e.code) return e.code;
  const k = e.key;
  if (!k) return '';
  if (k === ' ' || k === 'Spacebar') return 'Space';
  if (NAMED_KEYS.has(k)) return k;
  if (k.length === 1) {
    const c = k.toUpperCase();
    if (c >= 'A' && c <= 'Z') return `Key${c}`;
    if (c >= '0' && c <= '9') return `Digit${c}`;
  }
  if (k === 'Shift') return 'ShiftLeft';
  if (k === 'Control') return 'ControlLeft';
  return k;
}

function deadzone(v, dz) {
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return Math.sign(v) * ((a - dz) / (1 - dz));
}

export const NEUTRAL_ACTIONS = Object.freeze({
  throttle: 0,      // 0..1
  brake: 0,         // 0..1
  steer: 0,         // -1..1  (-1 = left)
  boost: false,     // ground: hold to burn the bar
  handbrake: false,
  thrust: false,    // air: edge-triggered burst
  stickX: 0,        // thrust-mode stick, -1..1
  stickY: 0,        // +1 = up/forward
  doorL: 0,         // 0..1 deploy amount
  doorR: 0,
  hood: 0,
  trunk: 0,
  spoiler: 0,
  reset: false,
  cycleCamera: false,
  cycleStyle: false,
});

export class Input {
  constructor(target = window) {
    this.target = target;
    this.actions = { ...NEUTRAL_ACTIONS };
    this.prev = { ...NEUTRAL_ACTIONS };
    this.source = 'keyboard';
    this.enabled = true;         // capture/replay drives this false and writes
                                 // `actions` directly

    this.keys = new Set();
    this._vSteer = 0;            // keyboard virtual analog steering
    this._menuHeld = {};
    this._menuRepeat = {};
    this._latched = new Set();

    this._onKeyDown = (e) => {
      if (e.repeat) return;
      const code = keyCodeOf(e);
      if (!code) return;
      this.keys.add(code);
      // Latch the press so a tap that begins and ends inside one animation
      // frame is still seen. Without this, quick keyboard input is silently
      // dropped — menus feel broken and it is invisible in code review.
      this._latched.add(code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) e.preventDefault();
    };
    this._onKeyUp = (e) => this.keys.delete(keyCodeOf(e));
    this._onBlur = () => { this.keys.clear(); this._latched.clear(); };

    target.addEventListener('keydown', this._onKeyDown);
    target.addEventListener('keyup', this._onKeyUp);
    target.addEventListener('blur', this._onBlur);
    window.addEventListener('gamepadconnected', (e) => {
      this.source = 'gamepad';
      console.info('[AIRTIME] gamepad:', e.gamepad.id);
    });
  }

  dispose() {
    this.target.removeEventListener('keydown', this._onKeyDown);
    this.target.removeEventListener('keyup', this._onKeyUp);
    this.target.removeEventListener('blur', this._onBlur);
  }

  /** Edge detect: true only on the frame the action went from false to true. */
  pressed(name) { return !!this.actions[name] && !this.prev[name]; }

  /**
   * Menu navigation, sampled independently of the driving map.
   *
   * Every field is an edge, so a held stick steps once and then repeats on a
   * timer rather than flying down a list. Menus are the one place where a
   * gamepad's analog stick has to behave like a d-pad.
   * @returns {{up,down,left,right,confirm,back,start,any}}
   */
  sampleMenu(dt) {
    const T = TUNING.INPUT;
    const pad = this._pad();
    const k = (c) => this.keys.has(c) || this._latched.has(c);

    let x = 0, y = 0;
    let confirm = k('Enter') || k('Space') || k('KeyZ');
    let back = k('Escape') || k('Backspace') || k('KeyX');
    let start = k('Enter');

    if (k('ArrowUp') || k('KeyW')) y += 1;
    if (k('ArrowDown') || k('KeyS')) y -= 1;
    if (k('ArrowLeft') || k('KeyA')) x -= 1;
    if (k('ArrowRight') || k('KeyD')) x += 1;

    if (pad) {
      const btn = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
      const ax = deadzone(pad.axes[0] || 0, T.MENU_DEADZONE);
      const ay = -deadzone(pad.axes[1] || 0, T.MENU_DEADZONE);
      x += ax; y += ay;
      if (btn(12)) y += 1;            // d-pad up
      if (btn(13)) y -= 1;            // d-pad down
      if (btn(14)) x -= 1;
      if (btn(15)) x += 1;
      confirm = confirm || btn(0);
      back = back || btn(1);
      start = start || btn(9);
    }

    const dirs = {
      up: y > 0.5, down: y < -0.5, left: x < -0.5, right: x > 0.5,
      confirm, back, start,
    };
    const out = {};
    for (const key of Object.keys(dirs)) {
      const held = dirs[key];
      const was = this._menuHeld[key] || 0;
      if (!held) { this._menuHeld[key] = 0; this._menuRepeat[key] = 0; out[key] = false; continue; }
      if (!was) { out[key] = true; this._menuRepeat[key] = T.MENU_REPEAT_DELAY; }
      else {
        this._menuRepeat[key] -= dt;
        if (this._menuRepeat[key] <= 0 && (key === 'up' || key === 'down' || key === 'left' || key === 'right')) {
          out[key] = true;
          this._menuRepeat[key] = T.MENU_REPEAT_RATE;
        } else out[key] = false;
      }
      this._menuHeld[key] = 1;
    }
    out.any = Object.values(out).some(Boolean);
    this._latched.clear();
    return out;
  }

  sample(dt, airborne) {
    if (!this.enabled) return this.actions;
    this.prev = { ...this.actions };
    const a = this.actions;
    const T = TUNING.INPUT;

    const pad = this._pad();
    if (pad) this._sampleGamepad(a, pad, airborne);
    else this._sampleKeyboard(a, dt, airborne);

    return a;
  }

  _pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected && p.buttons.length >= 8) return p;
    return null;
  }

  _sampleGamepad(a, pad, airborne) {
    this.source = 'gamepad';
    const T = TUNING.INPUT;
    const btn = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    const val = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);

    const lt = Math.max(0, (val(6) - T.TRIGGER_DEADZONE) / (1 - T.TRIGGER_DEADZONE));
    const rt = Math.max(0, (val(7) - T.TRIGGER_DEADZONE) / (1 - T.TRIGGER_DEADZONE));

    a.steer = deadzone(pad.axes[0] || 0, T.GAMEPAD_DEADZONE);
    a.stickX = a.steer;
    a.stickY = -deadzone(pad.axes[1] || 0, T.GAMEPAD_DEADZONE);  // stick up = +1

    a.boost = btn(0);            // A
    a.thrust = btn(0);           // same button; context decides (§5, one bar)
    a.handbrake = btn(2);        // X
    a.reset = btn(9);            // Start
    a.cycleCamera = btn(3) && !airborne;   // Y on the ground = camera style
    a.cycleStyle = btn(8);       // Select/Back = art style (§11 art gate)

    if (airborne) {
      a.throttle = 0; a.brake = 0;
      a.hood = lt;
      a.trunk = rt;
      a.doorL = btn(4) ? 1 : 0;  // LB
      a.doorR = btn(5) ? 1 : 0;  // RB
      a.spoiler = btn(3) ? 1 : 0;// Y
    } else {
      a.throttle = rt;
      a.brake = lt;
      a.hood = 0; a.trunk = 0; a.doorL = 0; a.doorR = 0; a.spoiler = 0;
    }
  }

  _sampleKeyboard(a, dt, airborne) {
    const T = TUNING.INPUT;
    const k = (c) => this.keys.has(c);

    // Virtual analog steering so keyboard is not a bang-bang input.
    const want = (k('KeyA') || k('ArrowLeft') ? -1 : 0) + (k('KeyD') || k('ArrowRight') ? 1 : 0);
    const rate = want === 0 ? T.KEYBOARD_STEER_RETURN : T.KEYBOARD_STEER_RATE;
    this._vSteer += clamp(want - this._vSteer, -rate * dt, rate * dt);
    a.steer = clamp(this._vSteer, -1, 1);

    // In the air the arrow keys become the thrust-mode stick (§5).
    a.stickX = (k('ArrowLeft') ? -1 : 0) + (k('ArrowRight') ? 1 : 0);
    a.stickY = (k('ArrowUp') ? 1 : 0) + (k('ArrowDown') ? -1 : 0);

    a.boost = k('ShiftLeft') || k('ShiftRight');
    a.thrust = a.boost;
    a.handbrake = k('Space');
    a.reset = k('Enter');
    a.cycleCamera = k('KeyV');
    a.cycleStyle = k('KeyB');

    if (airborne) {
      a.throttle = 0; a.brake = 0;
      a.doorL = k('KeyQ') ? 1 : 0;
      a.doorR = k('KeyE') ? 1 : 0;
      a.hood = k('KeyR') ? 1 : 0;
      a.trunk = k('KeyF') ? 1 : 0;
      a.spoiler = k('KeyC') ? 1 : 0;
    } else {
      a.throttle = k('KeyW') ? 1 : 0;
      a.brake = k('KeyS') ? 1 : 0;
      a.doorL = 0; a.doorR = 0; a.hood = 0; a.trunk = 0; a.spoiler = 0;
    }
  }
}

export default Input;
