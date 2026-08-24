/**
 * Arena meshes — built from the same park records the colliders come from
 * (src/arena/stunt-park.js), so what you see is what you hit.
 */

import * as THREE from 'three';
import TUNING from '../TUNING.js';
import { getArena, rampMesh } from '../arena/index.js';

const ROLE_FOR_KIND = {
  platform: 'roof', roof: 'roof', billboard: 'billboard',
  pool: 'pool', poolwall: 'pool', secret: 'secret', leg: 'leg',
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
    group.add(art.register(mesh, 'ramp'));
  }

  // ── Structures ──────────────────────────────────────────────────────────
  for (const s of park.structures) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.half.x * 2, s.half.y * 2, s.half.z * 2));
    mesh.position.set(s.pos.x, s.pos.y, s.pos.z);
    mesh.rotation.y = s.yaw;
    mesh.castShadow = true;
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
      new THREE.MeshBasicMaterial({ color: TIER_COLOR[t.tier] || 0xffffff, transparent: true, opacity: 0.5 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(t.aim.x, t.aim.y + 1.2, t.aim.z);
    ring.userData.tier = t.tier;
    markers.add(ring);
  }
  group.add(markers);
  group.userData.markers = markers;

  // ── Coins (§3.1) ────────────────────────────────────────────────────────
  const coinGeo = new THREE.TorusGeometry(1.5, 0.32, 8, 18);
  coinGeo.rotateY(Math.PI / 2);
  const coins = new THREE.InstancedMesh(
    coinGeo,
    new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0x8a5a00, emissiveIntensity: 1, roughness: 0.4 }),
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

  // ── Moving targets (§6.2) ───────────────────────────────────────────────
  const moverMeshes = new Map();
  const moverGroup = new THREE.Group();
  group.add(moverGroup);

  return {
    park, group, coins, moverGroup,

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

export const TIER_COLOR = {
  road: 0xffffff, rooftop: 0x59d0ff, billboard: 0xffd166,
  moving: 0xff8c42, pool: 0x2bffd6, secret: 0xff3df0,
};
