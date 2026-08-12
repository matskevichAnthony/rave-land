import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const loader = new GLTFLoader();

export function createViewer(canvasRoot, { cameraAt = [1.6, 1.5, 2.4], lookAt = [0, 0.9, 0] } = {}) {
  const clock = new THREE.Clock();
  const frameHandlers = [];
  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
  let model = null;

  function resize() {
    if (!renderer) return;
    const { clientWidth, clientHeight } = canvasRoot;
    renderer.setSize(clientWidth, clientHeight);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  }

  function start() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    canvasRoot.append(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a22);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(2, 3, 2);
    scene.add(sun);
    scene.add(new THREE.GridHelper(6, 12, 0x555566, 0x33333e));

    camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
    camera.position.set(...cameraAt);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(...lookAt);

    window.addEventListener('resize', resize);
    renderer.setAnimationLoop(() => {
      const delta = clock.getDelta();
      for (const handler of frameHandlers) handler(delta);
      controls.update();
      renderer.render(scene, camera);
    });
    resize();
  }

  function clear() {
    if (model) scene.remove(model);
    model = null;
  }

  /** Готовый объект вместо файла: процедурные постройки и персонажи приходят из своих сборщиков. */
  function show(object) {
    start();
    clear();
    model = object;
    scene.add(object);
    return object;
  }

  function load(src) {
    start();
    clear();
    return new Promise((resolve, reject) => {
      loader.load(src, (gltf) => {
        show(gltf.scene);
        resolve(gltf);
      }, undefined, reject);
    });
  }

  function dispose() {
    clear();
    frameHandlers.length = 0;
    if (renderer) {
      renderer.setAnimationLoop(null);
      renderer.dispose();
      renderer = null;
    }
    window.removeEventListener('resize', resize);
    canvasRoot.replaceChildren();
  }

  return {
    load,
    show,
    clear,
    dispose,
    resize,
    onFrame: (handler) => frameHandlers.push(handler),
  };
}

/** Треугольники, габариты в метрах и центр модели: то, что важно для бюджета сцены. */
export function measure(object) {
  let triangles = 0;
  object.traverse((node) => {
    if (!node.isMesh) return;
    const index = node.geometry.getIndex();
    triangles += (index ? index.count : node.geometry.getAttribute('position').count) / 3;
  });
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  return { triangles, size, center: box.getCenter(new THREE.Vector3()) };
}
