import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map();
const blobUrls = new Map();

export function registerBlobUrl(src, blobUrl) {
  blobUrls.set(src, blobUrl);
  cache.delete(src);
}

export function loadModelData(src) {
  if (!cache.has(src)) {
    const url = blobUrls.get(src) ?? src;
    cache.set(
      src,
      loader.loadAsync(url).then((gltf) => {
        gltf.scene.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        return { scene: gltf.scene, animations: gltf.animations };
      }),
    );
  }
  return cache.get(src);
}

export function loadModel(src) {
  return loadModelData(src).then(({ scene }) => scene.clone(true));
}
