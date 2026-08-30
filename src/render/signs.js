/**
 * Active billboards (R7's debt).
 *
 * AFTERGLOW's arena rule is that **billboards are the only bright objects,
 * because brightness is "land here" language.** Making them *active* is
 * therefore not a licence to animate them — an idling attract loop on every
 * sign would spend the arena's entire light budget saying nothing. It is a
 * licence to make them say the one thing they already mean, louder, at the
 * moment it is true.
 *
 * So a sign is bright in proportion to how much it currently is a landing
 * target for the car that is looking at it:
 *
 * - **Alignment.** It brightens as the car's flight lines up with it, and only
 *   while airborne. On the ground every sign in the city would qualify.
 * - **Range.** Nearest-first, over a band, so a rooftop hop lights the sign it
 *   could reach rather than the whole skyline.
 * - **The hit.** Landing on one punches it to WHITE-HOT and it decays back.
 *   That is the only moment a sign is allowed to be the brightest thing on
 *   screen, and it is the moment it earned it.
 *
 * The decision is a pure function so a probe can drive it, which is the same
 * rule R7 held its particles to.
 */

import * as THREE from 'three';
import TUNING from '../TUNING.js';
import { THEME, isReduced } from './theme.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * How bright one sign should be, 0..1.
 *
 * @param sign  { aim: {x,y,z} }
 * @param car   { position, velocity, airborne }
 * @param hit   seconds since this sign was landed on, or null
 */
export function signBrightness(sign, car, hit = null) {
  const S = TUNING.SIGNS;
  // The hit outranks everything: a sign somebody just stuck is the brightest
  // object in the arena for as long as the flash lasts, and photosensitivity
  // caps that at 120 ms of full white (the art brief's own number).
  if (hit !== null && hit < S.FLASH_TIME) {
    const f = 1 - hit / S.FLASH_TIME;
    return isReduced()
      ? { level: S.REDUCED_FLASH, flash: f * S.REDUCED_FLASH }
      : { level: 1, flash: f };
  }

  const live = isReduced() ? S.REDUCED_LIVE : S.LIVE;
  let level = S.IDLE;
  if (car && car.airborne) {
    const dx = sign.aim.x - car.position.x;
    const dy = sign.aim.y - car.position.y;
    const dz = sign.aim.z - car.position.z;
    const dist = Math.hypot(dx, dy, dz);
    const v = car.velocity;
    const speed = Math.hypot(v.x, v.y, v.z);
    if (dist > 1 && speed > 1) {
      // How much of the car's flight is aimed at this sign.
      const align = (dx * v.x + dy * v.y + dz * v.z) / (dist * speed);
      if (align > S.CONE) {
        const a = (align - S.CONE) / (1 - S.CONE);
        const near = 1 - clamp01((dist - S.NEAR) / (S.FAR - S.NEAR));
        level = S.IDLE + (live - S.IDLE) * clamp01(a * a * near);
      }
    }
  }
  return { level, flash: 0 };
}

/**
 * The lit faces of the arena's billboards, and the hit flash.
 *
 * One additive plane per sign, parented to nothing — the panels themselves are
 * ordinary structures the art director already draws, and this is the light
 * *coming off* them.
 */
export function buildSigns(scene, park) {
  const group = new THREE.Group();
  group.name = 'signs';
  scene.add(group);

  const signs = park.targets.filter((t) => t.tier === 'billboard' && t.tagged !== false);
  const faces = [];
  for (const t of signs) {
    const geo = new THREE.PlaneGeometry(t.half.x * 2 * 0.94, t.half.z * 2 * 0.86);
    const mat = new THREE.MeshBasicMaterial({
      color: THEME.PINK, transparent: true, opacity: TUNING.SIGNS.IDLE,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // Face up: these are landing surfaces, so the light that means "land here"
    // has to be visible from above.
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(t.aim.x, t.aim.y + 0.06, t.aim.z);
    group.add(mesh);
    faces.push({ target: t, mesh, mat, hit: null });
  }

  return {
    group, faces,

    /** A sign was landed on. */
    onLanding(targetId) {
      const f = faces.find((x) => x.target.id === targetId);
      if (f) f.hit = 0;
    },

    update(dt, car) {
      for (const f of faces) {
        if (f.hit !== null) {
          f.hit += dt;
          if (f.hit > TUNING.SIGNS.FLASH_TIME + TUNING.SIGNS.DECAY_TIME) f.hit = null;
        }
        const s = signBrightness(f.target, car, f.hit);
        f.mat.opacity = s.level;
        // WHITE-HOT for the flash, back to PINK as it cools.
        f.mat.color.setHex(s.flash > 0.5 ? THEME.WHITE_HOT : THEME.PINK);
      }
    },

    dispose() {
      scene.remove(group);
      for (const f of faces) { f.mesh.geometry.dispose(); f.mat.dispose(); }
      faces.length = 0;
    },
  };
}
