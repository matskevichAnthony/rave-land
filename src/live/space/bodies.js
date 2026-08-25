/**
 * Тела: объёмные куски, на которые натянут живой кадр.
 *
 * Тело здесь не модель и не украшение, а второй показ того же самого кадра. Текстура у него
 * одна и та же с фоном, поэтому в зале это читается не как «поверх видео положили фигуру», а
 * как будто картинка местами вспухла и оторвалась от плоскости. Чужой геометрии, которой в
 * кадре нет, тут нет тоже: тела показывают ровно то, что уже показывает экран.
 *
 * Кожа у тела двойная, и переключается она одной ручкой. С одного края кадр натянут на тело
 * развёрткой и едет вместе с ним, с другого тело не имеет своей картинки вовсе и показывает
 * то, что за ним, преломлённое по нормали. Первое читается как экран, свёрнутый в фигуру,
 * второе как стекло, и между ними вся шкала.
 *
 * Форму тело меняет по-настоящему, а не мятием: пара форм лежит в атрибутах, а шейдер их
 * смешивает (см. morph.js). Шум остался сверху отдельной ручкой, он мнёт уже перетёкшую
 * поверхность. Перетекание запускает удар, у каждого тела своя доля секунды на переход и своя
 * очередь форм, иначе два десятка тел щёлкают разом и слой читается перелистыванием слайдов.
 *
 * Живут тела сами. Каждое рождается с отмеренным сроком в ударах, растёт из точки, дрейфует,
 * крутится, мнётся шумом и на исходе срока схлопывается обратно в точку. Ни рождение, ни
 * смерть не требуют руки, и это главное требование к слою: за пультом никого нет.
 *
 * Прозрачности нет нигде. Тело появляется и уходит размером, а не выцветанием, потому что
 * полупрозрачные тела пришлось бы сортировать по глубине каждый кадр, и на два десятка тел
 * это дороже всего остального слоя вместе взятого.
 */

import * as THREE from 'three';
import { NOISE_GLSL } from './noise-glsl.js';
import { MIX_SHAPE, createShapes, otherThan, someShape } from './morph.js';

// Каталог форм живёт в morph.js, где он и определён вместе с самими формами. Пульт и автопилот
// берут его отсюда: путь импорта у них уже проложен, и ломать его ради переезда незачем.
export { SHAPES, DEFAULT_SHAPE } from './morph.js';

// Коробка, в которой тела рождаются и живут без трипа. Уже кадра по всем осям: тело, рождённое
// у самого края, зал видит половиной, и рождение читается вылезшим из-за рамки мусором.
const FIELD = { x: 3.4, y: 2.1, near: -3.5, far: 1.2 };

// На трипе коробка кончается. Тело заводится далеко впереди и идёт на камеру, поэтому глубина
// растягивается, а разлёт в стороны растёт: мимо зрителя должно проносить, а не только сквозь
// центр экрана. Скорость дана в метрах за секунду при полном трипе.
const RUSH = { near: -17, far: -4.5, spread: 2.2, speed: 2.8 };

// Дальше этой отметки тело не видит ни один ракурс: камера отходит от центра максимум на семь
// метров, и всё, что уехало за неё, снимается сразу, не доживая свой срок в ударах.
const BEHIND = 8;

const DRIFT = 0.5;
const SPIN = 0.9;
const SIZE_RANGE = [0.35, 1.15];

// Срок жизни в ударах: от двух тактов до полутора десятков. Ровный срок у всех превращает
// слой в мигалку, где тела появляются и гаснут пачками.
const LIFE_BEATS = [8, 48];

// Рост и схлопывание: доля пути к цели за кадр. Рождение быстрее смерти, потому что
// появление обязано попасть в удар, а уход не обязан попадать ни во что.
const GROW = 0.12;
const SHRINK = 0.08;
const GONE = 0.02;

// Насколько удар раздувает тело сверх его размера и как быстро оно садится обратно.
const PUNCH_GROWTH = 0.22;
const PUNCH_FALL = 0.1;

// Полосы звука разведены по разным ручкам тела, иначе на громком месте всё дёргается разом и
// различить в этом полосы невозможно. Низ раздувает медленно и надолго, это дыхание, а не
// толчок. Верх слышен мелкой дробью, и тело обязано на неё дрожать мятием и оборотами.
// Середина торопит перетекание форм, общий уровень гонит дрейф.
const LOW_SWELL = 0.3;
const LEVEL_SWELL = 0.25;
const MID_HASTE = 0.8;
const HIGH_WOBBLE = 0.45;
const HAT_WOBBLE = 0.8;
const HAT_SPIN = 1.4;
const DRIFT_IDLE = 0.55;
const DRIFT_LOUD = 0.9;

// Удар трогает не все тела, а меньшую их часть: если переход запускать у всех сразу, слой
// перелистывается целиком и объём пропадает. Порог отсекает шорох, чтобы форма не менялась в
// тишине. Переход укладывается в доли секунды, у каждого тела свои.
const FLIP_SHARE = 0.3;
const FLIP_STRIKE = 0.25;
const FLIP_TIME = [0.45, 1.4];

// Своё пополнение: если бочка бьёт, а мест в зале ещё хватает, слой доливает тело сам, не
// дожидаясь команды снаружи. Промежуток отмерян так, чтобы на любом живом темпе рождалось не
// больше одного тела на удар.
const SELF_HIT = 0.35;
const SELF_GAP = 0.18;
const IDLE_ROOM = 6;

const BODY_SHADER = {
  uniforms: {
    tFrame: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uBlend: { value: 0 },
    uWobble: { value: 0 },
    uGlass: { value: 0 },
    uPunch: { value: 0 },
    uLevel: { value: 0 },
    uHaze: { value: 0 },
    uSeed: { value: 0 },
  },
  vertexShader: `
    attribute vec3 aTarget;
    attribute vec3 aTargetNormal;
    uniform float uTime;
    uniform float uBlend;
    uniform float uWobble;
    uniform float uPunch;
    uniform float uSeed;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;
    varying float vDepth;

    ${NOISE_GLSL}

    const float MORPH_SCALE = 1.7;
    const float MORPH_SPEED = 0.55;
    const float MORPH_REACH = 0.65;
    const float MORPH_PUNCH = 0.5;
    // Ниже этой длины смешанная нормаль считается вырожденной: у противоположных форм нормали
    // на середине пути гасят друг друга, и normalize отдал бы дырку в поверхности.
    const float EDGE = 0.0001;

    void main() {
      vUv = uv;
      // Плавность перехода лежит здесь, а не в счётчике времени: линейный лерп трогается и
      // встаёт рывком, и переход читается склейкой двух кадров вместо перетекания.
      float blend = uBlend * uBlend * (3.0 - 2.0 * uBlend);
      vec3 shape = mix(position, aTarget, blend);
      vec3 mixed = mix(normal, aTargetNormal, blend);
      vec3 face = dot(mixed, mixed) > EDGE ? normalize(mixed) : vec3(0.0, 1.0, 0.0);
      float wobble = fbm3(shape * MORPH_SCALE + vec3(uSeed, uSeed, uTime * MORPH_SPEED));
      vec3 mangled = shape + face * wobble * uWobble * MORPH_REACH * (1.0 + uPunch * MORPH_PUNCH);
      vec4 view = modelViewMatrix * vec4(mangled, 1.0);
      vNormal = normalize(normalMatrix * face);
      vView = -view.xyz;
      vDepth = -view.z;
      gl_Position = projectionMatrix * view;
    }
  `,
  fragmentShader: `
    uniform sampler2D tFrame;
    uniform vec2 uResolution;
    uniform float uGlass;
    uniform float uLevel;
    uniform float uHaze;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;
    varying float vDepth;

    // Насколько нормаль уводит луч в сторону: это и есть толщина стекла.
    const float BEND = 0.22;
    // Край тела светится тем сильнее, чем громче в зале: без него тело на своём же кадре
    // теряет силуэт и читается пятном другой яркости, а не объёмом.
    const float RIM = 0.55;
    // Где начинается и где кончается дымка вдаль, в метрах от камеры.
    const float HAZE_NEAR = 5.0;
    const float HAZE_FAR = 16.0;

    void main() {
      vec3 eye = normalize(vView);
      // Модуль, а не отсечка по нулю: тела двусторонние, и с изнанки нормаль приходит
      // вывернутой. Без модуля вся изнанка светилась бы кромкой на полную.
      float facing = abs(dot(normalize(vNormal), eye));
      vec2 screen = gl_FragCoord.xy / uResolution;
      vec2 bend = vNormal.xy * (1.0 - facing) * BEND;
      vec3 through = texture2D(tFrame, clamp(screen + bend, vec2(0.0), vec2(1.0))).rgb;
      vec3 skin = texture2D(tFrame, fract(vUv)).rgb;
      vec3 color = mix(skin, through, uGlass);
      color += pow(1.0 - facing, 3.0) * RIM * (0.25 + uLevel * 0.75);
      // Дымка вдаль берётся цветом самого кадра, а не серым. Серый выдал бы, что за телами
      // стоит пустая сцена, а так дальнее тело растворяется ровно в том, что показывает экран.
      // Цвет берётся уже взятым насквозь: лишняя выборка тут стоила бы дороже точности.
      float haze = smoothstep(HAZE_NEAR, HAZE_FAR, vDepth) * uHaze;
      gl_FragColor = vec4(mix(color, through, haze), 1.0);
    }
  `,
};

const between = (min, max) => min + Math.random() * (max - min);

export function createBodies({ texture, resolution }) {
  const group = new THREE.Group();
  const shapes = createShapes();
  const bodies = [];
  let choice = MIX_SHAPE;
  // Слой помнит последний заказ снаружи, чтобы доливать тела самому в тех же границах. Пока
  // заказа не было, зал считается небольшим: пустой экран хуже лишнего тела.
  let seats = IDLE_ROOM;
  let trip = 0;
  let sinceBirth = 0;

  function skin() {
    const material = new THREE.ShaderMaterial({
      ...BODY_SHADER,
      uniforms: THREE.UniformsUtils.clone(BODY_SHADER.uniforms),
      // Двусторонние все без разбора: перетекание свободно ходит между замкнутым комом и
      // открытым полотном, и отсечение изнанки моргало бы дырой ровно на середине перехода.
      side: THREE.DoubleSide,
    });
    material.uniforms.tFrame.value = texture;
    material.uniforms.uResolution.value = resolution;
    material.uniforms.uSeed.value = Math.random() * 100;
    return material;
  }

  /**
   * Новое тело в кадре.
   *
   * Форма с пульта становится домом тела: оно уходит от неё к соседней и возвращается обратно,
   * поэтому выбранное на пульте остаётся узнаваемым и при этом не стоит на месте. В режиме
   * «вразнобой» дома нет, и тело просто идёт по формам дальше, никогда не повторяясь подряд.
   */
  function born(level) {
    const home = choice === MIX_SHAPE ? null : choice;
    const from = home ?? someShape();
    const to = otherThan(from);
    const mesh = new THREE.Mesh(shapes.take(from, to), skin());
    mesh.position.set(
      between(-FIELD.x, FIELD.x) * (1 + trip * RUSH.spread),
      between(-FIELD.y, FIELD.y) * (1 + trip * RUSH.spread),
      between(
        FIELD.near + (RUSH.near - FIELD.near) * trip,
        FIELD.far + (RUSH.far - FIELD.far) * trip,
      ),
    );
    mesh.rotation.set(between(0, Math.PI), between(0, Math.PI), between(0, Math.PI));
    mesh.scale.setScalar(0.001);
    group.add(mesh);
    bodies.push({
      mesh,
      home,
      from,
      to,
      blend: 0,
      flipping: false,
      speed: 1 / between(FLIP_TIME[0], FLIP_TIME[1]),
      // Громкое место рожает крупные тела: так рост зала виден размером, а не только числом.
      size: between(SIZE_RANGE[0], SIZE_RANGE[1]) * (0.7 + level * 0.5),
      life: Math.round(between(LIFE_BEATS[0], LIFE_BEATS[1])),
      dying: false,
      punch: 0,
      drift: new THREE.Vector3(
        between(-DRIFT, DRIFT),
        between(-DRIFT, DRIFT),
        between(-DRIFT, DRIFT) * 0.5,
      ),
      spin: new THREE.Vector3(between(-SPIN, SPIN), between(-SPIN, SPIN), between(-SPIN, SPIN)),
    });
    sinceBirth = 0;
  }

  function retire(body) {
    body.life = 0;
    body.dying = true;
  }

  function drop(body) {
    group.remove(body.mesh);
    body.mesh.material.dispose();
    shapes.give(body.mesh.geometry);
  }

  /** Форма дошла до конца: что было целью, стало собой, и назначается следующая цель. */
  function settle(body) {
    body.from = body.to;
    body.to = body.home && body.from !== body.home ? body.home : otherThan(body.from);
    body.blend = 0;
    body.flipping = false;
    shapes.aim(body.mesh.geometry, body.from, body.to);
  }

  return {
    group,
    get count() {
      return bodies.length;
    },
    setShape(id) {
      choice = id;
    },
    /**
     * Новое тело по заказу снаружи.
     *
     * Когда мест больше нет, старейшее отправляется умирать, а не отменяется новое. Отказ на
     * полном поле означал бы, что после первой минуты слой замирает в одном составе, а смысл
     * его в обороте: тела должны сменяться, а не накопиться и остаться.
     */
    spawn({ room, level } = {}) {
      seats = room ?? seats;
      if (bodies.length >= seats) retire(bodies[0]);
      born(level ?? 0);
    },
    /** Срок идёт в ударах, а не в секундах: слой обязан сменяться в такт, а не по часам. */
    age() {
      for (const body of bodies) {
        body.life -= 1;
        if (body.life <= 0) body.dying = true;
      }
    },
    clear() {
      for (const body of bodies) retire(body);
    },
    /**
     * Кадр слоя: движение, перетекание форм, морф и уборка умерших.
     *
     * Умершее тело снимается со сцены здесь же, а не в отдельном проходе: список один, и
     * второй обход ради чистоты стоил бы столько же, сколько вся остальная работа над ним.
     *
     * Поля звука приходят готовыми числами от нуля до единицы. Отдельно идут hit, сила бочки
     * этого кадра, и strike, сила любого удара: по первому тела раздуваются и доливаются, по
     * второму перетекают в новую форму.
     */
    step({ dt, time, level, low, mid, high, hat, hit, strike, morph, glass, trip: journey }) {
      trip = journey;
      sinceBirth += dt;
      if (hit > SELF_HIT && bodies.length < seats && sinceBirth > SELF_GAP) born(level);

      const haste = 1 + mid * MID_HASTE;
      const wobble = morph * (1 + high * HIGH_WOBBLE + hat * HAT_WOBBLE);
      const twirl = dt * (1 + hat * HAT_SPIN);
      const pace = dt * (DRIFT_IDLE + level * DRIFT_LOUD);
      const rush = trip * RUSH.speed * dt;
      const swell = 1 + low * LOW_SWELL + level * LEVEL_SWELL;

      for (let index = bodies.length - 1; index >= 0; index -= 1) {
        const body = bodies[index];
        const { mesh } = body;
        if (hit > body.punch) body.punch = hit;
        else body.punch += (0 - body.punch) * PUNCH_FALL;

        if (body.flipping) {
          body.blend = Math.min(1, body.blend + body.speed * haste * dt);
          if (body.blend === 1) settle(body);
        } else if (strike > FLIP_STRIKE && Math.random() < FLIP_SHARE * strike) {
          body.flipping = true;
        }

        mesh.position.addScaledVector(body.drift, pace);
        mesh.position.z += rush;
        mesh.rotation.x += body.spin.x * twirl;
        mesh.rotation.y += body.spin.y * twirl;
        mesh.rotation.z += body.spin.z * twirl;
        // Ушедшее за спину не возвращается и срока не досиживает: схлопывать его в точку
        // некому показывать, а место в зале оно занимает.
        if (mesh.position.z > BEHIND) body.dying = true;

        const target = body.dying ? 0 : body.size * swell * (1 + PUNCH_GROWTH * body.punch);
        const now = mesh.scale.x;
        mesh.scale.setScalar(now + (target - now) * (body.dying ? SHRINK : GROW));

        const uniforms = mesh.material.uniforms;
        uniforms.uTime.value = time;
        uniforms.uBlend.value = body.blend;
        uniforms.uWobble.value = wobble;
        uniforms.uGlass.value = glass;
        uniforms.uPunch.value = body.punch;
        uniforms.uLevel.value = level;
        uniforms.uHaze.value = trip;

        if (body.dying && mesh.scale.x < GONE) {
          drop(body);
          bodies.splice(index, 1);
        }
      }
    },
    dispose() {
      for (const body of bodies) drop(body);
      bodies.length = 0;
      shapes.dispose();
    },
  };
}
