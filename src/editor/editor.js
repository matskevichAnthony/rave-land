import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { OBJECT_LABELS } from '../objects/library.js';
import { saveLocal, clearLocal, exportFile } from '../world/manifest.js';
import { toast } from '../ui/toast.js';
import { createWorkshop } from './workshop.js';

const TRANSFORM_MODES = { Digit1: 'translate', Digit2: 'rotate', Digit3: 'scale' };

export function createEditor({
  scene,
  camera,
  renderer,
  followCam,
  registry,
  terrain,
  player,
  npcSystem,
  stage,
  worldSnapshot,
}) {
  let editing = false;
  let selectedItem = null;

  const panel = document.querySelector('[data-panel]');
  const modeLabel = document.querySelector('[data-mode]');
  const selectedLabel = document.querySelector('[data-selected]');

  const transform = new TransformControls(camera, renderer.domElement);
  // Гизмо живёт в сцене только пока редактируют. Невидимым оно не бесплатно: три.js всё
  // равно обходит его и считает матрицы каждый кадр, а редактор открыт минуты из часа.
  const gizmo = transform.getHelper ? transform.getHelper() : transform;
  transform.addEventListener('dragging-changed', (event) => {
    followCam.controls.enabled = !event.value;
    if (!event.value && selectedItem) registry.refreshBody(selectedItem.entry.id);
  });

  const raycaster = new THREE.Raycaster();

  function select(item) {
    selectedItem = item;
    if (item) {
      transform.attach(item.object);
      selectedLabel.textContent = OBJECT_LABELS[item.entry.type] ?? item.entry.type;
    } else {
      transform.detach();
      selectedLabel.textContent = 'ничего не выбрано';
    }
  }

  function toggle() {
    editing = !editing;
    panel.hidden = !editing;
    modeLabel.textContent = editing ? 'Редактор' : 'Прогулка';
    followCam.setEditMode(editing);
    if (editing) {
      scene.add(gizmo);
      workshop.open();
      return;
    }
    select(null);
    scene.remove(gizmo);
  }

  function spawnPoint() {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hits = raycaster.intersectObject(terrain.mesh);
    if (hits.length) return hits[0].point;
    const position = player.position();
    return new THREE.Vector3(position.x, 0, position.z - 4);
  }

  async function spawn(entry) {
    const point = spawnPoint();
    const item = await registry.add({
      id: crypto.randomUUID(),
      position: [point.x, null, point.z],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      ...entry,
    });
    if (editing) select(item);
    return item;
  }

  function save() {
    saveLocal(worldSnapshot());
    toast('Мир сохранён в браузере');
  }

  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (!editing || transform.axis) return;
    const pointer = new THREE.Vector2(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(registry.objects, true);
    if (hits.length) select(registry.itemByObject(hits[0].object));
  });

  window.addEventListener('keydown', (event) => {
    if (['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return;

    if (event.code === 'Tab') {
      event.preventDefault();
      toggle();
      return;
    }
    if (event.code === 'KeyS' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (editing) save();
      return;
    }
    if (!editing) return;

    if (TRANSFORM_MODES[event.code]) transform.setMode(TRANSFORM_MODES[event.code]);
    if (event.code === 'Escape') select(null);
    if (event.code === 'KeyG' && selectedItem) registry.snapToGround(selectedItem.entry.id);
    if (event.code === 'KeyX' && selectedItem) {
      transform.detach();
      registry.remove(selectedItem.entry.id);
      select(null);
    }
  });

  for (const button of panel.querySelectorAll('[data-spawn]')) {
    button.addEventListener('click', () => spawn({ type: button.dataset.spawn }));
  }

  const workshop = createWorkshop({
    root: panel.querySelector('[data-workshop]'),
    spawnModel: (src) => spawn({ type: 'model', src }),
  });

  panel.querySelector('[data-spawn-npc]').addEventListener('click', async () => {
    const point = spawnPoint();
    await npcSystem.add({
      id: crypto.randomUUID(),
      name: `Гость ${npcSystem.count + 1}`,
      seed: Math.floor(Math.random() * 100000),
      position: [point.x, null, point.z],
      data: { роль: 'гость' },
    });
  });

  for (const button of panel.querySelectorAll('[data-time]')) {
    button.addEventListener('click', () => stage.setTimeOfDay(button.dataset.time));
  }

  panel.querySelector('[data-save]').addEventListener('click', save);
  panel.querySelector('[data-export]').addEventListener('click', () => exportFile(worldSnapshot()));
  panel.querySelector('[data-reset]').addEventListener('click', () => {
    clearLocal();
    location.reload();
  });

  const seedInput = panel.querySelector('[data-terrain-seed]');
  const amplitudeInput = panel.querySelector('[data-terrain-amplitude]');
  const plateauInput = panel.querySelector('[data-terrain-plateau]');
  seedInput.value = terrain.params.seed;
  amplitudeInput.value = terrain.params.amplitude;
  plateauInput.value = terrain.params.plateauRadius;

  panel.querySelector('[data-terrain-rebuild]').addEventListener('click', () => {
    terrain.rebuild({
      seed: Number(seedInput.value),
      amplitude: Number(amplitudeInput.value),
      plateauRadius: Number(plateauInput.value),
    });
    registry.resnapAll();
    const position = player.position();
    player.teleport(position.x, position.z);
    toast('Рельеф пересоздан, объекты прижаты к земле');
  });

  return {
    get editing() {
      return editing;
    },
    spawnModelEntry: (src) => spawn({ type: 'model', src }),
  };
}
