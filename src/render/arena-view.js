/**
 * Arena meshes — built from the same park records the colliders come from
 * (src/arena/stunt-park.js), so what you see is what you hit.
 */

import * as THREE from 'three';
import TUNING from '../TUNING.js';
import { getArena, rampMesh, rampExitAngle } from '../arena/index.js';
import { rampGradeColor, THEME, DRESSING } from './theme.js';
import { makeRng } from '../sim/mathx.js';

const ROLE_FOR_KIND = {
  platform: 'roof', roof: 'roof', billboard: 'billboard',
  pool: 'pool', poolwall: 'pool', secret: 'secret', leg: 'leg',
  // R12. A ceiling draws like a roof and lights nothing like one.
  ceiling: 'roof',
};

export function buildArenaView(scene, art, arenaId = 'park') {
  const park = getArena(arenaId);
  const group = new THREE.Group();
  group.name = 'arena';
  scene.add(group);

  // ── Deck ────────────────────────────────────────────────────────────────
  const size = park.ground || TUNING.ARENA.GROUND_SIZE;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(size, 4, size));
  deck.position.set(0, -2, 0);
  deck.receiveShadow = true;
  group.add(art.register(deck, 'deck'));

  // A grid so speed and distance read on an otherwise featureless plane.
  const grid = new THREE.GridHelper(size, Math.round(size / 20), 0x000000, 0x000000);
  grid.position.y = 0.02;
  grid.material.transparent = true;
  grid.material.opacity = 0.13;
  grid.material.depthWrite = false;
  // GridHelper bakes its centre-line colours into vertex colours, and while
  // vertexColors is on, material.color is ignored — so the art style could not
  // recolour the ground at all.
  grid.material.vertexColors = false;
  group.add(grid);
  group.userData.grid = grid;
  art.grid = grid;   // the grid is the ground in neon, so the style owns it

  // ── Ramps ───────────────────────────────────────────────────────────────
  for (const r of park.ramps) {
    const { vertices, indices } = rampMesh(r);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo);
    mesh.position.set(r.pos.x, r.pos.y, r.pos.z);
    mesh.rotation.y = r.yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = r.id;
    // AFTERGLOW: the edge-strip colour encodes the grade — how hard this
    // surface throws you — so the park reads as an instrument in the dark.
    group.add(art.register(mesh, 'ramp', { edge: rampGradeColor(rampExitAngle(r)) }));
  }

  // ── Structures ──────────────────────────────────────────────────────────
  for (const s of park.structures) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.half.x * 2, s.half.y * 2, s.half.z * 2));
    mesh.position.set(s.pos.x, s.pos.y, s.pos.z);
    mesh.rotation.y = s.yaw;
    // A ceiling is the one solid that must not cast: it is a lid over the
    // entire arena, so a single directional light puts the whole interior in
    // shadow and The Concourse rendered as a black frame — no columns, no
    // platforms, not even the edge lines. An interior is lit from inside it,
    // which in AFTERGLOW means lit by its own geometry.
    mesh.castShadow = s.kind !== 'ceiling';
    mesh.receiveShadow = true;
    mesh.name = s.id;
    group.add(art.register(mesh, ROLE_FOR_KIND[s.kind] || 'roof'));
  }

  // ── Target markers: a floating ring over every tagged landing target ─────
  // The camera locks onto these (§6), so the player has to be able to see
  // what it is framing.
  const markers = new THREE.Group();
  for (const t of park.targets) {
    if (t.tagged === false) continue;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(Math.min(t.half.x, t.half.z) * 0.55, 0.35, 8, 32),
      // Additive, so a marker reads as light on the target rather than a
      // plastic hoop floating over it — brightness is "land here" language.
      new THREE.MeshBasicMaterial({
        color: TIER_COLOR[t.tier] || 0xffffff, transparent: true, opacity: 0.4,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(t.aim.x, t.aim.y + 1.2, t.aim.z);
    ring.userData.tier = t.tier;
    // Each marker owns its material: the lens fade below is per ring.
    ring.material = ring.material.clone();
    markers.add(ring);
  }
  group.add(markers);
  group.userData.markers = markers;

  // ── Coins (§3.1) ────────────────────────────────────────────────────────
  // AFTERGLOW: "coins are small floating lights defining the authored lines
  // through the dark" — a light, not a pickup prop, and small on purpose.
  const coinGeo = new THREE.TorusGeometry(0.95, 0.2, 8, 18);
  coinGeo.rotateY(Math.PI / 2);
  const coins = new THREE.InstancedMesh(
    coinGeo,
    new THREE.MeshStandardMaterial({ color: 0xf4e9c8, emissive: 0xbfa25a, emissiveIntensity: 1, roughness: 0.4 }),
    Math.max(1, park.coins.length)
  );
  coins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  coins.frustumCulled = false;
  group.add(coins);

  const m4 = new THREE.Matrix4();
  const cq = new THREE.Quaternion();
  const cs = new THREE.Vector3(1, 1, 1);
  const cp = new THREE.Vector3();
  const hidden = new THREE.Vector3(0, -500, 0);

  // ── City windows (AFTERGLOW arena dressing) ─────────────────────────────
  // "A lightless city at night, windows sparse." A handful of lit windows on
  // the taller towers give the skyline depth without competing with the
  // billboards, which stay the only *bright* objects — brightness is "land
  // here" language, and a window is not an invitation.
  if (arenaId === 'city') {
    const rng = makeRng(0x71d0);
    const spots = [];                      // [x, y, z, yaw]
    for (const s of park.structures) {
      if (s.kind !== 'roof' || s.half.y < 6) continue;
      const floors = Math.floor(s.half.y / 2.2);
      for (let f = 1; f < floors; f++) {
        for (let side = 0; side < 4; side++) {
          if (rng() > DRESSING.WINDOW_FRACTION) continue;
          const y = s.pos.y - s.half.y + f * 2.2 + 1.1;
          const u = (rng() * 2 - 1) * 0.7;
          // Sides 0/1 are the ±x faces (pane yawed 90°), 2/3 the ±z faces.
          spots.push(side === 0 ? [s.pos.x + s.half.x + 0.05, y, s.pos.z + u * s.half.z, Math.PI / 2]
            : side === 1 ? [s.pos.x - s.half.x - 0.05, y, s.pos.z + u * s.half.z, Math.PI / 2]
            : side === 2 ? [s.pos.x + u * s.half.x, y, s.pos.z + s.half.z + 0.05, 0]
            : [s.pos.x + u * s.half.x, y, s.pos.z - s.half.z - 0.05, 0]);
        }
      }
    }
    const winGeo = new THREE.PlaneGeometry(1.1, 1.5);
    const windows = new THREE.InstancedMesh(
      winGeo,
      new THREE.MeshBasicMaterial({
        color: DRESSING.WINDOW, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
      Math.max(1, spots.length)
    );
    const wm = new THREE.Matrix4();
    const wq = new THREE.Quaternion();
    const ws = new THREE.Vector3(1, 1, 1);
    const wp = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    spots.forEach(([x, y, z, yaw], i) => {
      wq.setFromAxisAngle(up, yaw);
      wp.set(x, y, z);
      wm.compose(wp, wq, ws);
      windows.setMatrixAt(i, wm);
    });
    windows.count = spots.length;
    windows.instanceMatrix.needsUpdate = true;
    group.add(windows);
  }

  // ── Moving targets (§6.2) ───────────────────────────────────────────────
  const moverMeshes = new Map();
  const moverGroup = new THREE.Group();
  group.add(moverGroup);

  // ── Breakable props (R7) ────────────────────────────────────────────────
  // One instanced mesh for the lot. Seventy-eight bollards as seventy-eight
  // draw calls is a frame budget spent on street furniture, and the frame
  // budget belongs to the car.
  const propGroup = new THREE.Group();
  group.add(propGroup);
  const propMeshes = new Map();
  for (const kind of new Set(park.props.map((p) => p.kind || 'crate'))) {
    const of = park.props.filter((p) => (p.kind || 'crate') === kind);
    if (!of.length) continue;
    const h = of[0].half;
    const inst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(h.x * 2, h.y * 2, h.z * 2),
      new THREE.MeshStandardMaterial({ color: 0x14141d, emissive: 0x0b0b14, roughness: 0.95 }),
      of.length
    );
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.frustumCulled = false;
    // No shadows. Sixty-two boxes in the shadow pass, times four viewports,
    // to cast a dark shape onto a near-black street: `probe:perf` charged
    // most of a millisecond for it in the 4-way split and AFTERGLOW cannot
    // see the result.
    inst.castShadow = false;
    propGroup.add(inst);
    propMeshes.set(kind, { inst, ids: of.map((p) => p.id) });
  }
  const pm = new THREE.Matrix4();
  const pq = new THREE.Quaternion();
  const pp = new THREE.Vector3();
  const ps = new THREE.Vector3(1, 1, 1);

  return {
    park, group, coins, moverGroup,

    /** Props are kinematic until something hits them; then they are thrown. */
    syncProps(list) {
      if (!list || !list.length) return;
      const byId = new Map(list.map((p) => [p.id, p]));
      for (const { inst, ids } of propMeshes.values()) {
        for (let i = 0; i < ids.length; i++) {
          const p = byId.get(ids[i]);
          if (!p) continue;
          pp.set(p.x, p.y, p.z);
          pq.set(p.qx, p.qy, p.qz, p.qw);
          pm.compose(pp, pq, ps);
          inst.setMatrixAt(i, pm);
        }
        inst.instanceMatrix.needsUpdate = true;
      }
    },

    /** Spin the uncollected coins and hide the taken ones. */
    syncCoins(taken, t) {
      const list = park.coins;
      for (let i = 0; i < list.length; i++) {
        const gone = taken.has(list[i].id);
        cq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t * 1.6);
        cp.copy(gone ? hidden : list[i].pos);
        m4.compose(cp, cq, cs);
        coins.setMatrixAt(i, m4);
      }
      coins.count = list.length;
      coins.instanceMatrix.needsUpdate = true;
    },

    /**
     * Marker light dissolves at the lens, like the trails: a torus crossed
     * at arm's length reads as a screen-wide arc, and the camera flies
     * through these constantly (probe:dark caught it on the hero landing).
     */
    fadeMarkers(camPos) {
      for (const ring of markers.children) {
        const d = Math.hypot(ring.position.x - camPos.x, ring.position.y - camPos.y,
          ring.position.z - camPos.z);
        const k = Math.min(1, Math.max(0, (d - 4) / 14));
        ring.material.opacity = 0.4 * k;
      }
    },

    syncMovers(list) {
      for (const m of list) {
        let mesh = moverMeshes.get(m.id);
        if (!mesh) {
          mesh = new THREE.Mesh(new THREE.BoxGeometry(m.half.x * 2, m.half.y * 2, m.half.z * 2));
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          const role = m.kind === 'heli' ? 'secret' : m.kind === 'billboard' ? 'billboard' : 'roof';
          moverGroup.add(art.register(mesh, role));
          moverMeshes.set(m.id, mesh);
        }
        mesh.visible = m.active;
        mesh.position.set(m.x, m.y, m.z);
        mesh.rotation.y = m.yaw;
      }
    },
  };
}

// Tier markers speak THEME: what a target pays maps onto the palette's own
// value language — blue routine, pink dare, green pool, violet secret.
export const TIER_COLOR = {
  road: THEME.WHITE_HOT, rooftop: THEME.BLUE, billboard: THEME.PINK,
  moving: THEME.MAGENTA, pool: THEME.GREEN, secret: THEME.VIOLET,
};
