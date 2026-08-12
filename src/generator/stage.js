import { createViewer, measure } from '../model-viewer/scene.js';

/** Три промежуточных результата на экране: картинка, сырой меш, готовый проп. */

// Файлы прогона отдаёт сам генератор: свежие в раздачу дев-сервера не попадают.
const ASSETS = '/api/gen/file/';
const MESH_CAMERA = { cameraAt: [1.2, 0.9, 1.5], lookAt: [0, 0, 0] };
const PROP_CAMERA = { cameraAt: [2.2, 1.8, 2.8], lookAt: [0, 0.6, 0] };

/** Файл перезаписывается на месте, поэтому браузеру нужна причина забыть прошлый. */
const fresh = (asset, file) => `${ASSETS}${file}?v=${encodeURIComponent(asset.updated)}`;

function statRow(label, value) {
  const row = document.createElement('p');
  row.className = 'stat';
  row.innerHTML = `<span>${label}</span><b>${value}</b>`;
  return row;
}

function propStats(asset, measured) {
  const { stats } = asset;
  if (!stats) return [statRow('Треугольников', Math.round(measured.triangles))];
  const size = [measured.size.x, measured.size.y, measured.size.z]
    .map((value) => value.toFixed(2)).join(' x ');
  return [
    statRow('Бюджет', stats.budget),
    statRow('Треугольников', `${stats.triangles_source} в ${stats.triangles}`),
    statRow('Габариты, м', size),
    statRow('Размер файла', `${stats.kilobytes} КБ`),
    statRow('Текстура', stats.texture
      ? `${stats.texture} x ${stats.texture}, ближайшая`
      : 'вершинные цвета'),
    statRow('Считалось', `${stats.seconds} с`),
  ];
}

export function createStage(root) {
  const image = root.querySelector('[data-js-image]');
  const statsRoot = root.querySelector('[data-js-stats]');
  const notes = Object.fromEntries(['image', 'mesh', 'prop'].map((step) => [
    step, root.querySelector(`[data-js-slot-note="${step}"]`),
  ]));
  const viewers = {
    mesh: createViewer(root.querySelector('[data-js-mesh]'), MESH_CAMERA),
    prop: createViewer(root.querySelector('[data-js-prop]'), PROP_CAMERA),
  };

  function showImage(asset) {
    notes.image.textContent = asset.files.image ? '' : 'пока нет';
    image.hidden = !asset.files.image;
    if (!asset.files.image) return;
    image.onload = () => {
      notes.image.textContent = `${image.naturalWidth} x ${image.naturalHeight}`;
    };
    image.src = fresh(asset, asset.files.image);
  }

  function showModel(step, asset, describe) {
    const viewer = viewers[step];
    if (!asset.files[step]) {
      notes[step].textContent = 'пока нет';
      viewer.dispose();
      return Promise.resolve();
    }
    notes[step].textContent = 'загрузка';
    // Вьюер падает сразу, если WebGL в системе нет: без обёртки это молчаливая «загрузка» навсегда.
    return Promise.resolve()
      .then(() => viewer.load(fresh(asset, asset.files[step])))
      .then((gltf) => describe(gltf.scene))
      .catch((error) => {
        notes[step].textContent = `не загрузилось: ${error.message ?? error}`;
      });
  }

  function showMesh(asset) {
    return showModel('mesh', asset, (model) => {
      notes.mesh.textContent = `${Math.round(measure(model).triangles)} тр`;
    });
  }

  function showProp(asset) {
    statsRoot.replaceChildren();
    return showModel('prop', asset, (model) => {
      const measured = measure(model);
      notes.prop.textContent = `${Math.round(measured.triangles)} тр`;
      statsRoot.replaceChildren(...propStats(asset, measured));
    });
  }

  const show = { image: showImage, mesh: showMesh, prop: showProp };

  return {
    showStep: (step, asset) => show[step](asset),
    showAsset(asset) {
      showImage(asset);
      showMesh(asset);
      showProp(asset);
    },
  };
}
