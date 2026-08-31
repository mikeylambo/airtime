/**
 * AFTERGLOW's smear — geometry, never blur (airtime-art-direction.md).
 *
 * Four systems, all responses to what the simulation did:
 *
 * - **Trail ribbons.** Camera-facing strips written from each wheel and each
 *   deployed panel, fading over ~1.5s. Rotation becomes visible as ribbons —
 *   a tumbling car in a 9:16 crop reads because its motion is drawn in light.
 * - **Persistent lines.** Every flight worth banking leaves its arc glowing
 *   in the air for most of a round. This is the art direction, not a feature:
 *   the arena accumulates everyone's lines, and the round paints itself.
 * - **Rotation ghosts.** When |angular velocity| spikes, fading shells of the
 *   car's own trim geometry are left behind — the flip made visible.
 * - **Landing splash and decals.** A WHITE-HOT ring scaled by the landing,
 *   its bright core capped at 120ms (photosensitivity, release spec §A), and
 *   a Perfect burns a lasting mark in the player's colour.
 *
 * One additive draw call for all ribbons, one for the persistent lines, a
 * small pool for shells and rings. Nothing here allocates per frame.
 */

import * as THREE from 'three';
import TUNING from '../TUNING.js';
import { THEME, playerColor, isReduced, setReduceEffects } from './theme.js';
import { SLOTS } from '../sim/panels.js';

const MAX_PLAYERS = 4;
const EMITTERS = 4 + SLOTS.length;         // four wheels + five aero surfaces
const LINE_POINTS = 4096;                  // persistent-line ring buffer

/**
 * The colourblind shape channel: colour alone is never the only signal, so
 * each player's ribbon carries a dash pattern (solid / dashed / dotted /
 * chevron) keyed by segment index.
 */
const SHAPE = [
  () => 1,
  (i) => (i % 3 < 2 ? 1 : 0),              // dashed
  (i) => (i % 2 ? 0 : 1),                  // dotted
  (i) => (i % 4 < 2 ? 1 : 0.45),           // chevron — alternating weight
];

export class Trails {
  constructor(scene) {
    this.scene = scene;
    this.enabled = true;
    this.colorblind = false;
    this.players = 1;
    const T = TUNING.TRAILS;

    // ── Ribbon state: ring buffers, flat arrays, no objects ───────────────
    const N = T.RIBBON_POINTS;
    const total = MAX_PLAYERS * EMITTERS;
    this.N = N;
    this.rx = new Float32Array(total * N); this.ry = new Float32Array(total * N); this.rz = new Float32Array(total * N);
    this.rage = new Float32Array(total * N).fill(Infinity);
    this.rstr = new Float32Array(total * N);
    this.rhead = new Int32Array(total);

    const maxVerts = total * (N - 1) * 6;
    const geo = new THREE.BufferGeometry();
    this.rpos = new Float32Array(maxVerts * 3);
    this.rcol = new Float32Array(maxVerts * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.rpos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.rcol, 3));
    geo.setDrawRange(0, 0);
    this.ribbons = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.ribbons.frustumCulled = false;
    this.ribbons.renderOrder = 4;
    scene.add(this.ribbons);
    this.rgeo = geo;

    // ── Persistent lines: one additive line buffer for the whole round ────
    const lgeo = new THREE.BufferGeometry();
    this.lpos = new Float32Array(LINE_POINTS * 2 * 3);
    this.lcol = new Float32Array(LINE_POINTS * 2 * 3);
    lgeo.setAttribute('position', new THREE.BufferAttribute(this.lpos, 3));
    lgeo.setAttribute('color', new THREE.BufferAttribute(this.lcol, 3));
    lgeo.setDrawRange(0, 0);
    this.lbirth = new Float32Array(LINE_POINTS).fill(-Infinity);
    this.lplayer = new Uint8Array(LINE_POINTS);
    this.lhead = 0;
    this.lcount = 0;
    this.ltime = 0;
    this.lines = new THREE.LineSegments(lgeo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: TUNING.TRAILS.LINE_OPACITY,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    this.lgeo = lgeo;

    // Arc-in-progress per player, committed on a banked landing.
    this.arcs = Array.from({ length: MAX_PLAYERS }, () => []);

    // ── Ghost shells and splash rings: small pools ────────────────────────
    this.ghosts = [];                      // { line, life, max }
    this.ghostTimer = new Float32Array(MAX_PLAYERS);

    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.86, 1, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const coreGeo = new THREE.CircleGeometry(1, 24);
    coreGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ mesh, life: 0, max: 1, radius: 1, decal: false });
    }
    // WHITE-HOT cores, capped at SPLASH_FLASH seconds — the §A rule.
    this.cores = [];
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: THEME.WHITE_HOT, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(coreGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.cores.push({ mesh, life: 0 });
    }

    this._v = new THREE.Vector3();
    this._c = new THREE.Color();
    // SPECTRAL BLUR: the two cools light passes through as it recedes or ages —
    // iris across the bright middle, cyan at the faint end. Resolved once.
    this._iris = new THREE.Color(THEME.IRIS);
    this._tail = new THREE.Color(THEME.CYAN);
    this._sr = 0; this._sg = 0; this._sb = 0;   // sweep scratch, no per-frame alloc
  }

  /**
   * SPECTRAL BLUR: sweep a colour from `c` (hot) through iris to cyan by u in
   * [0,1]. Writes _sr/_sg/_sb rather than allocating, because the persistent
   * lines call this thousands of times a frame. Colourblind mode opts out and
   * keeps the flat colour, so the shape channel and the measured hue distances
   * stay intact. Shared by the ribbons and the persistent lines so they never
   * drift apart.
   */
  _sweep(c, u) {
    if (this.colorblind) { this._sr = c.r; this._sg = c.g; this._sb = c.b; return; }
    const iris = this._iris, tail = this._tail;
    let ar, ag, ab, br, bg, bb, t;
    if (u < 0.5) { t = u * 2; ar = c.r; ag = c.g; ab = c.b; br = iris.r; bg = iris.g; bb = iris.b; }
    else { t = (u - 0.5) * 2; ar = iris.r; ag = iris.g; ab = iris.b; br = tail.r; bg = tail.g; bb = tail.b; }
    this._sr = ar + (br - ar) * t; this._sg = ag + (bg - ag) * t; this._sb = ab + (bb - ab) * t;
  }

  setPlayerCount(n) { this.players = Math.min(n, MAX_PLAYERS); }

  /** SPECTRAL BLUR: retune the iris and cyan the ribbons and lines sweep to. */
  setSpectral(irisHex, cyanHex) {
    if (irisHex != null) this._iris.setHex(irisHex);
    if (cyanHex != null) this._tail.setHex(cyanHex);
  }

  setOptions({ reduceEffects, colorblind }) {
    // Reduce Effects is a whole-game switch (render/theme.js), not a trails
    // flag — three later systems ignored it by keeping their own copy. This
    // stays as a pass-through so every existing caller keeps working.
    if (reduceEffects !== undefined) setReduceEffects(reduceEffects);
    if (colorblind !== undefined) this.colorblind = colorblind;
  }

  get reduceEffects() { return isReduced(); }

  /** A fresh round wipes the painted arena. */
  beginRound() {
    this.rage.fill(Infinity);
    this.lbirth.fill(-Infinity);
    this.lhead = 0; this.lcount = 0; this.ltime = 0;
    for (const a of this.arcs) a.length = 0;
    for (const g of this.ghosts) { this.scene.remove(g.line); g.line.material.dispose(); }
    this.ghosts.length = 0;
    for (const r of this.rings) { r.life = 0; r.mesh.visible = false; }
    for (const c of this.cores) { c.life = 0; c.mesh.visible = false; }
  }

  _color(p) { return this._c.setHex(playerColor(p, this.colorblind)); }

  // ── Emission ─────────────────────────────────────────────────────────────

  _push(slot, x, y, z, strength) {
    const N = this.N;
    const head = this.rhead[slot];
    const i = slot * N + head;
    // Skip if we have not moved far enough for a new sample.
    const prev = slot * N + ((head + N - 1) % N);
    if (this.rage[prev] < Infinity) {
      const dx = x - this.rx[prev], dy = y - this.ry[prev], dz = z - this.rz[prev];
      if (dx * dx + dy * dy + dz * dz < TUNING.TRAILS.RIBBON_MIN_DIST ** 2) return;
    }
    this.rx[i] = x; this.ry[i] = y; this.rz[i] = z;
    this.rage[i] = 0;
    this.rstr[i] = strength;
    this.rhead[slot] = (head + 1) % N;
  }

  /**
   * Sample the world. `views` are the car views (the wheels' world transforms
   * live there), `state` is the sim snapshot the renderer already holds.
   */
  update(dt, state, views, camera, rand) {
    if (!this.enabled) { this.rgeo.setDrawRange(0, 0); this.lgeo.setDrawRange(0, 0); return; }
    const T = TUNING.TRAILS;
    this.ltime += dt;

    for (let p = 0; p < this.players; p++) {
      const ps = state.players[p];
      const view = views[p];
      if (!ps || !view) continue;
      const speed = Math.hypot(ps.linvel.x, ps.linvel.y, ps.linvel.z);
      const drive = Math.min(1, Math.max(0, (speed - T.RIBBON_MIN_SPEED) / 18));
      const strength = ps.airborne ? Math.max(0.55, drive) : drive;

      // Wheels write light with speed; in the air they tumble with the car,
      // which is exactly what makes rotation legible as ribbons.
      if (strength > 0) {
        for (let w = 0; w < 4; w++) {
          view.wheels[w].pivot.getWorldPosition(this._v);
          this._push(p * EMITTERS + w, this._v.x, this._v.y, this._v.z, strength);
        }
      }
      // Deployed panels write light always — steering the air lights it up.
      SLOTS.forEach((slot, s) => {
        const part = ps.panels && ps.panels[slot];
        if (!part || part.deploy < T.PANEL_DEPLOY_MIN || !part.attached) return;
        const mesh = view.panels[slot];
        this._push(p * EMITTERS + 4 + s, mesh.position.x, mesh.position.y, mesh.position.z,
          0.4 + 0.6 * part.deploy);
      });

      // The flight arc, for the persistent line.
      if (ps.airborne) {
        const arc = this.arcs[p];
        const last = arc[arc.length - 1];
        const pos = ps.position;
        if (!last || (last.x - pos.x) ** 2 + (last.y - pos.y) ** 2 + (last.z - pos.z) ** 2 > 1.44) {
          arc.push({ x: pos.x, y: pos.y, z: pos.z });
        }
      }

      // Rotation ghosts — the flip made visible.
      this.ghostTimer[p] -= dt;
      if (!this.reduceEffects && ps.airborne && ps.rotationRate > T.GHOST_SPIN
          && this.ghostTimer[p] <= 0) {
        this._spawnGhost(p, view);
        this.ghostTimer[p] = T.GHOST_EVERY;
      }
    }

    this._age(dt, camera);
    this._updateGhosts(dt);
    this._updateRings(dt);
    this._updateLines();
  }

  _spawnGhost(p, view) {
    const T = TUNING.TRAILS;
    const edge = view.body.userData.__edge;
    if (!edge) return;                     // graybox draws no trim to ghost
    const live = this.ghosts.filter((g) => g.player === p);
    if (live.length >= T.GHOST_MAX) return;
    const line = new THREE.LineSegments(edge.geometry, new THREE.LineBasicMaterial({
      color: playerColor(p, this.colorblind), transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    line.matrixAutoUpdate = false;
    view.body.updateWorldMatrix(true, false);
    line.matrix.copy(view.body.matrixWorld);
    line.frustumCulled = false;
    this.scene.add(line);
    this.ghosts.push({ line, life: T.GHOST_LIFE, max: T.GHOST_LIFE, player: p });
  }

  _updateGhosts(dt) {
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.life -= dt;
      if (g.life <= 0) {
        this.scene.remove(g.line);
        g.line.material.dispose();          // geometry is shared with the car
        this.ghosts.splice(i, 1);
      } else {
        g.line.material.opacity = 0.8 * (g.life / g.max);
      }
    }
  }

  // ── Events ───────────────────────────────────────────────────────────────

  /** Fed from the same event stream the audio and particles hear. */
  onEvent(e, car) {
    if (!this.enabled) return;
    const T = TUNING.TRAILS;
    if (e.type !== 'landed' || !e.result) return;
    const p = e.player || 0;
    const r = e.result;
    const pos = car.position;

    // The splash: sized by what the landing was worth.
    const tierMult = r.tierMult || 1;
    const scale = (this.reduceEffects ? T.REDUCED_SPLASH_SCALE : 1)
      * Math.min(1.6, 0.55 + 0.35 * tierMult);
    if (r.landed) {
      this._ring(pos, T.SPLASH_RADIUS * scale, T.SPLASH_LIFE, THEME.WHITE_HOT, false);
      this._core(pos, 2.6 * scale);
      // Perfect burns a lasting mark in the player's colour.
      if (r.quality === 'perfect') {
        this._ring(pos, 4.2, T.DECAL_LIFE, playerColor(p, this.colorblind), true);
      }
    } else {
      // A crash still marks the world — heat, not reward.
      this._ring(pos, T.SPLASH_RADIUS * 0.5 * scale, T.SPLASH_LIFE, THEME.PINK, false);
    }

    // Commit the flight arc as a persistent line, or throw it away.
    const arc = this.arcs[p];
    if (r.landed && r.total >= T.LINE_MIN_SCORE && arc.length > 2) {
      for (let i = 1; i < arc.length; i++) this._line(arc[i - 1], arc[i], p);
    }
    arc.length = 0;
  }

  _ring(pos, radius, life, color, decal) {
    const r = this.rings.find((x) => x.life <= 0);
    if (!r) return;
    r.life = life; r.max = life; r.radius = radius; r.decal = decal;
    r.mesh.material.color.setHex(color);
    r.mesh.position.set(pos.x, pos.y - 0.2, pos.z);
    r.mesh.visible = true;
  }

  _core(pos, radius) {
    const c = this.cores.find((x) => x.life <= 0);
    if (!c) return;
    c.life = TUNING.TRAILS.SPLASH_FLASH;
    c.mesh.scale.setScalar(radius);
    c.mesh.position.set(pos.x, pos.y - 0.1, pos.z);
    c.mesh.visible = true;
  }

  _updateRings(dt) {
    const T = TUNING.TRAILS;
    for (const r of this.rings) {
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      r.life -= dt;
      const u = 1 - Math.max(0, r.life) / r.max;
      if (r.decal) {
        // A decal sits at size and slowly cools.
        r.mesh.scale.setScalar(r.radius);
        r.mesh.material.opacity = 0.5 * (1 - u);
      } else {
        // The splash expands and dies — an outline, never a flash.
        r.mesh.scale.setScalar(0.5 + r.radius * u);
        r.mesh.material.opacity = 0.85 * (1 - u);
      }
      if (r.life <= 0) r.mesh.visible = false;
    }
    for (const c of this.cores) {
      if (c.life <= 0) { c.mesh.visible = false; continue; }
      c.life -= dt;
      c.mesh.material.opacity = Math.max(0, c.life / T.SPLASH_FLASH) * 0.9;
      if (c.life <= 0) c.mesh.visible = false;
    }
  }

  // ── Persistent lines ─────────────────────────────────────────────────────

  _line(a, b, player) {
    const i = this.lhead;
    this.lhead = (this.lhead + 1) % LINE_POINTS;
    this.lcount = Math.min(this.lcount + 1, LINE_POINTS);
    const o = i * 6;
    this.lpos[o] = a.x; this.lpos[o + 1] = a.y; this.lpos[o + 2] = a.z;
    this.lpos[o + 3] = b.x; this.lpos[o + 4] = b.y; this.lpos[o + 5] = b.z;
    this.lbirth[i] = this.ltime;
    this.lplayer[i] = player;
  }

  _updateLines() {
    const T = TUNING.TRAILS;
    if (!this.lcount) { this.lgeo.setDrawRange(0, 0); return; }
    for (let i = 0; i < this.lcount; i++) {
      const age = this.ltime - this.lbirth[i];
      const fade = Math.max(0, 1 - age / T.LINE_LIFE);
      const c = this._color(this.lplayer[i]);
      // SPECTRAL BLUR: a flight line cools as it ages — hot in the player's
      // colour when it is fresh, dissolving toward cyan haze as the round wears
      // on, so the arena's accumulated history reads as spectral light rather
      // than a scatter of flat player-coloured arcs.
      this._sweep(c, Math.min(1, age / T.LINE_LIFE));
      const r = this._sr * fade, g = this._sg * fade, b = this._sb * fade;
      const o = i * 6;
      this.lcol[o] = r; this.lcol[o + 1] = g; this.lcol[o + 2] = b;
      this.lcol[o + 3] = r; this.lcol[o + 4] = g; this.lcol[o + 5] = b;
    }
    this.lgeo.setDrawRange(0, this.lcount * 2);
    this.lgeo.attributes.position.needsUpdate = true;
    this.lgeo.attributes.color.needsUpdate = true;
  }

  // ── Ribbon geometry ──────────────────────────────────────────────────────

  _age(dt, camera) {
    const T = TUNING.TRAILS;
    const N = this.N;
    const life = T.RIBBON_LIFE;
    const keep = this.reduceEffects ? T.REDUCED_RIBBON_POINTS : N;
    const camPos = camera.position;
    let v = 0;                             // vertex cursor

    for (let slot = 0; slot < this.players * EMITTERS; slot++) {
      const player = Math.floor(slot / EMITTERS);
      const c = this._color(player);
      const shape = this.colorblind ? SHAPE[player % SHAPE.length] : SHAPE[0];
      const base = slot * N;
      const head = this.rhead[slot];
      // Walk from oldest to newest so consecutive samples chain correctly.
      let px = 0, py = 0, pz = 0, has = false, seg = 0;
      for (let k = 0; k < N; k++) {
        const i = base * 1 + ((head + k) % N);
        if (this.rage[i] === Infinity) continue;
        this.rage[i] += dt;
        if (this.rage[i] > life || k < N - keep) { this.rage[i] = Infinity; continue; }
        const x = this.rx[i], y = this.ry[i], z = this.rz[i];
        if (has) {
          // A long jump between samples is a discontinuity — the emitter
          // paused, or the car respawned across the arena — not a segment.
          // Without this check one quad spans the teleport and fills half
          // the frame with a light fan.
          const gap = (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2;
          if (gap > 36) { px = x; py = y; pz = z; seg = 0; continue; }
          const w = shape(seg++);
          if (w > 0) {
            const ageU = Math.min(1, this.rage[i] / life);
            const fade = (1 - ageU) * this.rstr[i];
            // Camera-facing extrusion: side = segment × view, per segment.
            const sx = x - px, sy = y - py, sz = z - pz;
            const vx = x - camPos.x, vy = y - camPos.y, vz = z - camPos.z;
            let ox = sy * vz - sz * vy, oy = sz * vx - sx * vz, oz = sx * vy - sy * vx;
            const ol = Math.hypot(ox, oy, oz) || 1;
            // A ribbon, not a beam: thin where it leaves the wheel, swelling
            // behind the car, dying at the tail. Brightness runs the other
            // way — hot at the source — so the trail reads as drawn light.
            const half = T.RIBBON_WIDTH * w * (0.15 + 0.85 * Math.sin(Math.PI * ageU));
            ox = (ox / ol) * half; oy = (oy / ol) * half; oz = (oz / ol) * half;
            // Light dissolves at the lens (additive: black = gone). Without
            // this a ribbon passing the camera is a screen-filling slab, and
            // the ≥85% dark rule dies at every close flyby (probe:dark).
            const lens = Math.min(1, Math.hypot(vx, vy, vz) / T.LENS_FADE);
            const glow = fade * 0.8 * lens * lens;
            // SPECTRAL BLUR: the ribbon sweeps the spectrum as it recedes — the
            // player's hot colour at the car, through iris across its bright
            // middle, to cyan at the faint tail. The midpoint stop puts the
            // violet where the light still is (cooling only at ageU→1 hid it in
            // the part that has already faded out).
            this._sweep(c, ageU);
            const cr = this._sr * glow, cg = this._sg * glow, cb = this._sb * glow;
            // Two triangles: (p-, p+, q-), (q-, p+, q+)
            const quad = [
              px - ox, py - oy, pz - oz, px + ox, py + oy, pz + oz, x - ox, y - oy, z - oz,
              x - ox, y - oy, z - oz, px + ox, py + oy, pz + oz, x + ox, y + oy, z + oz,
            ];
            for (let q = 0; q < 18; q += 3) {
              this.rpos[v * 3] = quad[q]; this.rpos[v * 3 + 1] = quad[q + 1]; this.rpos[v * 3 + 2] = quad[q + 2];
              this.rcol[v * 3] = cr; this.rcol[v * 3 + 1] = cg; this.rcol[v * 3 + 2] = cb;
              v++;
            }
          } else seg++;
        }
        px = x; py = y; pz = z; has = true;
      }
    }

    this.rgeo.setDrawRange(0, v);
    if (v) {
      this.rgeo.attributes.position.needsUpdate = true;
      this.rgeo.attributes.color.needsUpdate = true;
    }
    this.live = v / 6;
  }

  dispose() {
    this.scene.remove(this.ribbons, this.lines);
    this.rgeo.dispose(); this.lgeo.dispose();
    for (const g of this.ghosts) { this.scene.remove(g.line); g.line.material.dispose(); }
    for (const r of this.rings) this.scene.remove(r.mesh);
    for (const c of this.cores) this.scene.remove(c.mesh);
  }
}

export default Trails;
