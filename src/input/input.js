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

    this._onKeyDown = (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onBlur = () => this.keys.clear();

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
