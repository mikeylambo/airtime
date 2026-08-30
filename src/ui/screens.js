/**
 * Screen manager (§2, §2.1).
 *
 * "No loading screens between menu nodes — the garage car and the arena stream
 * behind the UI. Every transition <= 300ms, eased, never cut. Back is always
 * one input, from anywhere."
 *
 * The 3D scene keeps rendering underneath the whole time; screens are DOM
 * overlays over a live world, which is what makes that rule cheap to keep.
 */

import TUNING from '../TUNING.js';

export class Screen {
  constructor(name, { html = '', onEnter, onExit, onMenu, onTick, keepWorld = true } = {}) {
    this.name = name;
    this.html = html;
    this.onEnter = onEnter;
    this.onExit = onExit;
    this.onMenu = onMenu;       // (menuEdges, ctx) => optional next screen name
    this.onTick = onTick;
    this.keepWorld = keepWorld;
    this.el = null;
  }
}

export class ScreenManager {
  constructor(root, ctx = {}) {
    this.root = root;
    this.ctx = ctx;
    this.screens = new Map();
    this.current = null;
    this.stack = [];
    this.busy = 0;
  }

  register(screen) {
    const el = document.createElement('div');
    el.className = `screen screen-${screen.name}`;
    el.innerHTML = screen.html;
    el.style.display = 'none';
    this.root.appendChild(el);
    screen.el = el;
    this.screens.set(screen.name, screen);
    return screen;
  }

  get(name) { return this.screens.get(name); }

  /** Push a screen, remembering where we came from so Back is one input. */
  push(name, data) {
    if (this.current) this.stack.push(this.current.name);
    return this.go(name, data);
  }

  /** §2.1: "Back is always one input, from anywhere." */
  back(fallback = 'main') {
    const prev = this.stack.pop();
    return this.go(prev || fallback, undefined, true);
  }

  go(name, data, isBack = false) {
    const next = this.screens.get(name);
    if (!next || next === this.current) return this.current;

    const prev = this.current;
    if (prev) {
      prev.el.classList.add(isBack ? 'leaving-back' : 'leaving');
      prev.el.classList.remove('active');
      if (prev.onExit) prev.onExit(this.ctx);
      const el = prev.el;
      setTimeout(() => {
        el.style.display = 'none';
        el.classList.remove('leaving', 'leaving-back');
      }, TUNING.UI.TRANSITION * 1000);
    }

    this.current = next;
    next.el.style.display = '';
    next.el.classList.remove('leaving', 'leaving-back');
    // Force a reflow so the enter transition actually plays.
    void next.el.offsetWidth;
    next.el.classList.add('active');
    this.busy = TUNING.UI.TRANSITION;
    if (next.onEnter) next.onEnter(this.ctx, data);
    return next;
  }

  tick(dt, menu) {
    if (this.busy > 0) this.busy -= dt;
    const s = this.current;
    if (!s) return;
    if (s.onTick) s.onTick(dt, this.ctx);
    if (s.onMenu && this.busy <= 0 && menu && menu.any) s.onMenu(menu, this.ctx);
  }
}

/**
 * A vertical list with a cursor — the shape most of §2's screens take.
 * Returns a controller the screen can drive from menu edges.
 */
export function makeList(el, items, onPick, onMove) {
  let index = 0;
  const render = () => {
    el.innerHTML = items
      .map((it, i) => {
        const dis = it.locked ? ' locked' : '';
        const sel = i === index ? ' selected' : '';
        const note = it.note ? `<em>${it.note}</em>` : '';
        return `<div class="row${sel}${dis}" data-i="${i}"><span>${it.label}</span>${note}</div>`;
      })
      .join('');
    // Keep the cursor on screen in a list too long for its pane. A no-op for
    // every list that fits, which is all of them except the keyboard map — and
    // that one is eighteen verbs long and ran straight off the bottom.
    const sel = el.querySelector('.row.selected');
    if (sel && el.scrollHeight > el.clientHeight + 1) sel.scrollIntoView({ block: 'nearest' });
  };
  const move = (d) => {
    const n = items.length;
    for (let k = 0; k < n; k++) {
      index = (index + d + n) % n;
      if (!items[index].locked) break;
    }
    render();
    if (onMove) onMove(items[index], index);
  };
  render();
  return {
    get index() { return index; },
    get item() { return items[index]; },
    setItems(next) { items = next; index = Math.min(index, items.length - 1); render(); },
    render,
    handle(menu) {
      if (menu.up) move(-1);
      else if (menu.down) move(1);
      else if (menu.confirm && !items[index].locked) onPick(items[index], index);
    },
  };
}
