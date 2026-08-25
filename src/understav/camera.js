import * as THREE from 'three';
import { CORRIDOR, NAVE, POSTER_EYE, ROSE, TYPE_BOX } from './nave.js';

/**
 * Камера промо-сцены: три готовых кадра, свободный поиск руками и честная экранная
 * скорость для постобработки.
 *
 * Все траектории периодичны по своему периоду, поэтому снятый отрезок «петли» стыкуется
 * сам с собой без склейки. Смаз и хроматику эффекты берут из `motion`, а не из ползунка:
 * иначе картинка живёт отдельно от движения.
 */

/** Положение свободной камеры в метрах, `detail` это `{ x, y, z }` либо `null`. */
export const CAMERA_SPOT_EVENT = 'understav:camera-spot';

const TAU = Math.PI * 2;
const DEFAULT_BOUNDS = { radius: 14, height: 18 };

const STILL = {
  y: POSTER_EYE.y,
  z: POSTER_EYE.z,
  targetY: 5,
  breathSeconds: 19,
  breathHeight: 0.16,
  breathDolly: 0.7,
};

// Петля это качание перед алтарём, а не облёт кругом: за спиной у розы смотреть не на что,
// зал там тёмный и без текста, а от качания остаётся то, ради чего снимают, параллакс.
const ORBIT = {
  seconds: 26,
  radius: 15,
  radiusFactor: 0.85,
  swing: Math.PI / 5,
  y: 5.8,
  rise: 0.7,
  // Взгляд держится вровень с центром коробки типографики: опущенный ниже, он наклоняет
  // кадр, и в широком формате наклон съедает как раз верх заголовка.
  targetY: 5.4,
  wallGap: 1.2,
};

// Спуск это нырок и отъезд, а не посадка. Раньше он останавливался вплотную к алтарю, и
// кадр упирался в лайнап: заголовка и верхних имён не было видно вовсе. Теперь ближняя
// точка это середина движения, а конец совпадает с кадром афиши.
const DESCEND = {
  seconds: 18,
  startHeightFactor: 0.9,
  startZ: 13,
  nearY: 3.2,
  nearZ: 9.5,
  nearShare: 0.45,
  startTargetY: 1.1,
  nearTargetY: 2.4,
};

// Пролёт это слалом по коридору, а не прямая: камера идёт от борта к борту, ныряет к полу и
// снова поднимается, и лишь в конце выходит на ось афиши. По прямой коридор не показать,
// стены в кадре стоят на месте, и от полёта остаётся только приближение афиши.
//
// Боковой размах держится в пролёте между колоннами коридора: они стоят на 5.4 от оси, и
// узел дальше четырёх метров провёл бы камеру сквозь камень.
const APPROACH = {
  seconds: 30,
  // Афиша собирается по ходу пролёта и заканчивается раньше самого пролёта: последнему имени
  // нужно время встать на место и быть прочитанным до того, как камера остановится.
  assembleFrom: 0.12,
  assembleTo: 0.84,
  // Крен берётся из бокового сноса самой трассы, а не выписан по узлам: так поворот и наклон
  // не могут разъехаться при правке узла.
  bankLead: 0.012,
  bankGain: 0.22,
  bankLimit: 0.1,
  flight: [
    { eye: [3.6, 4.4, CORRIDOR.farZ - 2], aim: [-4.5, 3.4, 96] },
    { eye: [-3.4, 2, 88], aim: [4.4, 5.4, 70] },
    { eye: [3.8, 5.2, 64], aim: [-3.6, 2.8, 46] },
    { eye: [-2.8, 2.6, 48], aim: [2.4, 6, 30] },
    { eye: [2.2, 4.6, 38], aim: [-1.2, 5.2, 12] },
  ],
};

// Свободный кадр ищет человек, поэтому подгонка тут не работает: остаются только стены
// зала. Отступы в метрах, шаги в единицах ввода (пиксель мыши, щелчок колеса).
const FREE = {
  wallGap: 1.5,
  floorGap: 1.2,
  vaultGap: 1.5,
  minDistance: 3,
  pitchLimit: Math.PI / 2 - 0.15,
  turnPerPixel: 0.005,
  panPerPixel: 0.0015,
  zoomPerNotch: 0.0012,
  panRange: NAVE.altarRadius,
};

const CANVAS_SELECTOR = '[data-js-mount] canvas';
const LEFT_BUTTON = 0;
const RIGHT_BUTTON = 2;
// Ниже этого косинуса направление считается вырожденным и стена по этой оси не мешает.
const MIN_PROJECTION = 1e-3;

// Метры в секунду и радианы в секунду, на которых нормировка `motion` даёт единицу:
// быстрее камера в этой сцене не летает, а всё что медленнее ложится внутрь 0..1.
const FULL_SPEED = 12;
const FULL_TURN = 1.2;
// Постоянная сглаживания: без неё один длинный кадр даёт эффектам скачок смаза.
const MOTION_LAG = 0.18;
const MIN_DT = 1 / 240;

// Воздух по краям коробки типографики, в метрах. Вертикальный кадр сужает обзор по ширине,
// и без отъезда заголовок вылезает за края: кадрирование обязано менять точку съёмки, а не
// только форму холста.
const FIT_MARGIN = 0.6;

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const lerp = (from, to, t) => from + (to - from) * t;
const smoothstep = (t) => t * t * (3 - 2 * t);

// Холст на странице один, а риг пересобирается на каждый сид: мышь отдаётся последнему,
// иначе обработчики брошенных ригов остаются висеть на холсте.
let dropActivePointers = null;

export function createCameraRig({ camera, bounds, rng }) {
  const size = {
    radius: Number.isFinite(bounds?.radius) ? bounds.radius : DEFAULT_BOUNDS.radius,
    height: Number.isFinite(bounds?.height) ? bounds.height : DEFAULT_BOUNDS.height,
  };
  const orbitRadius = Math.max(ORBIT.radius, size.radius * ORBIT.radiusFactor);
  const vaultY = size.height * DESCEND.startHeightFactor;
  // Куда свободной камере можно доехать: борта и апсида это стены, вперёд из портала она
  // выходит на всю глубину нефа, там стоит афиша.
  const reach = {
    side: NAVE.halfWidth - FREE.wallGap,
    back: Math.abs(NAVE.endZ) - FREE.wallGap,
    front: NAVE.frontZ - NAVE.endZ,
    low: NAVE.altarHeight + FREE.floorGap,
    high: NAVE.vaultHeight - FREE.vaultGap,
  };
  const phase = rng() * TAU;
  const spin = rng.sign();

  const position = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const previousPosition = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const previousForward = new THREE.Vector3();
  const motion = { speed: 0, turn: 0 };

  const free = { yaw: 0, pitch: 0, distance: STILL.z, target: new THREE.Vector3() };
  const drag = { pointer: null, kind: null, x: 0, y: 0 };
  let spotStale = false;
  let releasePointers = null;
  // Крен кадра и доля собранной афиши: их ставит текущий кадр, а не тот, что был до него,
  // поэтому перед каждым вызовом они возвращаются к покою.
  let roll = 0;
  let reveal = 1;

  // Трасса пролёта идёт сплайном, а не отрезками: на стыке отрезков скорость падает в ноль,
  // и полёт читается серией остановок у каждого узла.
  const approachEnd = new THREE.Vector3(0, STILL.y, STILL.z);
  const approachEye = new THREE.CatmullRomCurve3([
    ...APPROACH.flight.map((node) => new THREE.Vector3(...node.eye)),
    approachEnd,
  ]);
  const approachAim = new THREE.CatmullRomCurve3([
    ...APPROACH.flight.map((node) => new THREE.Vector3(...node.aim)),
    new THREE.Vector3(0, STILL.targetY, 0),
  ]);
  const draftAhead = new THREE.Vector3();

  /** Крен на повороте: камера заваливается в ту сторону, куда её сносит трасса. */
  function bankOf(along) {
    approachEye.getPoint(Math.min(along + APPROACH.bankLead, 1), draftAhead);
    const drift = (position.x - draftAhead.x) * APPROACH.bankGain;
    return clamp(drift, -APPROACH.bankLimit, APPROACH.bankLimit);
  }

  const shots = {
    still(seconds) {
      const breath = Math.sin((seconds / STILL.breathSeconds) * TAU + phase);
      position.set(0, STILL.y + breath * STILL.breathHeight, STILL.z + breath * STILL.breathDolly);
      lookAt.set(0, STILL.targetY, 0);
    },
    orbit(seconds) {
      const turn = (seconds / ORBIT.seconds) * TAU + phase;
      const distance = Math.max(
        orbitRadius * framingPull(ORBIT.targetY),
        fitDistance(camera.aspect, ORBIT.targetY),
      );
      // Чем уже кадр, тем дальше камера, и тем меньше ей можно отходить вбок: угол считается
      // из дальности, иначе на вертикали качание выносит камеру за колоннаду.
      const reach = Math.asin(Math.min(1, (NAVE.colonnadeHalfWidth - ORBIT.wallGap) / distance));
      const angle = Math.sin(turn) * Math.min(ORBIT.swing, reach) * spin;
      position.set(
        Math.sin(angle) * distance,
        ORBIT.y + Math.cos(turn * 2) * ORBIT.rise,
        Math.cos(angle) * distance,
      );
      lookAt.set(0, ORBIT.targetY, 0);
    },
    descend(seconds) {
      const time = Math.min(seconds / DESCEND.seconds, 1);
      const fall = smoothstep(Math.min(time / DESCEND.nearShare, 1));
      const away = smoothstep(clamp01((time - DESCEND.nearShare) / (1 - DESCEND.nearShare)));
      const near = framingPull(DESCEND.nearTargetY);
      const poster = Math.max(STILL.z, fitDistance(camera.aspect, STILL.targetY));
      position.set(
        0,
        lerp(lerp(vaultY, DESCEND.nearY, fall), STILL.y, away),
        lerp(lerp(DESCEND.startZ, DESCEND.nearZ, fall) * near, poster, away),
      );
      lookAt.set(
        0,
        lerp(lerp(DESCEND.startTargetY, DESCEND.nearTargetY, fall), STILL.targetY, away),
        0,
      );
    },
    approach(seconds) {
      const time = Math.min(seconds / APPROACH.seconds, 1);
      // Последний узел трассы это кадр афиши, а он зависит от формы холста, поэтому узел
      // переставляется на каждом кадре, а не вычисляется один раз при сборке рига.
      approachEnd.z = Math.max(STILL.z, fitDistance(camera.aspect, STILL.targetY));
      const along = smoothstep(time);
      approachEye.getPoint(along, position);
      approachAim.getPoint(along, lookAt);
      roll = bankOf(along);
      reveal = clamp01(
        (time - APPROACH.assembleFrom) / (APPROACH.assembleTo - APPROACH.assembleFrom),
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
   * Дальность, с которой коробка типографики целиком влезает в кадр этой формы.
   *
   * Точка взгляда входит в расчёт: камера смотрит не в центр коробки, и без этой поправки
   * заголовок срезается сверху ровно на столько, на сколько взгляд опущен вниз.
   */
  function fitDistance(aspect, targetY) {
    const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const offset = Math.abs(TYPE_BOX.y - targetY);
    const vertical = (offset + TYPE_BOX.height / 2 + FIT_MARGIN) / halfFov;
    const horizontal = (TYPE_BOX.width / 2 + FIT_MARGIN) / (halfFov * aspect);
    return Math.max(vertical, horizontal);
  }

  /** Во сколько раз кадр этой формы отгоняет камеру дальше, чем квадрат. */
  function framingPull(targetY) {
    return fitDistance(camera.aspect, targetY) / fitDistance(1, targetY);
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
    free.target.x = clamp(free.target.x, -FREE.panRange, FREE.panRange);
    free.target.z = clamp(free.target.z, -FREE.panRange, FREE.panRange);
    free.target.y = clamp(free.target.y, 0, ROSE.y);
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
    roll = 0;
    reveal = 1;
    shots[mode](seconds);
    // Отъезжает только афиша: она снимает коробку типографики в лоб. Петле и спуску отъезд
    // вреден, они ходят внутри зала и вылезли бы за колоннаду.
    if (mode === 'still') {
      const distance = position.distanceTo(lookAt);
      const needed = fitDistance(camera.aspect, lookAt.y);
      if (distance < needed) position.sub(lookAt).multiplyScalar(needed / distance).add(lookAt);
    }
    camera.position.copy(position);
    camera.lookAt(lookAt);
    if (roll !== 0) camera.rotateZ(roll);
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

  // Афишу собирает типографика, а знает про сборку камера: только у неё есть время кадра.
  // Наружу уходит доля собранного, а не имя режима, иначе про пролёт узнает вся страница.
  //
  // Точка фокуса это то, на что камера смотрит: в афише цель стоит в коробке типографики, в
  // пролёте её ведёт трасса прицела. Считать это расстояние второй раз в постобработке
  // значит завести вторую правду о кадре, поэтому наружу уходят готовые метры.
  return {
    setMode,
    update,
    motion,
    get reveal() { return reveal; },
    get focusDistance() { return position.distanceTo(lookAt); },
  };
}
