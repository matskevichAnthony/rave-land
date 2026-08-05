import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const CHARACTERS = [
  { name: 'Игровой персонаж', src: 'assets/models/character-animated.glb' },
  { name: 'Танцы (mocap-ретаргет)', src: 'assets/models/dance-preview.glb' },
  { name: 'TRELLIS NPC (сырой)', src: 'assets/models/trellis-npc.glb' },
  { name: 'Bold Raver', src: 'assets/models/bold-raver.glb' },
  { name: 'Техно-рейвер (облачный маршрут)', src: 'assets/models/techno-raver.glb' },
];

const cardsRoot = document.querySelector('[data-js-cards]');
const viewerRoot = document.querySelector('[data-js-viewer]');
const canvasRoot = document.querySelector('[data-js-canvas]');
const clipsRoot = document.querySelector('[data-js-clips]');
const nameLabel = document.querySelector('[data-js-name]');

let renderer, scene, camera, controls, mixer, model;
const clock = new THREE.Clock();

for (const character of CHARACTERS) {
  const card = document.createElement('button');
  card.className = 'card';
  card.innerHTML = `${character.name}<small>${character.src}</small>`;
  card.addEventListener('click', () => openViewer(character));
  cardsRoot.append(card);
}

const openParam = new URLSearchParams(location.search).get('open');
if (openParam !== null) cardsRoot.children[openParam]?.click();

document.querySelector('[data-js-close]').addEventListener('click', closeViewer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeViewer();
});

function initScene() {
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
  camera.position.set(1.6, 1.5, 2.4);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.9, 0);

  window.addEventListener('resize', resize);
  renderer.setAnimationLoop(() => {
    if (mixer) mixer.update(clock.getDelta());
    controls.update();
    renderer.render(scene, camera);
  });
}

function resize() {
  const { clientWidth, clientHeight } = canvasRoot;
  renderer.setSize(clientWidth, clientHeight);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
}

function openViewer(character) {
  viewerRoot.hidden = false;
  nameLabel.textContent = character.name;
  initScene();
  resize();
  loadCharacter(character.src);
}

function closeViewer() {
  viewerRoot.hidden = true;
  clearModel();
  if (renderer) {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer = null;
  }
  canvasRoot.replaceChildren();
}

function clearModel() {
  if (model) scene.remove(model);
  model = null;
  mixer = null;
  clipsRoot.replaceChildren();
}

function loadCharacter(src) {
  clearModel();
  clipsRoot.textContent = 'Загрузка...';
  new GLTFLoader().load(src, (gltf) => {
    clipsRoot.textContent = '';
    model = gltf.scene;
    scene.add(model);
    mixer = new THREE.AnimationMixer(model);
    buildClipButtons(gltf.animations);
  }, undefined, (err) => {
    clipsRoot.textContent = `Не загрузилось: ${err.message || err}`;
    console.error(err);
  });
}

function buildClipButtons(clips) {
  if (!clips.length) {
    clipsRoot.textContent = 'Анимаций нет';
    return;
  }
  let active = null;
  for (const clip of clips) {
    const button = document.createElement('button');
    button.textContent = `${clip.name} (${clip.duration.toFixed(1)}с)`;
    button.addEventListener('click', () => {
      if (active) {
        active.action.fadeOut(0.2);
        active.button.classList.remove('is-active');
      }
      const action = mixer.clipAction(clip);
      action.reset().fadeIn(0.2).play();
      button.classList.add('is-active');
      active = { action, button };
    });
    clipsRoot.append(button);
  }
  clipsRoot.firstChild.click();
}
