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
      glass: { color: 0x3b444d, rough: 0.25, metal: 0.5 },
    },
    grid: 0x5b636b, lines: false,
  },
  // Rush 2049's own arcade palette, pushed: black void, glowing edges.
  neon: {
    background: 0x05060c, fog: 0x05060c, fogNear: 120, fogFar: 780,
    hemiSky: 0x1a2440, hemiGround: 0x05060c, hemiInt: 0.5,
    sunColor: 0x86f2ff, sunInt: 0.9, ambient: 0x0a1020,
    roles: {
      deck: { color: 0x0a1020, rough: 1, emissive: 0x0a1a2e },
      ramp: { color: 0x0d1430, emissive: 0x1b2f7a, edge: 0x49e0ff },
      roof: { color: 0x0c1226, emissive: 0x152a5c, edge: 0x3ad6ff },
      billboard: { color: 0x120a26, emissive: 0x3d1268, edge: 0xff3df0 },
      pool: { color: 0x061a1c, emissive: 0x0a4a4a, edge: 0x2bffd6 },
      secret: { color: 0x241004, emissive: 0x7a3c05, edge: 0xffa521 },
      leg: { color: 0x080c18, emissive: 0x101a30, edge: 0x2a5f8a },
      body: { color: 0x0c0f1c, emissive: 0x1d1030, edge: 0xff2bd0 },
      panel: { color: 0x0c0f1c, emissive: 0x102030, edge: 0x49e0ff },
      wheel: { color: 0x05060c, emissive: 0x1a0a2e, edge: 0xa040ff },
      glass: { color: 0x03050a, emissive: 0x0a2030, edge: 0x49e0ff },
    },
    grid: 0x1b3a6b, lines: true,
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
      glass: { color: 0x8ecae6, rough: 1, flat: true },
    },
    grid: 0x6b8f55, lines: false,
  },
};

export class ArtDirector {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.style = null;
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
    if (this.style) this._material(mesh, role);
    return mesh;
  }

  _key(role) { return `${this.style}:${role}`; }

  _material(mesh, role) {
    const p = PALETTES[this.style];
    const spec = p.roles[role] || p.roles.deck;
    const key = this._key(role);
    let mat = this.materials.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color: spec.color,
        roughness: spec.rough ?? 0.9,
        metalness: spec.metal ?? 0.0,
        emissive: spec.emissive ?? 0x000000,
        emissiveIntensity: spec.emissive ? 1.0 : 0,
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
    this._setEdges(p.lines);
  }

  /** Neon draws a glowing wireframe over each solid; the others hide them. */
  _setEdges(on) {
    if (on && this.edges.length === 0) {
      for (const { mesh, role } of this.registry) {
        if (role === 'wheel' || !mesh.geometry) continue;
        const p = PALETTES.neon.roles[role];
        if (!p || !p.edge) continue;
        const line = new THREE.LineSegments(
          new THREE.EdgesGeometry(mesh.geometry, 24),
          new THREE.LineBasicMaterial({ color: p.edge, transparent: true, opacity: 0.95 })
        );
        line.raycast = () => {};
        mesh.add(line);
        this.edges.push(line);
      }
    }
    for (const e of this.edges) e.visible = !!on;
  }

  next() {
    const i = STYLES.indexOf(this.style);
    this.setStyle(STYLES[(i + 1) % STYLES.length]);
    return this.style;
  }
}

export default ArtDirector;
