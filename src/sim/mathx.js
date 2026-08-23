/** Small vector/quaternion helpers. Plain objects so sim stays three.js-free. */

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
/** Frame-rate independent exponential approach. */
export const approach = (cur, target, rate, dt) => lerp(cur, target, 1 - Math.exp(-rate * dt));

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const len = (a) => Math.hypot(a.x, a.y, a.z);
export const len2 = (a) => a.x * a.x + a.y * a.y + a.z * a.z;
export function norm(a) {
  const l = len(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 };
}

/** Rotate vector v by quaternion q (x,y,z,w). */
export function qRot(q, v) {
  const { x, y, z, w } = q;
  const tx = 2 * (y * v.z - z * v.y);
  const ty = 2 * (z * v.x - x * v.z);
  const tz = 2 * (x * v.y - y * v.x);
  return {
    x: v.x + w * tx + (y * tz - z * ty),
    y: v.y + w * ty + (z * tx - x * tz),
    z: v.z + w * tz + (x * ty - y * tx),
  };
}

/** Quaternion product: applies b, then a. */
export function qMul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** Conjugate — inverse for unit quaternions. Rotates world → local. */
export const qConj = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
export const qInvRot = (q, v) => qRot(qConj(q), v);

/** Quaternion from axis+angle. */
export function qAxisAngle(axis, angle) {
  const a = norm(axis), h = angle * 0.5, s = Math.sin(h);
  return { x: a.x * s, y: a.y * s, z: a.z * s, w: Math.cos(h) };
}

/** Signed angle of `v` about `up`, measured from `ref`. */
export function signedAngle(ref, v, up) {
  const a = Math.atan2(dot(cross(ref, v), up), dot(ref, v));
  return a;
}

/** Deterministic RNG (mulberry32) — replays must not touch Math.random. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const LOCAL_FORWARD = Object.freeze({ x: 0, y: 0, z: -1 });
export const LOCAL_UP = Object.freeze({ x: 0, y: 1, z: 0 });
export const LOCAL_RIGHT = Object.freeze({ x: 1, y: 0, z: 0 });
export const WORLD_UP = Object.freeze({ x: 0, y: 1, z: 0 });
