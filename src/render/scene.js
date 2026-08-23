/** Renderer, scene and camera bootstrap. */

import * as THREE from 'three';
import TUNING from '../TUNING.js';

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, TUNING.RENDER.PIXEL_RATIO_CAP));
  renderer.shadowMap.enabled = TUNING.RENDER.SHADOWS;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = TUNING.RENDER.EXPOSURE;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    TUNING.CAMERA.FOV_BASE, 16 / 9, TUNING.CAMERA.NEAR, TUNING.CAMERA.FAR
  );

  function resize(w, h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  return { renderer, scene, camera, resize };
}
