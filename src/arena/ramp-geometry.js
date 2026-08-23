/**
 * Ramp geometry — one surface definition, used by physics and by render.
 *
 * Every ramp is described by a surface height function y(z) over a z range.
 * Physics builds a chain of *convex* slabs from it; render builds a mesh from
 * the same samples, so the ramp you see is exactly the ramp you hit.
 *
 * Convex slabs rather than one trimesh, deliberately. A concave trimesh gives
 * Rapier no reliable inside/outside, so a chassis that penetrates it at 60 m/s
 * can be resolved against the wrong face and fired backwards — which is
 * precisely what the headless probe caught. Convex pieces cannot do that.
 * Adjacent slabs share their edge samples exactly, so the surface stays
 * continuous with no steps to trip over.
 */

/** @returns {{zMin, zMax, y:(z:number)=>number, segments:number}} */
export function rampSurface(r) {
  if (r.kind === 'quarterpipe') {
    const R = r.radius;
    return {
      zMin: -R, zMax: 0, segments: 24,
      y: (z) => R - Math.sqrt(Math.max(0, R * R - z * z)),
    };
  }
  const h = r.length / 2;
  if (r.kind === 'kicker') {
    // Curved transition into a *straight* lip, the way a real kicker is built.
    // A purely quadratic face is still curving at the moment the car leaves it,
    // so it hands over ~100 deg/s of pitch and every neutral jump becomes an
    // uncontrolled backflip that lands on its roof. The straight section adds
    // no rotation and gives the suspension time to settle, so the car leaves
    // flat and any spin after that is the player's doing.
    const L = r.length;
    const lipFrac = r.lipFrac ?? 0.38;
    const slope = Math.tan(r.exitAngle ?? Math.PI / 6);
    const uT = 1 - lipFrac;                       // u where the lip begins
    const A = (slope * L) / (2 * uT);             // quadratic coefficient
    const yT = A * uT * uT;
    return {
      zMin: -h, zMax: h, segments: 22,
      y: (z) => {
        const u = (h - z) / L;                    // 0 at the toe, 1 at the lip
        return u <= uT ? A * u * u : yT + slope * L * (u - uT);
      },
    };
  }
  // wedge — exactly linear, so one slab is exact
  return {
    zMin: -h, zMax: h, segments: 1,
    y: (z) => (r.height * (h - z)) / r.length,
  };
}

/** Convex slab point clouds for the physics world. */
export function rampSlabs(r) {
  const s = rampSurface(r);
  const w = r.halfWidth;
  const out = [];
  const step = (s.zMax - s.zMin) / s.segments;

  for (let i = 0; i < s.segments; i++) {
    const z0 = s.zMin + step * i;
    const z1 = z0 + step;
    const y0 = s.y(z0);
    const y1 = s.y(z1);
    if (y0 < 1e-4 && y1 < 1e-4) continue;      // no volume, nothing to collide
    out.push(new Float32Array([
      -w, 0, z0, w, 0, z0, -w, 0, z1, w, 0, z1,
      -w, y0, z0, w, y0, z0, -w, y1, z1, w, y1, z1,
    ]));
  }
  return out;
}

/** The same surface as a render mesh: profile polygon extruded along ±X. */
export function rampMesh(r) {
  const s = rampSurface(r);
  const w = r.halfWidth;
  const step = (s.zMax - s.zMin) / s.segments;

  // Bottom edge, then up the back face, then the surface back down to the toe.
  const profile = [{ y: 0, z: s.zMax }, { y: 0, z: s.zMin }];
  for (let i = 0; i < s.segments; i++) {
    const z = s.zMin + step * i;
    profile.push({ y: s.y(z), z });
  }
  return extrudePrism(profile, w);
}

export function rampLipHeight(r) {
  const s = rampSurface(r);
  return s.y(s.zMin);
}

/** Exit slope of the ramp at its lip, in radians — how steeply it throws you. */
export function rampExitAngle(r) {
  const s = rampSurface(r);
  const e = (s.zMax - s.zMin) / 400;
  return Math.atan2(s.y(s.zMin) - s.y(s.zMin + e), e);
}

// ── Generic prism extrusion (render only) ──────────────────────────────────

/** Signed area ×2 of a profile polygon in the (z, y) plane. Positive = CCW. */
function signedArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    a += p.z * q.y - q.z * p.y;
  }
  return a;
}

const triArea2 = (a, b, c) => (b.z - a.z) * (c.y - a.y) - (b.y - a.y) * (c.z - a.z);

function pointInTri(p, a, b, c) {
  const d1 = triArea2(p, a, b), d2 = triArea2(p, b, c), d3 = triArea2(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** Ear clipping — the kicker and quarter-pipe profiles are concave, so a fan
 *  silently produces inverted triangles that collide in ways you cannot see. */
export function triangulate(poly) {
  const n = poly.length;
  if (n < 3) return [];
  const idx = [...Array(n).keys()];
  if (signedArea(poly) < 0) idx.reverse();
  const out = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n + 16) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length];
      const ib = idx[i];
      const ic = idx[(i + 1) % idx.length];
      const a = poly[ia], b = poly[ib], c = poly[ic];
      if (triArea2(a, b, c) <= 0) continue;
      let hit = false;
      for (const k of idx) {
        if (k === ia || k === ib || k === ic) continue;
        if (pointInTri(poly[k], a, b, c)) { hit = true; break; }
      }
      if (hit) continue;
      out.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

export function extrudePrism(profile, halfWidth) {
  const n = profile.length;
  const verts = [];
  for (const p of profile) verts.push(-halfWidth, p.y, p.z);
  for (const p of profile) verts.push(halfWidth, p.y, p.z);

  const loop = [...Array(n).keys()];
  if (signedArea(profile) < 0) loop.reverse();

  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    idx.push(a, b, n + b, a, n + b, n + a);
  }
  for (const [a, b, c] of triangulate(profile)) {
    idx.push(a, c, b);
    idx.push(n + a, n + b, n + c);
  }

  const vertices = new Float32Array(verts);
  const indices = new Uint32Array(idx);
  faceOutward(vertices, indices);
  return { vertices, indices };
}

/**
 * Orients a closed mesh so its faces point outward, using signed volume.
 *
 * The sides and both caps are already wound consistently with each other; the
 * only open question is whether that consistent winding is inside-out, and the
 * signed volume of a closed mesh answers it exactly.
 *
 * A "does this face point away from the centroid" test looks equivalent and is
 * not — it is only valid for convex shapes, and it flips the entire ramp
 * surface of a kicker, which is concave. That mistake renders every ramp in
 * the park pitch black, lit from inside.
 */
function faceOutward(vertices, indices) {
  let vol = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ax = vertices[a], ay = vertices[a + 1], az = vertices[a + 2];
    const bx = vertices[b], by = vertices[b + 1], bz = vertices[b + 2];
    const cx = vertices[c], cy = vertices[c + 1], cz = vertices[c + 2];
    vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  if (vol >= 0) return;
  for (let t = 0; t < indices.length; t += 3) {
    const tmp = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = tmp;
  }
}
