import * as THREE from 'three';

const SIZE = 220;
const MAX_PIXEL_RATIO = 2;
const FIELD_OF_VIEW = 35;
const FRAME_PADDING = 1.25;
const VIEW_DIRECTION = new THREE.Vector3(0.9, 0.5, 1.2).normalize();

/**
 * Превью моделей: один WebGL-контекст на всю страницу.
 *
 * Контекстов у браузера единицы, а карточек десятки, поэтому рисует всех один
 * рендерер, а карточка получает готовую картинку копией в свой 2D-канвас.
 * Модель грузится, когда карточка доезжает до экрана, и сразу освобождается.
 *
 * `shared` говорит, что сборщик отдаёт модели из общего кэша: освобождать их
 * нельзя, иначе превью заберёт геометрию у того, кто держит на неё ссылку.
 */
export function createThumbnails({ shared = false } = {}) {
  const pixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(SIZE, SIZE);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a22);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(2, 3, 2);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, 0.01, 100);

  const queue = [];
  const waiting = new Map();
  let drawing = false;

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      queue.push(waiting.get(entry.target));
      waiting.delete(entry.target);
    }
    drainQueue();
  });

  async function drainQueue() {
    if (drawing) return;
    drawing = true;
    while (queue.length) {
      const { canvas, build, settle, fail } = queue.shift();
      try {
        const object = await build();
        draw(object, canvas);
        if (!shared) release(object);
        settle();
      } catch (error) {
        fail(error);
      }
    }
    drawing = false;
  }

  function draw(object, canvas) {
    scene.add(object);
    frameCamera(object);
    renderer.render(scene, camera);
    scene.remove(object);
    canvas.width = SIZE * pixelRatio;
    canvas.height = SIZE * pixelRatio;
    canvas.getContext('2d').drawImage(renderer.domElement, 0, 0);
  }

  function frameCamera(object) {
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.01);
    const distance = FRAME_PADDING * radius / Math.sin(THREE.MathUtils.degToRad(FIELD_OF_VIEW) / 2);
    camera.position.copy(center).addScaledVector(VIEW_DIRECTION, distance);
    camera.lookAt(center);
    camera.near = distance / 100;
    camera.far = distance * 10;
    camera.updateProjectionMatrix();
  }

  /** Карточка ставится в очередь рендера, когда доезжает до экрана. */
  function add(canvas, build) {
    return new Promise((settle, fail) => {
      waiting.set(canvas, { canvas, build, settle, fail });
      observer.observe(canvas);
    });
  }

  return { add };
}

function release(object) {
  object.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry.dispose();
    for (const material of [node.material].flat()) {
      for (const value of Object.values(material)) {
        if (value?.isTexture) value.dispose();
      }
      material.dispose();
    }
  });
}
