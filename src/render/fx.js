/**
 * Particles and screen effects (R7).
 *
 * "The world should look expensive because it's coherent and responsive, not
 * because every brick has an 8K texture." So none of this is detail — it is
 * *response*: smoke where the tyres are actually slipping, sparks where the
 * chassis is actually touching, debris weighted by the impact that caused it,
 * streaks that arrive with speed and leave with it.
 *
 * One pooled buffer for everything. A fixed-size THREE.Points with an additive
 * material costs one draw call and never allocates after construction, which
 * matters because the alternative — a mesh per spark — is exactly the kind of
 * thing that makes a web build stutter on the frame a crash happens.
 *
 * Particles live in world space and are never parented to the car: a spark
 * that inherits the chassis transform rotates with the wreck instead of being
 * left behind by it, and that reads as decoration rather than consequence.
 */

import * as THREE from 'three';
import TUNING from '../TUNING.js';

const KIND = { SMOKE: 0, SPARK: 1, DEBRIS: 2, DUST: 3, FLAME: 4 };

export class Fx {
  constructor(scene, art) {
    this.scene = scene;
    this.art = art;
    const N = TUNING.FX.MAX_PARTICLES;
    this.n = N;
    this.head = 0;

    // Flat arrays rather than objects: this loop runs over every live particle
    // every frame, and an array of little objects is how you get a garbage
    // collector pause in the middle of a landing.
    this.px = new Float32Array(N); this.py = new Float32Array(N); this.pz = new Float32Array(N);
    this.vx = new Float32Array(N); this.vy = new Float32Array(N); this.vz = new Float32Array(N);
    this.life = new Float32Array(N); this.max = new Float32Array(N);
    this.size0 = new Float32Array(N); this.grow = new Float32Array(N);
    this.kind = new Uint8Array(N);

    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 3);
    this.col = new Float32Array(N * 3);
    this.psize = new Float32Array(N);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.psize, 1));
    geo.setDrawRange(0, 0);

    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      // uScale converts a world-space radius into pixels at one metre of
      // depth: viewportHeight / (2 tan(fov/2)). Without it "size" is an
      // arbitrary number that happens to look right at one resolution, which
      // is how the first version ended up drawing two-pixel smoke.
      uniforms: { uScale: { value: 600 } },
      vertexShader: `
        attribute float size;
        varying vec3 vColor;
        uniform float uScale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(size * uScale / max(0.5, -mv.z), 1.0, 220.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          // Round, soft-edged sprite. No texture: a radial falloff computed in
          // the shader is cheaper than a texture fetch and never shows seams.
          vec2 d = gl_PointCoord - vec2(0.5);
          float r = dot(d, d);
          if (r > 0.25) discard;
          gl_FragColor = vec4(vColor, (1.0 - r * 4.0));
        }`,
      vertexColors: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.geo = geo;
    this.mat = mat;

    /** Called on resize: point size is in metres, so it needs the projection. */
    this.setViewport = (heightPx, fovDeg) => {
      mat.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    };

    this.smokeDebt = 0;
    this.flameDebt = 0;
    this.shake = 0;
  }

  /** Colours follow the art style, so particles never look bolted on. */
  _palette() {
    const style = this.art ? this.art.style : 'graybox';
    if (style === 'afterglow') {
      // Heat is PINK, impacts are BLUE-white, dust is dim violet — the smear
      // palette (render/theme.js), scaled down because additive stacks.
      return { smoke: [0.16, 0.14, 0.30], spark: [1.0, 0.43, 0.78], debris: [0.18, 0.60, 1.0],
               dust: [0.22, 0.18, 0.38], flame: [1.0, 0.43, 0.78] };
    }
    return { smoke: [0.55, 0.58, 0.62], spark: [1.0, 0.75, 0.35], debris: [0.6, 0.62, 0.66],
             dust: [0.6, 0.58, 0.54], flame: [1.0, 0.55, 0.25] };
  }

  _spawn(kind, x, y, z, vx, vy, vz, life, size, grow) {
    const i = this.head;
    this.head = (this.head + 1) % this.n;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.max[i] = life;
    this.size0[i] = size; this.grow[i] = grow;
    this.kind[i] = kind;
  }

  /** Tyre smoke, emitted at a rate rather than as a burst. */
  smoke(dt, pos, amount, rand) {
    const F = TUNING.FX;
    this.smokeDebt += amount * F.SMOKE_RATE * dt;
    while (this.smokeDebt >= 1) {
      this.smokeDebt -= 1;
      this._spawn(KIND.SMOKE,
        pos.x + (rand() - 0.5) * 1.6, pos.y + 0.1, pos.z + (rand() - 0.5) * 1.6,
        (rand() - 0.5) * 2.2, 0.7 + rand() * 1.4, (rand() - 0.5) * 2.2,
        F.SMOKE_LIFE * (0.7 + rand() * 0.6), 0.55, 2.6);
    }
  }

  /** Thrust plume, likewise continuous. */
  flame(dt, pos, back, amount, rand) {
    const F = TUNING.FX;
    this.flameDebt += amount * F.FLAME_RATE * dt;
    while (this.flameDebt >= 1) {
      this.flameDebt -= 1;
      this._spawn(KIND.FLAME,
        pos.x + back.x * 2.0, pos.y - 0.2, pos.z + back.z * 2.0,
        back.x * (14 + rand() * 10) + (rand() - 0.5) * 3,
        (rand() - 0.5) * 3,
        back.z * (14 + rand() * 10) + (rand() - 0.5) * 3,
        F.FLAME_LIFE * (0.5 + rand() * 0.7), 0.75, -0.5);
    }
  }

  /** Metal on concrete. */
  sparks(pos, dir, count, rand) {
    for (let i = 0; i < count; i++) {
      this._spawn(KIND.SPARK,
        pos.x, pos.y, pos.z,
        dir.x * (4 + rand() * 16) + (rand() - 0.5) * 14,
        2 + rand() * 9,
        dir.z * (4 + rand() * 16) + (rand() - 0.5) * 14,
        TUNING.FX.SPARK_LIFE * (0.4 + rand() * 0.9), 0.22, -0.14);
    }
  }

  /** A crash: the car sheds itself. */
  debris(pos, vel, severity, rand) {
    const F = TUNING.FX;
    const n = Math.round(F.DEBRIS_MIN + severity * (F.DEBRIS_MAX - F.DEBRIS_MIN));
    for (let i = 0; i < n; i++) {
      this._spawn(KIND.DEBRIS,
        pos.x + (rand() - 0.5) * 2, pos.y + rand() * 1.4, pos.z + (rand() - 0.5) * 2,
        vel.x * 0.35 + (rand() - 0.5) * 22,
        3 + rand() * 12,
        vel.z * 0.35 + (rand() - 0.5) * 22,
        F.DEBRIS_LIFE * (0.6 + rand() * 0.8), 0.42, -0.18);
    }
    this.sparks(pos, { x: 0, z: 0 }, Math.round(10 + severity * 26), rand);
  }

  /** The puff a landing pushes out from under the car. */
  landingDust(pos, severity, rand) {
    const n = Math.round(6 + severity * 22);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const s = 5 + rand() * 16 * severity;
      this._spawn(KIND.DUST,
        pos.x, pos.y - 0.3, pos.z,
        Math.cos(a) * s, 0.5 + rand() * 2.5, Math.sin(a) * s,
        TUNING.FX.DUST_LIFE * (0.6 + rand() * 0.7), 0.7, 3.2);
    }
  }

  /**
   * Camera shake. Deliberately the only screen effect this owns — the crash
   * slow-motion already lives on the camera director (CAMERA.CRASH_SLOWMO),
   * and two systems each holding their own opinion about world time is how
   * you end up with a slow-motion that half works.
   */
  impulse(severity) { this.shake = Math.min(1, this.shake + severity); }

  /**
   * Everything continuous, decided from a sim snapshot rather than from the
   * render loop. Keeping the *decision* here — rather than in main.js next to
   * the draw call — is what lets `npm run probe:fx` drive real runs through
   * this in node and check that smoke turns up where the tyres actually slip
   * and nowhere else.
   */
  emit(dt, state, rand) {
    const F = TUNING.FX;
    const slip = state.slipAngle || 0;
    const speed = state.groundSpeed || 0;
    if (!state.airborne && slip > F.SLIP_THRESHOLD) {
      const amount = Math.min(1, (slip - F.SLIP_THRESHOLD) / 0.5) * Math.min(1, speed / 18);
      this.smoke(dt, state.position, amount, rand);
    }
    // Chassis on the deck with nothing under the wheels: that is a scrape.
    if (!state.airborne && state.wheelsInContact === 0 && speed > 6) {
      this.sparks(state.position, { x: state.forward.x, z: state.forward.z }, F.SCRAPE_SPARKS, rand);
    }
    if (state.thrustActive) {
      this.flame(dt, state.position, { x: -state.forward.x, z: -state.forward.z }, 1, rand);
    }
  }

  /** Everything discrete, from the same event stream the audio hears. */
  onEvent(e, car, rand) {
    const F = TUNING.FX;
    const p = car.position;
    if (e.type === 'landed') {
      const impact = e.landing ? (e.landing.impactVel || 0) : 0;
      const severity = Math.min(1, impact / F.LANDING_SHAKE);
      if (e.result && !e.result.landed) {
        this.debris(p, car.linvel, Math.max(0.45, severity), rand);
        this.impulse(0.85);
      } else if (e.landing && e.landing.counted) {
        this.landingDust(p, Math.max(0.2, severity), rand);
        this.impulse(severity * 0.7);
      }
    } else if (e.type === 'tearoff') {
      this.debris(p, car.linvel, 0.35, rand);
      this.sparks(p, { x: 0, z: 0 }, 14, rand);
      this.impulse(0.3);
    } else if (e.type === 'launch' && e.launch.armed) {
      this.landingDust(p, 0.25, rand);
    }
  }

  update(dt) {
    const F = TUNING.FX;
    const g = TUNING.SIM.GRAVITY;
    const pal = this._palette();
    const cols = [pal.smoke, pal.spark, pal.debris, pal.dust, pal.flame];

    this.shake = Math.max(0, this.shake - dt / F.SHAKE_DECAY);

    let live = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;

      const k = this.kind[i];
      // Smoke and dust float and are dragged; sparks and debris fall.
      if (k === KIND.SMOKE || k === KIND.DUST) {
        const drag = Math.exp(-dt * 1.9);
        this.vx[i] *= drag; this.vz[i] *= drag;
        this.vy[i] = this.vy[i] * drag + 0.9 * dt;
      } else if (k === KIND.FLAME) {
        const drag = Math.exp(-dt * 5.0);
        this.vx[i] *= drag; this.vy[i] *= drag; this.vz[i] *= drag;
      } else {
        this.vy[i] += g * dt;
        if (this.py[i] < 0.15 && this.vy[i] < 0) { this.vy[i] *= -0.35; this.py[i] = 0.15; }
      }
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;

      const age = 1 - this.life[i] / this.max[i];
      const fade = 1 - age;
      const c = cols[k];
      const o = live * 3;
      this.pos[o] = this.px[i]; this.pos[o + 1] = this.py[i]; this.pos[o + 2] = this.pz[i];
      // Brightness carries the fade, because additive blending ignores alpha
      // for anything that is already bright.
      this.col[o] = c[0] * fade; this.col[o + 1] = c[1] * fade; this.col[o + 2] = c[2] * fade;
      this.psize[live] = Math.max(0.02, this.size0[i] + this.grow[i] * age);
      live++;
    }

    this.geo.setDrawRange(0, live);
    if (live) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
      this.geo.attributes.size.needsUpdate = true;
    }
    this.live = live;
    return live;
  }

  dispose() {
    this.scene.remove(this.points);
    this.geo.dispose();
    this.mat.dispose();
  }
}

export default Fx;
