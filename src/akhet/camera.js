import * as THREE from 'three';
import { BOUNDS, COLONNADE, DOOR, HALL, SLOT, TYPE_BOX, VIEW } from './hall.js';

/**
 * Камера сцены AKHET: четыре готовых кадра, свободный поиск руками и экранная скорость
 * для постобработки.
 *
 * Метры не выдумываются: точка афиши, точка входа, стены, аисль между колоннами и коробка
 * лайнапа приходят из `hall.js`. Здесь остаётся только темп и то, как кадр отъезжает под
 * форму холста.
 *
 * Файл повторяет устройство `src/understav/camera.js`: замер движения, захват мыши и
 * подгонка дальности под кадр одинаковы, а траектории у каждого зала свои. Общая часть в
 * движок не вынесена, и это первый пункт в плане работ.
 */

/** Положение свободной камеры в метрах, `detail` это `{ x, y, z }` либо `null`. */
export const CAMERA_SPOT_EVENT = 'akhet:camera-spot';

const TAU = Math.PI * 2;

const STILL = {
  breathSeconds: 21,
  breathHeight: 0.12,
  breathDolly: 0.55,
};

// Петля качается в аисле между рядами колонн: за ними стена, а вбок из зала не выйти.
const ORBIT = {
  seconds: 28,
  swing: Math.PI / 7,
  rise: 0.55,
  riseSeconds: 14,
};

// Спуск начинается под проломом кровли, падает к воде и отъезжает на кадр афиши.
const DESCEND = {
  seconds: 20,
  roofGap: 1.6,
  nearY: 1.15,
  nearShare: 0.45,
  startTargetY: 0.6,
  nearTargetY: 3.2,
};

// Пролёт входит от передней стены боком и сводится к оси, заканчивая тесным кадром двери.
const APPROACH = {
  seconds: 32,
  sideShare: 0.75,
  turnShare: 0.36,
};

// Свободный кадр ищет человек, подгонка тут не работает: остаются только стены зала.
const FREE = {
  wallGap: 1.5,
  waterGap: 0.9,
  roofGap: 1.4,
  minDistance: 2.5,
  pitchLimit: Math.PI / 2 - 0.15,
  turnPerPixel: 0.005,
  panPerPixel: 0.0015,
  zoomPerNotch: 0.0012,
};

const CANVAS_SELECTOR = '[data-js-mount] canvas';
const LEFT_BUTTON = 0;
const RIGHT_BUTTON = 2;
const MIN_PROJECTION = 1e-3;

// Метры в секунду и радианы в секунду, на которых нормировка `motion` даёт единицу.
const FULL_SPEED = 12;
const FULL_TURN = 1.2;
const MOTION_LAG = 0.18;
const MIN_DT = 1 / 240;

// Воздух по краям коробки лайнапа, в метрах.
const FIT_MARGIN = 0.6;
// Ближе этого камера к надписи не подходит: вплотную монумент теряет масштаб, а песок и небо
// перестают держать кадр.
const POSTER_MIN_DISTANCE = 34;

// Аисль между внутренними рядами колонн: шире камера вбок не уходит, иначе идёт сквозь ствол.
const AISLE_HALF = Math.min(...COLONNADE.rows.map(Math.abs)) - COLONNADE.capitalRadius;

/**
 * Просвет в глубине зала, где камере есть где стоять.
 *
 * Колонны стоят станциями поперёк зала, и остановка на станции это кадр в упор в ствол.
 * Середина между двумя средними станциями это самое дальнее место, до которого камера
 * доезжает, ничего не задев.
 */
const STATION_STOP = middleGap(COLONNADE.stations);

function middleGap(stations) {
  const sorted = [...stations].sort((first, second) => second - first);
  const index = Math.floor((sorted.length - 1) / 2);
  return (sorted[index] + sorted[index + 1]) / 2;
}

const POSTER = {
  position: new THREE.Vector3(...VIEW.poster.position),
  target: new THREE.Vector3(...VIEW.poster.target),
};
const ENTRY = {
  position: new THREE.Vector3(...VIEW.entry.position),
  target: new THREE.Vector3(...VIEW.entry.target),
};

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const lerp = (from, to, t) => from + (to - from) * t;
const smoothstep = (t) => t * t * (3 - 2 * t);

// Холст на странице один, а риг пересобирается на каждый сид: мышь отдаётся последнему.
let dropActivePointers = null;

/**
 * Коробка, которую камера кадрирует на самом деле.
 *
 * Заявленную площадкой коробку набор может перерасти: стелы лайнапа считают себе высоту по
 * длине имени, и длинное имя поднимает стелу выше обещанного. Кадрируется то, что стоит на
 * песке, а не то, что было обещано, поэтому афиша меряется по факту.
 */
function measurePoster(group) {
  const box = new THREE.Box3();
  group.updateWorldMatrix(true, true);
  // Считается только то, что видно: с выключенным отсчётом цифр в кадре нет, и кадр не
  // обязан оставлять место под пустую мастабу.
  group.traverseVisible((node) => {
    if (node.isMesh) box.expandByObject(node);
  });
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // Прицел по середине глубины, а не по передней плоскости: монумент развёрнут к камере
  // углом, и целясь в его переднюю грань, кадр уезжает вбок на половину глубины, отчего
  // крайняя стела лайнапа срезается в вертикали.
  return { x: center.x, y: center.y, z: center.z, width: size.x, height: size.y };
}

export function createCameraRig({ camera, bounds, rng, poster = null }) {
  const fit = poster ? measurePoster(poster) : TYPE_BOX;
  const size = {
    radius: Number.isFinite(bounds?.radius) ? bounds.radius : BOUNDS.radius,
    height: Number.isFinite(bounds?.height) ? bounds.height : BOUNDS.height,
  };
  // Куда свободной камере можно доехать: борта, торец за дверью и передняя стена.
  const reach = {
    side: HALL.halfWidth - FREE.wallGap,
    back: Math.abs(HALL.endZ) - FREE.wallGap,
    front: HALL.frontZ - FREE.wallGap,
    low: HALL.waterY + FREE.waterGap,
    high: HALL.roofY - FREE.roofGap,
    pan: Math.min(size.radius, HALL.halfWidth - FREE.wallGap),
  };
  const phase = rng() * TAU;
  const spin = rng.sign();

  const position = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const previousPosition = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const previousForward = new THREE.Vector3();
  const posterCentre = new THREE.Vector3();
  const viewDirection = new THREE.Vector3();
  const motion = { speed: 0, turn: 0 };

  const free = { yaw: 0, pitch: 0, distance: 0, target: new THREE.Vector3() };
  const drag = { pointer: null, kind: null, x: 0, y: 0 };
  let spotStale = false;
  let releasePointers = null;

  const shots = {
    still(seconds) {
      const breath = Math.sin((seconds / STILL.breathSeconds) * TAU + phase);
      // Кадр афиши целится в саму надпись, а не мимо неё. Площадка скомпонована под широкий
      // холст, и там взгляд мимо монумента работает; на квадрате и вертикали обзор по ширине
      // сужается, и отъезд по одной оси Z надпись не спасает, её срезает краем.
      aimAtPoster();
      position.y += breath * STILL.breathHeight;
      position.addScaledVector(viewDirection, breath * STILL.breathDolly);
    },
    orbit(seconds) {
      const turn = (seconds / ORBIT.seconds) * TAU + phase;
      const distance = tightZ();
      // Чем уже кадр, тем дальше камера, и тем меньше ей можно отходить вбок: угол считается
      // из дальности, иначе на вертикали качание выносит камеру в колонну.
      const swing = Math.asin(Math.min(1, AISLE_HALF / distance));
      const angle = Math.sin(turn) * Math.min(ORBIT.swing, swing) * spin;
      position.set(
        Math.sin(angle) * distance,
        POSTER.position.y + Math.cos((seconds / ORBIT.riseSeconds) * TAU) * ORBIT.rise,
        fit.z + Math.cos(angle) * distance,
      );
      lookAt.copy(POSTER.target);
    },
    descend(seconds) {
      const time = Math.min(seconds / DESCEND.seconds, 1);
      const fall = smoothstep(Math.min(time / DESCEND.nearShare, 1));
      const away = smoothstep(clamp01((time - DESCEND.nearShare) / (1 - DESCEND.nearShare)));
      const roofY = HALL.roofY - DESCEND.roofGap;
      position.set(
        0,
        lerp(lerp(roofY, DESCEND.nearY, fall), POSTER.position.y, away),
        lerp(SLOT.z, posterZ(), away),
      );
      lookAt.set(
        0,
        lerp(lerp(DESCEND.startTargetY, DESCEND.nearTargetY, fall), POSTER.target.y, away),
        POSTER.target.z,
      );
    },
    approach(seconds) {
      const time = Math.min(seconds / APPROACH.seconds, 1);
      const turn = smoothstep(Math.min(time / APPROACH.turnShare, 1));
      const fly = smoothstep(time);
      position.set(
        lerp(AISLE_HALF * APPROACH.sideShare * spin, 0, fly),
        lerp(HALL.waterY + FREE.waterGap, POSTER.position.y, fly),
        lerp(ENTRY.position.z, fit.z + tightZ(), fly),
      );
      lookAt.set(
        lerp(ENTRY.target.x, POSTER.target.x, turn),
        lerp(ENTRY.target.y, POSTER.target.y, turn),
        POSTER.target.z,
      );
    },
    free() {
      settleFree();
      const horizontal = Math.cos(free.pitch) * free.distance;
      position.set(
        free.target.x + Math.sin(free.yaw) * horizontal,
        clamp(free.target.y + Math.sin(free.pitch) * free.distance, reach.low, reach.high),
        free.target.z + Math.cos(free.yaw) * horizontal,
      );
      lookAt.copy(free.target);
    },
  };

  let mode = 'still';
  let startedAt = null;

  /**
   * Дальность до плоскости афиши, с которой коробка целиком влезает в кадр этой формы.
   *
   * Взгляд идёт мимо коробки, между пилоном и вихрем, поэтому промах входит в расчёт по
   * обеим осям: надпись стоит и ниже точки взгляда, и сильно левее неё, а без учёта этого
   * узкий кадр срезает её ровно на столько, на сколько взгляд уведён в сторону.
   */
  function fitDistance(aspect) {
    const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const drop = Math.abs(fit.y - POSTER.target.y);
    const sway = Math.abs(fit.x - POSTER.target.x);
    const vertical = (drop + fit.height / 2 + FIT_MARGIN) / halfFov;
    const horizontal = (sway + fit.width / 2 + FIT_MARGIN) / (halfFov * aspect);
    return Math.max(vertical, horizontal);
  }

  /** Тесный кадр: ближе просвета между колоннами камера не подходит, дальше её гонит холст. */
  function tightZ() {
    return clamp(
      Math.max(fitDistance(camera.aspect), STATION_STOP - fit.z),
      FREE.minDistance,
      reach.front - fit.z,
    );
  }

  /**
   * Кадр афиши стоит там, где его поставил зал, и отъезжает, только если текст не влез.
   *
   * Отъезд считается по прямой до афиши, а не по разнице глубин: точка съёмки стоит сильно
   * в стороне от надписи, и её относ вбок уже даёт половину нужной дальности. Считать
   * дальность одной координатой значило бы гнать камеру к задней стене там, где она и так
   * достаточно далеко.
   */
  function posterZ() {
    const aside = Math.hypot(POSTER.position.x - fit.x, POSTER.position.y - fit.y);
    const need = fitDistance(camera.aspect);
    const gap = Math.sqrt(Math.max(need * need - aside * aside, 0));
    return Math.max(POSTER.position.z, fit.z + gap);
  }

  /**
   * Поставить камеру так, чтобы монумент влез целиком в кадр любой формы.
   *
   * Направление взгляда сохраняется тем же, что задала площадка: та диагональ и держит
   * композицию. Меняется только дальность и точка взгляда, которая садится на середину
   * надписи, поэтому узкий холст обрезает песок и небо, а не буквы.
   */
  function aimAtPoster() {
    posterCentre.set(fit.x, fit.y, fit.z);
    viewDirection.copy(POSTER.position).sub(POSTER.target).normalize();
    position.copy(posterCentre).addScaledVector(viewDirection, posterDistance(camera.aspect));
    lookAt.copy(posterCentre);
  }

  /** Дальность, с которой надпись влезает по обеим осям кадра этой формы. */
  function posterDistance(aspect) {
    const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const vertical = (fit.height / 2 + FIT_MARGIN) / halfFov;
    const horizontal = (fit.width / 2 + FIT_MARGIN) / (halfFov * aspect);
    return Math.max(vertical, horizontal, POSTER_MIN_DISTANCE);
  }

  /** Свободная камера входит в кадр там, где её оставил прошлый режим. */
  function seedFree() {
    free.target.copy(lookAt);
    const offset = position.clone().sub(lookAt);
    free.distance = Math.max(offset.length(), FREE.minDistance);
    free.yaw = Math.atan2(offset.x, offset.z);
    free.pitch = Math.asin(clamp(offset.y / free.distance, -1, 1));
    settleFree();
  }

  function settleFree() {
    free.pitch = clamp(free.pitch, -FREE.pitchLimit, FREE.pitchLimit);
    free.target.x = clamp(free.target.x, -reach.pan, reach.pan);
    free.target.z = clamp(free.target.z, -reach.back, reach.front);
    free.target.y = clamp(free.target.y, HALL.waterY, Math.min(DOOR.top, reach.high));
    free.distance = clamp(free.distance, FREE.minDistance, wallLimit());
  }

  /** Дальность, на которой луч взгляда упирается в ближайшую стену зала. */
  function wallLimit() {
    const horizontal = Math.max(Math.cos(free.pitch), MIN_PROJECTION);
    const sideways = slabLimit(free.target.x, Math.sin(free.yaw), reach.side, reach.side);
    const lengthways = slabLimit(free.target.z, Math.cos(free.yaw), reach.back, reach.front);
    return Math.max(FREE.minDistance, Math.min(sideways, lengthways) / horizontal);
  }

  function slabLimit(from, direction, back, front) {
    if (Math.abs(direction) < MIN_PROJECTION) return Infinity;
    return direction > 0 ? (front - from) / direction : (-back - from) / direction;
  }

  function place(seconds) {
    shots[mode](seconds);
    camera.position.copy(position);
    camera.lookAt(lookAt);
  }

  function readMotion(dt) {
    const step = Math.max(dt, MIN_DT);
    camera.getWorldDirection(forward);
    const speed = clamp01(camera.position.distanceTo(previousPosition) / step / FULL_SPEED);
    const turn = clamp01(previousForward.angleTo(forward) / step / FULL_TURN);
    const lag = 1 - Math.exp(-dt / MOTION_LAG);
    motion.speed += (speed - motion.speed) * lag;
    motion.turn += (turn - motion.turn) * lag;
    previousPosition.copy(camera.position);
    previousForward.copy(forward);
  }

  function dragKind(domEvent) {
    if (domEvent.button === RIGHT_BUTTON) return 'pan';
    if (domEvent.button !== LEFT_BUTTON) return null;
    return domEvent.shiftKey ? 'pan' : 'turn';
  }

  function beginDrag(domEvent) {
    const kind = dragKind(domEvent);
    if (!kind) return;
    domEvent.preventDefault();
    drag.pointer = domEvent.pointerId;
    drag.kind = kind;
    drag.x = domEvent.clientX;
    drag.y = domEvent.clientY;
    domEvent.currentTarget.setPointerCapture(domEvent.pointerId);
  }

  function moveDrag(domEvent) {
    if (drag.pointer !== domEvent.pointerId) return;
    const dx = domEvent.clientX - drag.x;
    const dy = domEvent.clientY - drag.y;
    drag.x = domEvent.clientX;
    drag.y = domEvent.clientY;
    if (drag.kind === 'turn') {
      free.yaw -= dx * FREE.turnPerPixel;
      free.pitch += dy * FREE.turnPerPixel;
    } else {
      // Чем дальше камера, тем крупнее шаг: иначе с конца зала точка взгляда ползёт вечно.
      const step = free.distance * FREE.panPerPixel;
      free.target.x -= Math.cos(free.yaw) * dx * step;
      free.target.z += Math.sin(free.yaw) * dx * step;
      free.target.y += dy * step;
    }
    spotStale = true;
  }

  function endDrag(domEvent) {
    if (drag.pointer !== domEvent.pointerId) return;
    drag.pointer = null;
    drag.kind = null;
  }

  function zoomDrag(domEvent) {
    domEvent.preventDefault();
    free.distance *= Math.exp(domEvent.deltaY * FREE.zoomPerNotch);
    spotStale = true;
  }

  const blockMenu = (domEvent) => domEvent.preventDefault();

  function catchPointers() {
    if (releasePointers) return;
    const canvas = document.querySelector(CANVAS_SELECTOR);
    if (!canvas) return;
    dropActivePointers?.();
    canvas.addEventListener('pointerdown', beginDrag);
    canvas.addEventListener('pointermove', moveDrag);
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('wheel', zoomDrag, { passive: false });
    canvas.addEventListener('contextmenu', blockMenu);
    releasePointers = () => {
      canvas.removeEventListener('pointerdown', beginDrag);
      canvas.removeEventListener('pointermove', moveDrag);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', endDrag);
      canvas.removeEventListener('wheel', zoomDrag);
      canvas.removeEventListener('contextmenu', blockMenu);
      drag.pointer = null;
      drag.kind = null;
      releasePointers = null;
      dropActivePointers = null;
    };
    dropActivePointers = releasePointers;
  }

  function announceSpot(spot) {
    window.dispatchEvent(new CustomEvent(CAMERA_SPOT_EVENT, { detail: spot }));
  }

  function setMode(name) {
    mode = name in shots ? name : 'still';
    startedAt = null;
    if (mode !== 'free') {
      releasePointers?.();
      announceSpot(null);
      return;
    }
    seedFree();
    catchPointers();
    spotStale = true;
  }

  function update(dt, elapsed) {
    if (startedAt === null) startedAt = elapsed;
    place(elapsed - startedAt);
    readMotion(dt);
    if (mode !== 'free' || !spotStale) return;
    spotStale = false;
    announceSpot({ x: camera.position.x, y: camera.position.y, z: camera.position.z });
  }

  place(0);
  previousPosition.copy(camera.position);
  camera.getWorldDirection(previousForward);

  return { setMode, update, motion };
}
