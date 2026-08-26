/**
 * The wedge generator — AIRTIME's cars, built from their own physics.
 *
 * The car was a box for four builds because the physics was the thing that
 * needed proving. It does not need to stay one: the wedge language of the late
 * exotics is all straight lines and flat planes, which makes it the *cheapest*
 * car we could possibly draw. Curvature is the expensive thing, and there is
 * none here.
 *
 * It also happens to be what our two existing looks want. The neon style works
 * by drawing edges, and an angular body generates clean ones; a curved body
 * gives you either no edges under smooth shading or a mess of triangulation
 * seams. Graybox wants flat-shaded hard normals, which is the same request.
 *
 * The important idea is that **nothing here is authored per car**. Every
 * proportion is derived from numbers the simulation already holds — chassis
 * half-extents, wheelbase, track — so the silhouettes come out *true*: the long
 * car looks like an arrow because it is one, and the roll car looks narrow
 * because narrowness is literally why it rolls (roll inertia falls out of the
 * box formula as width). A player can read a car's behaviour off its stance
 * before they have driven it.
 *
 * Design language only. The low nose, cab-forward glasshouse, chopped tail and
 * flat deck are fifty years old and shared across a dozen marques; no specific
 * car's proportions or lamp signature is being reproduced, which is the same
 * clean-room discipline the rest of this project runs on.
 */

import * as THREE from 'three';

/**
 * One cross-section of the body, in the car's local frame.
 *
 * Each ring is six points: floor corners, shoulder corners, roof corners. Six
 * is the fewest that can express a wedge — a flat floor, angled sills, a
 * tumblehome shoulder and a flat deck — and lofting rings with a matching point
 * count means the whole body is one triangle strip with no seams to reconcile.
 *
 *   z       position along the length, -1 nose .. +1 tail
 *   floorW  half-width at the floor line
 *   midW    half-width at the shoulder (the widest part of a wedge)
 *   topW    half-width at the deck
 *   floorY  floor height
 *   midY    shoulder height
 *   topY    deck height
 */
function ring(z, floorW, midW, topW, floorY, midY, topY) {
  return { z, floorW, midW, topW, floorY, midY, topY };
}

function ringPoints(r) {
  return [
    [-r.floorW, r.floorY], [-r.midW, r.midY], [-r.topW, r.topY],
    [r.topW, r.topY], [r.midW, r.midY], [r.floorW, r.floorY],
  ];
}

/** Loft a list of rings into a closed, flat-shaded hull. */
function loft(rings, { capFront = true, capBack = true } = {}) {
  const pos = [];
  const tri = (a, b, c) => { pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); };
  const at = (r, i) => { const p = ringPoints(r)[i]; return [p[0], p[1], r.z]; };
  const N = 6;

  for (let s = 0; s < rings.length - 1; s++) {
    const a = rings[s], b = rings[s + 1];
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      // Wound so the outward face is the visible one on both sides of the car.
      tri(at(a, i), at(b, i), at(b, j));
      tri(at(a, i), at(b, j), at(a, j));
    }
  }

  // End caps as fans from the ring centroid — a wedge is chopped at both ends,
  // and an open hull reads as a hole the moment the car is upside down.
  const cap = (r, flip) => {
    const pts = ringPoints(r);
    const cx = 0, cy = pts.reduce((s, p) => s + p[1], 0) / N;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const a = [cx, cy, r.z], b = [pts[i][0], pts[i][1], r.z], c = [pts[j][0], pts[j][1], r.z];
      if (flip) tri(a, c, b); else tri(a, b, c);
    }
  };
  if (capFront) cap(rings[0], true);
  if (capBack) cap(rings[rings.length - 1], false);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Build a car's body, glasshouse and engine cover from its physical dimensions.
 *
 * @param half   chassis half-extents (metres) — the collider the sim actually uses
 * @param wheel  { halfTrack, frontZ, rearZ } — where the wheels really are
 */
export function buildWedgeBody(half, wheel) {
  const L = half.z, W = half.x, H = half.y;

  // Proportions read off the car rather than chosen. A long-wheelbase car gets
  // a longer deck and a shallower screen; a short one gets a steep screen and a
  // cab pushed right to the nose, which is how the real shapes work.
  const wb = wheel ? Math.abs(wheel.rearZ - wheel.frontZ) / (2 * L) : 0.79;
  const stance = wheel ? wheel.halfTrack / W : 0.97;

  // The visual hull overhangs the collider at both ends. A wedge is mostly
  // overhang — the collider is 3.9 m and the shape wants to be nearer 4.5 —
  // and a body that stops exactly where the physics box stops looks stubby.
  // Nothing here touches the collider, so the car still hits what it hit.
  const noseZ = -L * 1.17, tailZ = L * 1.10;

  // The visual floor hangs well below the collider. A wedge exotic is close to
  // the ground; the collider is a 0.76 m tall box sitting on 0.92 m wheels with
  // half a metre of daylight under it, and a body drawn to the collider reads
  // as a buggy. Nothing here collides, so the shape can have the ride height
  // the car is supposed to look like it has.
  // The defining feature of a wedge is not the pointed nose — it is the
  // **rising beltline**: a shoulder that climbs continuously from a nose almost
  // on the floor to a deck at full height, then stops dead at a chopped tail.
  // The first two passes had a nose cone on a constant-height slab, which is
  // why they read as a truck with a snout.
  // How low the body can be drawn is set by where the car actually sits, not by
  // the collider. At rest the chassis centre is roughly 0.9 m above the contact
  // patch and the collider's underside is 0.5 m up — so a body drawn to the
  // collider floats half a metre off the road on stilts. Dropping the visual
  // floor to here leaves about 0.2 m of daylight, which is what a low car looks
  // like, and still clears the deck everywhere but the sharpest transitions.
  const floor = -H * 1.70;     // visual only; the collider is still +/- H
  const sill = -H * 0.26;

  const frontHip = wheel ? wheel.frontZ / L : -0.81;
  const rearHip = wheel ? wheel.rearZ / L : 0.78;
  const hipW = W * 1.20 * stance;

  // Shoulder height at each station, climbing nose to tail.
  const belt = (t) => H * t;

  const body = loft([
    ring(noseZ, W * 0.25, W * 0.32, W * 0.25, -H * 0.79, -H * 0.63, -H * 0.53),
    ring(-L * 0.99, W * 0.52, W * 0.76, W * 0.61, -H * 1.35, -H * 0.66, -H * 0.37),
    ring(L * frontHip, W * 0.82, hipW, W * 0.95, floor, -H * 0.50, belt(0.00)),
    ring(-L * 0.34, W * 0.76, W * 1.01, W * 0.97, floor, -H * 0.34, belt(0.32)),
    ring(L * 0.10, W * 0.78, W * 1.01, W * 0.99, floor, -H * 0.30, belt(0.68)),
    ring(L * rearHip, W * 0.86, hipW, W * 1.01, floor * 0.94, -H * 0.34, belt(0.87)),
    ring(L * 0.97, W * 0.84, W * 1.02, W * 0.97, -H * 1.30, -H * 0.40, belt(0.78)),
    ring(tailZ, W * 0.70, W * 0.88, W * 0.82, -H * 0.86, -H * 0.60, belt(0.52)),
  ]);

  // The glasshouse. Cab-forward, steeply raked, and clearly proud of the deck —
  // it has to be its own volume or the car has no cabin, just a lid.
  const roof = H * (1.45 + (1 - wb) * 0.30);
  const screenZ = -L * (0.30 - wb * 0.04);
  const canopy = loft([
    ring(screenZ, W * 0.46, W * 0.50, W * 0.23, -H * 0.20, H * 0.05, H * 0.42),
    ring(screenZ + L * 0.26, W * 0.60, W * 0.64, W * 0.44, -H * 0.16, H * 0.28, roof),
    ring(screenZ + L * 0.56, W * 0.60, W * 0.64, W * 0.42, -H * 0.16, H * 0.28, roof - H * 0.06),
    ring(L * rearHip, W * 0.44, W * 0.48, W * 0.17, -H * 0.20, H * 0.02, H * 0.90),
  ]);

  // Glass engine cover on the rear deck. Pure theatre, and the single most
  // "this cost too much" detail available for eight triangles.
  const cover = loft([
    ring(L * (rearHip + 0.06), W * 0.44, W * 0.52, W * 0.38, H * 0.70, H * 0.80, H * 0.94),
    ring(L * 0.95, W * 0.40, W * 0.48, W * 0.34, H * 0.62, H * 0.72, H * 0.86),
  ]);

  // Sill blades along the flanks: a hard horizontal line low on the body, which
  // is what tells you which way is up when the car is inverted at 30 m/s.
  const blades = [];
  for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(W * 0.09, H * 0.34, L * (rearHip - frontHip) * 0.86);
    g.translate(s * W * 1.02 * stance, -H * 1.52, L * (frontHip + rearHip) * 0.5);
    blades.push(g);
  }

  return { body, canopy, cover, blades, stance };
}

/**
 * An aero surface: a tapered plate rather than a slab.
 *
 * The panels are the one place the fiction and the physics meet on screen —
 * these are the rigid bodies the air is actually pushing on, so their meshes
 * follow the simulation exactly. Only the silhouette changes: a wing looks like
 * a wing, a diffuser like a diffuser, and none of them looks like a door off a
 * saloon.
 */
export function buildAeroPlate(size, kind) {
  // The drawn surface is deliberately smaller than the collider it rides on.
  //
  // The panel sizes in TUNING are *aerodynamic* areas — they are what makes a
  // door roll the car and both doors brake it, and probe-aero gates all six of
  // those claims — so they cannot be reduced. But against a 0.64 m tall body
  // they draw as scaffolding: a hood plate 1.7 m wide and 1.6 m long, hinged
  // above the deck, is most of what you see. Drawing them at their real size
  // was the whole reason the first pass looked like a van with flaps.
  //
  // So the mesh is a scaled-down, tapered version of the same surface, centred
  // on the same point and moving with the same rigid body. What swings is still
  // exactly what the air is pushing on; it simply is not drawn at the size of
  // the maths.
  const shrink = {
    door: { x: 1.0, y: 0.38, z: 0.72 },
    splitter: { x: 0.70, y: 0.7, z: 0.44 },
    diffuser: { x: 0.80, y: 1.0, z: 0.58 },
    wing: { x: 0.92, y: 1.0, z: 0.85 },
  }[kind] || { x: 1, y: 1, z: 1 };
  const x = size.x * shrink.x, y = size.y * shrink.y, z = size.z * shrink.z;
  // A cosmetic offset within the panel's own frame. The hinge positions are the
  // simulation's and cannot move — the hood's is 0.44 m up, which is above the
  // bonnet line of a low car, so drawn on centre it hovers over the nose like a
  // serving tray. Shifting the mesh down inside the rigid body puts it on the
  // bodywork; it still rotates with the hinge, because it is still bolted to it.
  const lift = { splitter: -0.38, diffuser: 0.08, wing: 0.02, door: 0 }[kind] || 0;
  const taperFor = { door: 0.55, wing: 1.0, splitter: 0.72, diffuser: 0.64 };
  const t = taperFor[kind] ?? 0.8;

  // Two rings: the rooted end at full size, the free end tapered.
  const rings = [
    ring(-z, x, x, x, lift - y, lift, lift + y),
    ring(z, x * t, x * t, x * t, lift - y * t, lift, lift + y * t),
  ];
  const geo = loft(rings);

  // Wings get an endplate at each tip — the detail that reads as *aero* rather
  // than as a plank, and it costs four triangles.
  if (kind === 'wing') {
    const parts = [geo];
    for (const s of [-1, 1]) {
      const p = new THREE.BoxGeometry(x * 0.12, y * 6, z * 1.8);
      p.translate(s * x * 0.92, lift + y * 1.4, 0);
      parts.push(p);
    }
    return mergeGeometries(parts);
  }
  return geo;
}

/** Minimal geometry merge — everything here is non-indexed position-only. */
function mergeGeometries(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count * 3;
  const pos = new Float32Array(n);
  let o = 0;
  for (const g of list) {
    const a = g.attributes.position.array;
    pos.set(a, o);
    o += a.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}

/** Which aero surface each panel slot is, under the active-aero reading. */
export const PANEL_KIND = {
  DOOR_L: 'door', DOOR_R: 'door',
  HOOD: 'splitter', TRUNK: 'diffuser', SPOILER: 'wing',
};

export default buildWedgeBody;
