/**
 * Input — gamepad first, keyboard mirror, touch stubbed (§1 input priority).
 *
 * ## Air control (R2)
 *
 * The bodywork is five hinged surfaces, but the *player* does not get five
 * verbs. Build 1 gave them eight — two doors, hood, tail flap, wing and three
 * thrust modes — and nobody holds eight verbs in their head at 60 m/s while
 * inverted. The reference had roughly two: wings, and tilt.
 *
 * So the stick flies the car and the panels are the actuators:
 *
 *   stick left/right  -> one door out   -> roll that way
 *   stick up/down     -> hood / flap    -> pitch that way
 *   shoulder (hold)   -> both doors + wing -> air brake, kills rotation
 *   A (tap)           -> thrust burst, mode read off the stick
 *
 * Analog throughout, so a nudge is a nudge. The door still swings and the flap
 * still drops — the player just stops addressing them one at a time. The old
 * per-panel mapping is still there behind `manualAir` for anyone who wants it.
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

/**
 * Keyboard bindings (§A).
 *
 * The keys were literals scattered through `_sampleKeyboard` until now, which
 * made the accessibility clause impossible to satisfy without touching the
 * input loop: rebinding is a stated release requirement, and a WASD-shaped
 * game is unplayable one-handed, on a non-QWERTY layout, or with a switch
 * device. So every keyboard verb is named, and the names are the seam.
 *
 * Values are arrays because several verbs legitimately answer to more than one
 * key — both shifts boost, and the arrows have always mirrored WASD for steer
 * while separately being the thrust-mode stick in the air.
 *
 * Gamepad is deliberately not remappable here. It is the priority input (§1),
 * its layout is the reference's, and a pad with a bad map is a pad the player
 * can remap at the OS. The keyboard is the fallback, so it is the one that has
 * to bend.
 */
export const DEFAULT_BINDINGS = Object.freeze({
  throttle: ['KeyW'],
  brake: ['KeyS'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  boost: ['ShiftLeft', 'ShiftRight'],
  handbrake: ['Space'],
  reset: ['Enter'],
  camera: ['KeyV'],
  style: ['KeyB'],
  airLeft: ['ArrowLeft'],
  airRight: ['ArrowRight'],
  airUp: ['ArrowUp'],
  airDown: ['ArrowDown'],
  doorL: ['KeyQ'],
  doorR: ['KeyE'],
  hood: ['KeyR'],
  trunk: ['KeyF'],
  spoiler: ['KeyC'],
});

/** What each verb is called on the controls screen, in binding order. */
export const BINDING_LABELS = Object.freeze({
  throttle: 'THROTTLE', brake: 'BRAKE / REVERSE', left: 'STEER LEFT',
  right: 'STEER RIGHT', boost: 'BOOST / THRUST', handbrake: 'HANDBRAKE',
  reset: 'RESET CAR', camera: 'CYCLE CAMERA', style: 'CYCLE ART STYLE',
  airUp: 'AIR — PITCH BACK', airDown: 'AIR — PITCH FORWARD',
  airLeft: 'AIR — ROLL LEFT', airRight: 'AIR — ROLL RIGHT',
  doorL: 'PANEL — LEFT DOOR', doorR: 'PANEL — RIGHT DOOR',
  hood: 'PANEL — HOOD', trunk: 'PANEL — TRUNK', spoiler: 'PANEL — SPOILER',
});

/** 'KeyW' -> 'W', 'ArrowLeft' -> '←' — what a player would call the key. */
export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const named = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL',
    ControlRight: 'R-CTRL', Space: 'SPACE', Enter: 'ENTER', Tab: 'TAB',
    Backspace: 'BKSP', Escape: 'ESC',
  };
  return named[code] || code.toUpperCase();
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
  airbrake: false,
  cycleCamera: false,
  cycleStyle: false,
});

export class Input {
  constructor(target = window) {
    this.target = target;
    /** Options the input layer reads: { manualAir, invertPitch }. */
    this.options = { manualAir: false, invertPitch: false };
    /** verb -> [KeyboardEvent.code]. Overridden per-player from storage. */
    this.bindings = { ...DEFAULT_BINDINGS };
    this.actions = { ...NEUTRAL_ACTIONS };
    this.prev = { ...NEUTRAL_ACTIONS };
    this.pool = [this.actions];
    this.prevs = [this.prev];
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
    // Guarded so the input layer can be constructed headlessly — the air
    // control maths is worth testing without a browser around it.
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', (e) => {
        this.source = 'gamepad';
        console.info('[AIRTIME] gamepad:', e.gamepad.id);
      });
    }
  }

  dispose() {
    this.target.removeEventListener('keydown', this._onKeyDown);
    this.target.removeEventListener('keyup', this._onKeyUp);
    this.target.removeEventListener('blur', this._onBlur);
  }

  /** Edge detect: true only on the frame the action went from false to true. */
  pressed(name) { return !!this.actions[name] && !this.prev[name]; }

  /**
   * Raw key edge, for screens that need keys the action map does not carry
   * (the replay theater's camera and export shortcuts).
   */
  pressed2(code) {
    this._rawPrev = this._rawPrev || new Set();
    const down = this.keys.has(code) || this._latched.has(code);
    const was = this._rawPrev.has(code);
    if (down) this._rawPrev.add(code); else this._rawPrev.delete(code);
    return down && !was;
  }

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
    // Menu keys are deliberately *not* remappable. A player who rebinds their
    // way out of the menus has no way back in, and the one screen that could
    // fix it is the one they can no longer reach.
    let confirm = k('Enter') || k('Space') || k('KeyZ');
    let back = k('Escape') || k('Backspace') || k('KeyX');
    let start = k('Enter');
    let alt = k('KeyY');

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
      alt = alt || btn(3);
      start = start || btn(9);
    }

    const dirs = {
      up: y > 0.5, down: y < -0.5, left: x < -0.5, right: x > 0.5,
      confirm, back, start, alt,
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

  sample(dt, airborne) { return this.sampleFor(0, dt, airborne); }

  /**
   * Sample one player's controls (§9 split-screen: up to four local players).
   *
   * Player 1 falls back to the keyboard when no pad is plugged in; players 2-4
   * are pad-only, because one keyboard cannot carry four drivers.
   */
  sampleFor(index, dt, airborne) {
    if (!this.enabled) return this.actionsFor(index);
    const a = this.actionsFor(index);
    this.prevs[index] = { ...a };

    const pad = this._pad(index);
    if (pad) this._sampleGamepad(a, pad, airborne);
    else if (index === 0) this._sampleKeyboard(a, dt, airborne);
    else Object.assign(a, NEUTRAL_ACTIONS);

    if (index === 0) { this.actions = a; this.prev = this.prevs[0]; }
    return a;
  }

  actionsFor(index) {
    this.pool = this.pool || [];
    this.prevs = this.prevs || [];
    if (!this.pool[index]) {
      this.pool[index] = { ...NEUTRAL_ACTIONS };
      this.prevs[index] = { ...NEUTRAL_ACTIONS };
    }
    return this.pool[index];
  }

  /** Edge detect for any player. */
  pressedFor(index, name) {
    const a = this.actionsFor(index);
    return !!a[name] && !(this.prevs[index] || {})[name];
  }

  /** Connected pads, in slot order. */
  pads() {
    const list = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads() : [];
    return [...list].filter((p) => p && p.connected && p.buttons.length >= 8);
  }

  get padCount() { return this.pads().length; }

  _pad(index = 0) { return this.pads()[index] || null; }


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
      if (this.options.manualAir) {
        a.hood = lt;
        a.trunk = rt;
        a.doorL = btn(4) ? 1 : 0;  // LB
        a.doorR = btn(5) ? 1 : 0;  // RB
        a.spoiler = btn(3) ? 1 : 0;// Y
      } else {
        this._flyStick(a, btn(4) || btn(5) || Math.max(lt, rt) > 0.6);
      }
    } else {
      a.throttle = rt;
      a.brake = lt;
      a.hood = 0; a.trunk = 0; a.doorL = 0; a.doorR = 0; a.spoiler = 0;
    }
  }

  /**
   * Turn a stick position into bodywork. Roll is one door, pitch is hood or
   * flap, and the brake is everything that kills rotation at once.
   *
   * Measured behaviour this relies on (tools/probe-aero.mjs): left door rolls
   * left, hood pitches nose up, tail flap pitches nose down, both doors are an
   * air brake worth six times the bare car's drag.
   */
  _flyStick(a, brake) {
    // A door only bites once it is properly out into the airflow: at 40% open
    // its face is still nearly edge-on and it does almost nothing, so a linear
    // stick feels dead for its first half. The curve puts a small deflection
    // meaningfully into the air and lets magnitude modulate from there.
    const curve = (v) => Math.sign(v) * Math.pow(Math.abs(clamp(v, -1, 1)), TUNING.INPUT.AIR_CURVE);
    const px = curve(a.stickX);
    const py = curve(a.stickY) * (this.options.invertPitch ? -1 : 1);
    a.doorL = Math.max(0, -px);
    a.doorR = Math.max(0, px);
    a.hood = Math.max(0, py);
    a.trunk = Math.max(0, -py);
    a.spoiler = 0;
    if (brake) { a.doorL = 1; a.doorR = 1; a.spoiler = 1; a.airbrake = true; }
    else a.airbrake = false;
  }

  /**
   * Replace the keyboard map. Anything absent keeps its default, so a saved
   * map from an older build cannot leave a verb unbound and the car
   * unsteerable — the failure mode of storing the whole map rather than the
   * overrides.
   */
  setBindings(map) {
    this.bindings = { ...DEFAULT_BINDINGS };
    for (const [verb, codes] of Object.entries(map || {})) {
      if (!(verb in DEFAULT_BINDINGS)) continue;
      const list = (Array.isArray(codes) ? codes : [codes]).filter(Boolean);
      if (list.length) this.bindings[verb] = list;
    }
    return this.bindings;
  }

  _sampleKeyboard(a, dt, airborne) {
    const T = TUNING.INPUT;
    const b = this.bindings;
    /** Is any key bound to this verb down? */
    const v = (verb) => b[verb].some((c) => this.keys.has(c));

    // Virtual analog steering so keyboard is not a bang-bang input.
    const want = (v('left') ? -1 : 0) + (v('right') ? 1 : 0);
    const rate = want === 0 ? T.KEYBOARD_STEER_RETURN : T.KEYBOARD_STEER_RATE;
    this._vSteer += clamp(want - this._vSteer, -rate * dt, rate * dt);
    a.steer = clamp(this._vSteer, -1, 1);

    // In the air the arrow keys become the thrust-mode stick (§5).
    a.stickX = (v('airLeft') ? -1 : 0) + (v('airRight') ? 1 : 0);
    a.stickY = (v('airUp') ? 1 : 0) + (v('airDown') ? -1 : 0);

    a.boost = v('boost');
    a.thrust = a.boost;
    a.handbrake = v('handbrake');
    a.reset = v('reset');
    a.cycleCamera = v('camera');
    a.cycleStyle = v('style');

    if (airborne) {
      a.throttle = 0; a.brake = 0;
      if (this.options.manualAir) {
        a.doorL = v('doorL') ? 1 : 0;
        a.doorR = v('doorR') ? 1 : 0;
        a.hood = v('hood') ? 1 : 0;
        a.trunk = v('trunk') ? 1 : 0;
        a.spoiler = v('spoiler') ? 1 : 0;
      } else {
        // The stick verbs already fill stickX/stickY above; the drive keys
        // mirror them in the air.
        if (v('left')) a.stickX = -1;
        if (v('right')) a.stickX = 1;
        if (v('throttle')) a.stickY = 1;
        if (v('brake')) a.stickY = -1;
        this._flyStick(a, v('handbrake'));
      }
    } else {
      a.throttle = v('throttle') ? 1 : 0;
      a.brake = v('brake') ? 1 : 0;
      a.doorL = 0; a.doorR = 0; a.hood = 0; a.trunk = 0; a.spoiler = 0;
    }
  }
}

export default Input;
