/**
 * Traffic meshes — instanced, because §4 wants a road full of them and every
 * one is the same box.
 */

import * as THREE from 'three';
import TUNING from '../TUNING.js';

export function buildTrafficView(scene, art) {
  const T = TUNING.TRAFFIC;
  const geo = new THREE.BoxGeometry(T.HALF.x * 2, T.HALF.y * 2, T.HALF.z * 2);
  const cabin = new THREE.BoxGeometry(T.HALF.x * 1.7, 0.5, T.HALF.z * 0.9);

  const body = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial(), T.COUNT);
  const tops = new THREE.InstancedMesh(cabin, new THREE.MeshStandardMaterial(), T.COUNT);
  body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  tops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  body.castShadow = tops.castShadow = true;
  body.receiveShadow = true;
  body.frustumCulled = tops.frustumCulled = false;
  scene.add(art.register(body, 'traffic'));
  scene.add(art.register(tops, 'glass'));

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();

  return {
    body, tops,
    sync(list) {
      const n = Math.min(list.length, T.COUNT);
      for (let i = 0; i < n; i++) {
        const c = list[i];
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.yaw);
        p.set(c.x, T.HALF.y, c.z);
        m.compose(p, q, s);
        body.setMatrixAt(i, m);
        p.set(c.x, T.HALF.y * 2 + 0.25, c.z);
        m.compose(p, q, s);
        tops.setMatrixAt(i, m);
      }
      body.count = n;
      tops.count = n;
      body.instanceMatrix.needsUpdate = true;
      tops.instanceMatrix.needsUpdate = true;
    },
  };
}
