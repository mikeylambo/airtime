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

export const STYLES = ['graybox', 'neon', 'lowpoly'];

const PALETTES = {
  // The lit gray box §10 asks for: no colour decisions, just form and light.
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
  // Rush 2049's own arcade palette, pushed: black void, glowing edges.
  //
  // The fills have to be nearly black. Give the faces any real brightness and
  // they swallow the one-pixel edges completely and the whole thing reads as
  // flat blue plastic rather than wireframe.
  neon: {
    background: 0x03040a, fog: 0x03040a, fogNear: 140, fogFar: 820,
    hemiSky: 0x0a1226, hemiGround: 0x03040a, hemiInt: 0.35,
    sunColor: 0x86f2ff, sunInt: 0.55, ambient: 0x05070f,
    roles: {
      deck: { color: 0x02030a, rough: 1, emissive: 0x03060f },
      ramp: { color: 0x040719, emissive: 0x081026, edge: 0x49e0ff },
      roof: { color: 0x040617, emissive: 0x070e22, edge: 0x3ad6ff },
      billboard: { color: 0x0a0418, emissive: 0x180830, edge: 0xff3df0 },
      pool: { color: 0x02100f, emissive: 0x04201e, edge: 0x2bffd6 },
      secret: { color: 0x140802, emissive: 0x2c1604, edge: 0xffa521 },
      leg: { color: 0x03050e, emissive: 0x060a16, edge: 0x2a5f8a },
      // The car is the hero object; it gets to be brighter than the world.
      body: { color: 0x140823, emissive: 0x2e0d47, edge: 0xff2bd0 },
      panel: { color: 0x07222f, emissive: 0x0d4a63, edge: 0x49e0ff },
      wheel: { color: 0x03040a, emissive: 0x0d0418, edge: 0xa040ff },
      traffic: { color: 0x0a0416, emissive: 0x18062c, edge: 0xffd166 },
      glass: { color: 0x02040a, emissive: 0x041420, edge: 0x49e0ff },
    },
    grid: 0x2ea8dc, gridOpacity: 0.42, lines: true,
  },
  // Flat, saturated, unlit-looking — SSX Tricky by way of a paper model.
  lowpoly: {
    background: 0xf2e6cf, fog: 0xf2e6cf, fogNear: 320, fogFar: 1200,
    hemiSky: 0xffffff, hemiGround: 0xb08a5e, hemiInt: 1.15,
    sunColor: 0xffffff, sunInt: 1.45, ambient: 0x000000,
    roles: {
      deck: { color: 0x86b06a, rough: 1, flat: true },
      ramp: { color: 0xe86a4b, rough: 1, flat: true },
      roof: { color: 0x4f7fb5, rough: 1, flat: true },
      billboard: { color: 0xf2c14e, rough: 1, flat: true },
      pool: { color: 0x3fb7c9, rough: 1, flat: true },
      secret: { color: 0xb35bd0, rough: 1, flat: true },
      leg: { color: 0x6b5545, rough: 1, flat: true },
      body: { color: 0xf25c54, rough: 1, flat: true },
      panel: { color: 0x2d3142, rough: 1, flat: true },
      wheel: { color: 0x2e2b2a, rough: 1, flat: true },
      traffic: { color: 0x4a6fa5, rough: 1, flat: true },
      glass: { color: 0x8ecae6, rough: 1, flat: true },
    },
    grid: 0x2f4a22, gridOpacity: 0.10, lines: false,
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

  /** Every mesh declares what it is; the style decides what that looks like. */
  register(mesh, role) {
    this.registry.push({ mesh, role });
    if (this.style) {
      this._material(mesh, role);
      if (PALETTES[this.style].lines) this._edgesFor(mesh, role);
    }
    return mesh;
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
        color: (this.tints && this.tints[role] != null && this.style !== 'neon') ? this.tints[role] : spec.color,
        roughness: spec.rough ?? 0.9,
        metalness: spec.metal ?? 0.0,
        emissive: spec.emissive ?? 0x000000,
        emissiveIntensity: spec.emissive ? 1.0 : 0,
        // Neon draws the wireframe on top; without this the near faces of a
        // ramp hide the edges of everything behind them.
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
        flatShading: !!spec.flat || this.style === 'lowpoly',
      });
      this.materials.set(key, mat);
    }
    mesh.material = mat;
  }

  setStyle(style) {
    if (!STYLES.includes(style)) return;
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
    this.lights.amb.intensity = style === 'neon' ? 1.4 : 0;
    this.renderer.toneMappingExposure = style === 'neon' ? 1.25 : TUNING.RENDER.EXPOSURE;

    for (const { mesh, role } of this.registry) this._material(mesh, role);
    if (this.grid) {
      this.grid.material.color.setHex(p.grid);
      this.grid.material.opacity = p.gridOpacity ?? 0.13;
    }
    this._setEdges(p.lines);
  }

  /** Neon draws a glowing wireframe over each solid; the others hide them. */
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
      if (PALETTES[this.style].lines) this._edgesFor(mesh, entry.role);
    }
  }

  _edgesFor(mesh, role) {
    if (role === 'wheel' || role === 'traffic' || !mesh.geometry) return;
    if (mesh.isInstancedMesh) return;      // one wireframe per instance is not worth it
    if (mesh.userData.__edge) return;
    const p = PALETTES.neon.roles[role];
    if (!p || !p.edge) return;
    const line = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, 24),
      new THREE.LineBasicMaterial({
        color: p.edge, transparent: true, opacity: 1,
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
    if (on) for (const { mesh, role } of this.registry) this._edgesFor(mesh, role);
    for (const e of this.edges) e.visible = !!on;
  }

  /** Livery paint: recolour one role without rebuilding materials (§7). */
  tint(role, hex) {
    this.tints = this.tints || {};
    this.tints[role] = hex;
    const mat = this.materials.get(this._key(role));
    if (mat && this.style !== 'neon') mat.color.setHex(hex);
  }

  next() {
    const i = STYLES.indexOf(this.style);
    this.setStyle(STYLES[(i + 1) % STYLES.length]);
    return this.style;
  }
}

export default ArtDirector;
