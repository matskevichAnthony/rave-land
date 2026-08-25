/**
 * Объёмный слой: второй холст поверх первого, на котором тот же кадр живёт в трёх измерениях.
 *
 * Двумерная часть инструмента не тронута ни в одном месте, и это главное решение файла.
 * Собранный ею кадр приходит сюда текстурой, а всё, что здесь происходит, происходит с
 * текстурой, а не вместо неё. Поэтому слой снимается кнопкой без единого следа: под ним
 * остаётся ровно тот инструмент, что был, со всеми своими приёмами.
 *
 * Проходов три, и порядок между ними обязателен. Первый кладёт кадр во весь экран и ведёт его
 * по кривой сетке, второй рисует тела, на которые натянут тот же кадр, третий сыплет поверх
 * ливень знаков. Тела обязаны видеть под собой уже искажённый кадр, иначе стекло показывает
 * одну картинку, а фон вокруг другую, и слой распадается на две несвязанные вещи.
 *
 * Трип это одна ручка на всё остальное: эхо-тоннель, полёт тел на камеру, дымку вдаль и
 * монтаж ракурсов. За пультом её крутят вслепую в темноте, поэтому их и одна. На нуле слой
 * работает ровно как работал, без единого лишнего прохода и без единой заведённой текстуры,
 * на единице зал летит сквозь собственное видео.
 */

import * as THREE from 'three';
import { DEFAULT_SHAPE, createBodies } from './bodies.js';
import { DEFAULT_WARP, createWarp } from './warp.js';
import { createRain } from './rain.js';
import { createEcho } from './echo.js';
import { createFlight } from './flight.js';

const FIELD_OF_VIEW = 52;
const NEAR = 0.1;
const FAR = 40;

export function createSpace({ canvas, frame }) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.autoClear = false;
  renderer.setPixelRatio(1);

  // Текстура берётся с того же холста, который рисует двумерная часть: копии кадра здесь нет
  // ни одной, видеокарта читает готовый холст напрямую.
  const texture = new THREE.CanvasTexture(frame);
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const resolution = new THREE.Vector2(1, 1);
  const camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, NEAR, FAR);
  const scene = new THREE.Scene();
  const warp = createWarp(texture);
  const bodies = createBodies({ texture, resolution });
  const rain = createRain({ texture, resolution });
  const echo = createEcho();
  const flight = createFlight();
  scene.add(bodies.group);
  scene.add(rain.mesh);

  warp.setMode(DEFAULT_WARP);
  bodies.setShape(DEFAULT_SHAPE);

  // Ручки, которые проводка может выставить один раз, а может толкать каждым кадром. Побеждает
  // последняя запись, поэтому оба способа работают и не мешают друг другу.
  let density = 0;
  let trip = 0;

  return {
    get count() {
      return bodies.count;
    },
    setWarp: (id) => warp.setMode(id),
    setShape: (id) => bodies.setShape(id),
    spawn: (order) => bodies.spawn(order),
    clear: () => bodies.clear(),
    age: () => bodies.age(),
    setRain: (amount) => { density = amount ?? 0; },
    setTrip: (amount) => { trip = amount ?? 0; },

    setSize(width, height) {
      resolution.set(width, height);
      renderer.setSize(width, height, false);
      echo.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },

    /**
     * Кадр слоя.
     *
     * Текстура помечается устаревшей каждый кадр вручную: холст под ней рисуется чужими
     * руками, и знать о его правках видеокарте неоткуда.
     *
     * Звук разбирается здесь один раз на всех. Полосы приходят долями от нуля до единицы, а
     * недостающие поля считаются тишиной: проводку дописывают снаружи, и слой не имеет права
     * падать оттого, что она ещё не дописана. Из ударов собираются две величины: hit, по
     * которому тела раздуваются и доливаются, и strike, по которому они перетекают в другую
     * форму. Бочка и признак доли идут в первую, малый барабан добавляется во вторую.
     */
    render({
      dt, time, level, low, mid, high, punched, kick, snare, hat,
      warp: amount, morph, glass, rain: rainy, trip: tripping,
    }) {
      texture.needsUpdate = true;
      if (rainy !== undefined) density = rainy;
      if (tripping !== undefined) trip = tripping;

      const loud = level ?? 0;
      const beat = punched === true;
      const tick = hat ?? 0;
      const top = high ?? 0;
      const hit = Math.max(kick ?? 0, beat ? 1 : 0);
      const strike = Math.max(hit, snare ?? 0);

      flight.step(camera, { dt, time, punched: beat, trip });

      warp.step({ time, level: loud, amount: amount ?? 0, aspect: camera.aspect, punched: beat });
      bodies.step({
        dt,
        time,
        level: loud,
        low: low ?? 0,
        mid: mid ?? 0,
        high: top,
        hat: tick,
        hit,
        strike,
        morph: morph ?? 0,
        glass: glass ?? 0,
        trip,
      });
      rain.setDensity(density);
      if (density > 0) rain.step({ time, level: loud, high: top, hat: tick });

      // На нуле трипа слой пишется прямо в холст, и эхо не стоит ни прохода, ни текстуры.
      const target = trip > 0 ? echo.open(renderer) : null;
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(warp.scene, warp.camera);
      renderer.render(scene, camera);
      if (target) echo.close(renderer, { dt, trip, level: loud, hit });
      else echo.rest();
    },

    dispose() {
      bodies.dispose();
      rain.dispose();
      echo.dispose();
      texture.dispose();
      renderer.dispose();
    },
  };
}
