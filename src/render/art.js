/**
 * Art styles (§11 Art gate: "the same park jump rendered in neon wireframe and
 * flat low-poly; pick from footage, not description").
 *
 * Three complete looks over one scene graph. Every mesh registers its role
 * ('deck', 'ramp', 'roof', 'billboard', 'pool', 'secret', 'body', 'panel',
 * 'wheel', 'glass') and a style swap re-materialises by role, so no geometry
 * is duplicated and the footage differs only in look.
 */

import * as THREE from 'three';
import TUNING from '../TUNING.js';
import { THEME } from './theme.js';

export const STYLES = ['afterglow', 'graybox'];

// The looks the pivot retired still live in old saves.
const LEGACY = { neon: 'afterglow', lowpoly: 'afterglow' };

const PALETTES = {
  // AFTERGLOW (airtime-art-direction.md): a dark world where speed and
  // rotation are the only light sources. VOID/ASPHALT own ≥85% of any frame.
  //
  // The fills have to be nearly black. Give the faces any real brightness and
  // they swallow the one-pixel edges completely and the whole thing reads as
  // flat plastic rather than drawn light. Neon is *earned*: the bright things
  // are the car's trim, deployed panels, billboards (they are targets —
  // brightness is "land here" language) and whatever the trails write.
  afterglow: {
    // SPECTRAL BLUR tone pass: the atmosphere leans blue-violet. The fog is a
    // hair off pure black so distance dissolves into spectral haze rather than
    // a hard black edge, and the hemisphere and key light carry an iris tint —
    // the world lit as if through the same haze the trails smear into. Kept
    // deliberately small: probe:dark still measures the worst frame ≥85% dark.
    background: THEME.VOID, fog: 0x0c0b1a, fogNear: 150, fogFar: 840,
    hemiSky: 0x1a1640, hemiGround: THEME.VOID, hemiInt: 0.42,
    sunColor: 0x9088d8, sunInt: 0.38, ambient: 0x08081a, exposure: 1.25,
    roles: {
      deck: { color: 0x0d0d16, rough: 1, emissive: 0x040409 },
      // Ramps are dark slabs with emissive edge-strips; the edge colour is
      // overridden per ramp to encode its grade (theme.js rampGradeColor).
      ramp: { color: THEME.ASPHALT, emissive: 0x0a0a12, edge: THEME.GREEN },
      // Static geometry gets legibility edges, not decoration — dim enough
      // to read as architecture, never as reward.
      roof: { color: THEME.ASPHALT, emissive: 0x08080f, edge: 0x30304a },
      billboard: { color: 0x1a0a14, emissive: 0x53153a, edge: THEME.PINK },
      pool: { color: 0x0a1512, emissive: 0x0e2a1e, edge: THEME.GREEN },
      secret: { color: 0x140a1f, emissive: 0x261040, edge: THEME.VIOLET },
      leg: { color: THEME.ASPHALT, emissive: 0x0a0a12, edge: 0x26263c },
      // The car is the hero object: near-black body, emissive cut-lines in
      // the player colour. (Per-player trim colours land with the trim pass.)
      body: { color: 0x0c0c14, rough: 0.4, metal: 0.2, emissive: 0x1a0714, edge: THEME.MAGENTA },
      panel: { color: 0x0e0e18, emissive: 0x2a0b1e, edge: THEME.PINK },
      wheel: { color: 0x0a0a10, emissive: 0x14061a, edge: THEME.VIOLET },
      // Traffic is dim; players are bright.
      traffic: { color: 0x101018, emissive: 0x14141f, edge: 0x3a3a55 },
      glass: { color: 0x08080f, emissive: 0x0d1420, edge: 0x3d5f8a },
    },
    grid: 0x232338, gridOpacity: 0.35, lines: true,
  },
  // The lit gray box §10 asks for: no colour decisions, just form and light.
  // Kept as the honest diagnostic for judging physics and framing.
  graybox: {
    background: 0x8a97a4, fog: 0x8a97a4, fogNear: 220, fogFar: 1000,
    hemiSky: 0xbcc9d6, hemiGround: 0x4a5058, hemiInt: 0.85,
    sunColor: 0xfff6e8, sunInt: 1.55, ambient: 0x000000,
    roles: {
      deck: { color: 0x6f7780, rough: 0.95 },
      ramp: { color: 0x9aa3ad, rough: 0.88 },
      roof: { color: 0x848d97, rough: 0.9 },
      billboard: { color: 0xa8b1bb, rough: 0.8 },
      pool: { color: 0x7c8792, rough: 0.75 },
      secret: { color: 0xb6bec7, rough: 0.7 },
      leg: { color: 0x5e666e, rough: 0.9 },
      body: { color: 0x9fa8b2, rough: 0.55, metal: 0.15 },
      // Warm against the cool bodywork: a deployed part has to be obvious at a
      // glance, because Gate A is the claim that you can *see* them steer.
      panel: { color: 0xffb066, rough: 0.45, metal: 0.1 },
      wheel: { color: 0x2b2f34, rough: 0.95 },
      traffic: { color: 0x7d8894, rough: 0.8 },
      glass: { color: 0x3b444d, rough: 0.25, metal: 0.5 },
    },
    grid: 0x000000, gridOpacity: 0.13, lines: false,
  },
};

export class ArtDirector {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.style = null;
    this.grid = null;
    this.registry = [];        // { mesh, role }
    this.edges = [];           // wireframe overlays, neon only
    this.materials = new Map();
    this.lights = {};
    this._buildLights();
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(-180, 260, 140);
    sun.castShadow = TUNING.RENDER.SHADOWS;
    const S = TUNING.RENDER.SHADOW_MAP;
    sun.shadow.mapSize.set(S, S);
    sun.shadow.camera.near = 20;
    sun.shadow.camera.far = 900;
    // Tight frustum: the shadow map only ever needs to cover the car and the
    // ramp it is on. Spread it over the whole park and the texel size on a
    // 600 m deck is large enough that the acne reads as banding across the
    // ground, which is exactly what it looked like.
    const half = 90;
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.14;
    this.sunTarget = new THREE.Object3D();
    this.scene.add(this.sunTarget);
    sun.target = this.sunTarget;
    const amb = new THREE.AmbientLight(0x000000, 1);
    this.scene.add(hemi, sun, amb);
    this.lights = { hemi, sun, amb };
  }

  /**
   * Every mesh declares what it is; the style decides what that looks like.
   * @param opts { edge, threshold, opacity } — per-mesh trim overrides: edge
   *   colour (a ramp encoding its grade, a car in its player's colour), the
   *   crease angle above which a line is drawn (trim archetypes), and how
   *   bright the trim starts.
   */
  register(mesh, role, opts = {}) {
    this.registry.push({ mesh, role, opts });
    if (this.style) {
      this._material(mesh, role);
      if (PALETTES[this.style].lines) this._edgesFor(mesh, role, opts);
    }
    return mesh;
  }

  /**
   * Change a registered mesh's trim overrides — a car swap changes both its
   * player colour and its archetype, and the cached wireframe has to follow.
   */
  setEdgeOpts(mesh, opts) {
    const entry = this.registry.find((r) => r.mesh === mesh);
    if (!entry) return;
    entry.opts = { ...entry.opts, ...opts };
    this.invalidateEdges(mesh);
    if (this.style && PALETTES[this.style].lines) this._edgesFor(mesh, entry.role, entry.opts);
  }

  /**
   * Drop everything under `root` from the registry.
   *
   * Swapping arenas removes the old meshes from the scene, but leaving them
   * registered leaks their geometry and — worse — makes the edge pass think it
   * has already run, so the *new* arena silently renders with no wireframe.
   */
  unregisterUnder(root) {
    const dead = new Set();
    root.traverse((o) => dead.add(o));
    this.registry = this.registry.filter((r) => !dead.has(r.mesh));
    this.edges = this.edges.filter((e) => !dead.has(e) && !dead.has(e.parent));
  }

  _key(role) { return `${this.style}:${role}`; }

  _material(mesh, role) {
    const p = PALETTES[this.style];
    const spec = p.roles[role] || p.roles.deck;
    const key = this._key(role);
    let mat = this.materials.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color: (this.tints && this.tints[role] != null && this.style !== 'afterglow') ? this.tints[role] : spec.color,
        roughness: spec.rough ?? 0.9,
        metalness: spec.metal ?? 0.0,
        emissive: spec.emissive ?? 0x000000,
        emissiveIntensity: spec.emissive ? 1.0 : 0,
        // Neon draws the wireframe on top; without this the near faces of a
        // ramp hide the edges of everything behind them.
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
        flatShading: !!spec.flat,
      });
      this.materials.set(key, mat);
    }
    mesh.material = mat;
  }

  setStyle(style) {
    style = LEGACY[style] || style;        // saved options may name a retired look
    if (!STYLES.includes(style)) style = STYLES[0];
    this.style = style;
    const p = PALETTES[style];

    this.scene.background = new THREE.Color(p.background);
    this.scene.fog = new THREE.Fog(p.fog, p.fogNear, p.fogFar);
    this.lights.hemi.color.setHex(p.hemiSky);
    this.lights.hemi.groundColor.setHex(p.hemiGround);
    this.lights.hemi.intensity = p.hemiInt;
    this.lights.sun.color.setHex(p.sunColor);
    this.lights.sun.intensity = p.sunInt;
    this.lights.amb.color.setHex(p.ambient);
    this.lights.amb.intensity = style === 'afterglow' ? 1.4 : 0;
    this.renderer.toneMappingExposure =
      p.exposure ?? (style === 'afterglow' ? 1.25 : TUNING.RENDER.EXPOSURE);

    for (const { mesh, role } of this.registry) this._material(mesh, role);
    if (this.grid) {
      this.grid.material.color.setHex(p.grid);
      this.grid.material.opacity = p.gridOpacity ?? 0.13;
    }
    this._setEdges(p.lines);
  }

  /** AFTERGLOW draws glowing edges over each solid; graybox hides them. */
  /**
   * Throw away a mesh's cached wireframe so it can be rebuilt.
   *
   * Edges are built once from the geometry and cached on the mesh, which is
   * right for a world that is built and then left alone. The car is not that:
   * its hull is regenerated whenever the player changes car, and without this
   * the neon pass would keep drawing the *previous* silhouette over the new
   * one — a ghost of the car you used to drive.
   */
  invalidateEdges(mesh) {
    const line = mesh.userData.__edge;
    if (!line) return;
    mesh.remove(line);
    line.geometry.dispose();
    line.material.dispose();
    this.edges = this.edges.filter((e) => e !== line);
    mesh.userData.__edge = null;
  }

  /** Rebuild the wireframe for meshes whose geometry has just been replaced. */
  restyle(meshes) {
    if (!this.style) return;
    const list = meshes || this.registry.map((r) => r.mesh);
    for (const mesh of list) {
      const entry = this.registry.find((r) => r.mesh === mesh);
      if (!entry) continue;
      this.invalidateEdges(mesh);
      this._material(mesh, entry.role);
      if (PALETTES[this.style].lines) this._edgesFor(mesh, entry.role, entry.opts);
    }
  }

  _edgesFor(mesh, role, opts = {}) {
    if (role === 'wheel' || role === 'traffic' || !mesh.geometry) return;
    if (mesh.isInstancedMesh) return;      // one wireframe per instance is not worth it
    if (mesh.userData.__edge) return;
    const p = PALETTES[this.style].roles[role];
    const edge = opts.edge ?? (p && p.edge);
    if (!edge) return;
    const line = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, opts.threshold ?? 24),
      new THREE.LineBasicMaterial({
        color: edge, transparent: true, opacity: opts.opacity ?? 1,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    line.raycast = () => {};
    mesh.add(line);
    mesh.userData.__edge = line;
    this.edges.push(line);
  }

  _setEdges(on) {
    // Build for anything registered since last time — arenas come and go.
    if (on) for (const { mesh, role, opts } of this.registry) this._edgesFor(mesh, role, opts);
    for (const e of this.edges) e.visible = !!on;
  }

  /** Livery paint: recolour one role without rebuilding materials (§7). */
  tint(role, hex) {
    this.tints = this.tints || {};
    this.tints[role] = hex;
    const mat = this.materials.get(this._key(role));
    // In AFTERGLOW the body stays near-black — identity is the trim, and a
    // bright livery would break the ≥85% dark-frame rule single-handedly.
    if (mat && this.style !== 'afterglow') mat.color.setHex(hex);
  }

  next() {
    const i = STYLES.indexOf(this.style);
    this.setStyle(STYLES[(i + 1) % STYLES.length]);
    return this.style;
  }

  /** The live palette object for the current style — the tuner edits this. */
  get palette() { return PALETTES[this.style]; }

  /**
   * Re-apply the atmosphere from the (possibly edited) palette, cheaply. Unlike
   * setStyle it does not re-materialise every mesh, so the visual tuner can
   * drive it on every slider frame without a hitch — fog, lights and exposure
   * only.
   */
  applyAtmosphere() {
    const p = this.palette;
    if (this.scene.fog) { this.scene.fog.color.setHex(p.fog); this.scene.fog.near = p.fogNear; this.scene.fog.far = p.fogFar; }
    if (this.scene.background && this.scene.background.setHex) this.scene.background.setHex(p.background);
    this.lights.hemi.color.setHex(p.hemiSky); this.lights.hemi.intensity = p.hemiInt;
    this.lights.sun.color.setHex(p.sunColor); this.lights.sun.intensity = p.sunInt;
    this.lights.amb.color.setHex(p.ambient);
    this.renderer.toneMappingExposure = p.exposure ?? (this.style === 'afterglow' ? 1.25 : TUNING.RENDER.EXPOSURE);
  }

  /**
   * The Low (Free Ride & The Low, cheap version): drive the atmosphere toward
   * disappearance by an amount 0..1. Distance fog-culls in and the lit
   * architecture dims, so at full Low only the car's own light and the traces in
   * the air stay legible. Read off the (possibly tuner-edited) palette base each
   * frame, so `amount = 0` is exactly the normal atmosphere — the caller can
   * drive it every frame without a separate reset. AFTERGLOW only; the graybox
   * diagnostic look is left flat.
   */
  applyLow(amount) {
    if (this.style !== 'afterglow') return;
    const p = this.palette;
    const L = TUNING.LOW;
    const a = amount < 0 ? 0 : amount > 1 ? 1 : amount;
    if (this.scene.fog) {
      this.scene.fog.near = p.fogNear * (1 - a * (1 - L.NEAR_MUL));
      this.scene.fog.far = p.fogFar * (1 - a * (1 - L.FAR_MUL));
    }
    const dim = 1 - a * (1 - L.LIGHT_MUL);
    this.lights.hemi.intensity = p.hemiInt * dim;
    this.lights.sun.intensity = p.sunInt * dim;
  }
}

export default ArtDirector;
