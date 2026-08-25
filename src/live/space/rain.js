/**
 * Ливень знаков в объёме: рябь, идущая по самому кадру, а не наклейка поверх него.
 *
 * Зелёная катакана узнаётся мгновенно и ровно этим бесполезна: зал видит цитату, а не свой
 * сет. Поэтому здесь нет ни зелёного, ни катаканы. Цвет каждого знака берётся из живого кадра
 * в той точке экрана, где знак оказался, так что ливень всегда одного цвета с картинкой под
 * ним и читается её собственной рябью. На чёрном месте кадра остаётся еле заметный уголёк,
 * иначе знаки там пропадали бы совсем и ливень рвался бы дырами.
 *
 * Живёт ливень в глубине. Колонки расставлены по всей коробке от ближнего плана до дальнего,
 * дальние стоят шире и выше, потому что перспектива сводит их к центру, и без этого дальний
 * план оставался бы пустым. Знаки при этом всюду одного размера в метрах, поэтому дальние
 * мельче и тусклее сами по себе, без единой строчки на это.
 *
 * Весь ливень это один InstancedMesh и один вызов отрисовки. Положение знака считается в
 * вершинном шейдере от времени и от собственных чисел экземпляра, поэтому в кадре на ливень не
 * приходится ни одной строчки работы процессора: ни матриц, ни обхода восьми сотен знаков.
 * Плотность режется числом видимых экземпляров, и на нуле слой не стоит вообще ничего.
 */

import * as THREE from 'three';

const COLUMNS = 80;
const PER_COLUMN = 10;
const DROPS = COLUMNS * PER_COLUMN;

// Коробка ливня. Ближний край чуть впереди центра сцены, дальний уходит за тела. Полуширина и
// полувысота растут с глубиной ровно затем, чтобы дальние колонки не собирались в столбик по
// середине экрана.
const NEAR = 0.6;
const FAR = -8.5;
const SPREAD = [3.6, 10.5];
const REACH = [2.2, 6.2];

// Доля хода колонки за секунду. Ниже этого колонка стоит, выше превращается в сплошную черту.
const SPEED = [0.3, 0.8];

const TRAIL_STEP = 0.24;
const GLYPH_SIZE = 0.15;

// Атлас: знаки рисуются один раз в холст, дальше видеокарта берёт их оттуда. Латиница, цифры и
// служебные знаки, то есть то, чем набран любой лог. Клетка в 64 пикселя даёт на ближнем плане
// знак примерно во весь его экранный размер, дальше работают мипы.
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<>[]{}/\\|+*=#$%&@?!';
const ATLAS_SIDE = Math.ceil(Math.sqrt(GLYPHS.length));
const ATLAS_CELL = 64;
// Знак занимает не всю клетку: поля нужны, чтобы мипы не смешивали соседей на дальнем плане.
const GLYPH_INK = 0.72;

// Как часто знак сменяется на другой, раз в секунду. Реже, и ливень читается падающим текстом,
// чаще, и знаки сливаются в мерцание без формы.
const CHURN = 9;

const SPEED_LOUD = 0.6;
const SPEED_TICK = 0.9;
const GAIN_IDLE = 0.35;
const GAIN_LOUD = 0.5;
const GAIN_TOP = 0.35;
const SIZE_TICK = 0.25;

const RAIN_SHADER = {
  uniforms: {
    tAtlas: { value: null },
    tFrame: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uHaste: { value: 1 },
    uSize: { value: GLYPH_SIZE },
    uGain: { value: 0 },
  },
  vertexShader: `
    attribute vec4 aColumn;
    attribute vec2 aDrop;
    uniform float uTime;
    uniform float uHaste;
    uniform float uSize;
    varying vec2 vGlyph;
    varying float vShade;

    const float TAIL = ${PER_COLUMN}.0;
    const float STEP = ${TRAIL_STEP.toFixed(3)};
    const float ATLAS = ${ATLAS_SIDE}.0;
    const float MARKS = ${GLYPHS.length}.0;
    const float CHURN = ${CHURN.toFixed(1)};
    // Ширина мягкой кромки, на которой знак гаснет у верха и низа хода колонки.
    const float EDGE = 0.35;

    float scatter(float seed) {
      return fract(sin(seed * 12.9898) * 43758.5453);
    }

    void main() {
      float reach = aColumn.w;
      float hidden = TAIL * STEP;
      float fall = fract(aDrop.y + uTime * aColumn.z * uHaste);
      // Ход считается от точки, где хвост целиком выше кадра, до точки, где он целиком ниже:
      // колонка обязана входить и выходить, а не возникать посреди экрана.
      float y = mix(reach + hidden, -reach - hidden, fall) + aDrop.x * STEP;
      float inside = smoothstep(-reach - EDGE, -reach + EDGE, y)
        * smoothstep(reach + EDGE, reach - EDGE, y);
      float tail = 1.0 - aDrop.x / TAIL;
      vShade = inside * tail * tail;

      // Квадрат разворачивается уже в системе камеры, поэтому всегда смотрит в зал, а размер
      // задан в метрах: дальний знак мельчает сам, перспективой, без единого счёта на это.
      vec4 view = modelViewMatrix * vec4(aColumn.x, y, aColumn.y, 1.0);
      view.xy += position.xy * uSize;
      gl_Position = projectionMatrix * view;

      float tick = floor(uTime * CHURN + aDrop.y * 13.0);
      float cell = floor(scatter(aDrop.y * 91.0 + aDrop.x * 7.0 + tick) * MARKS);
      vec2 slot = vec2(mod(cell, ATLAS), floor(cell / ATLAS));
      vGlyph = (slot + vec2(uv.x, 1.0 - uv.y)) / ATLAS;
    }
  `,
  fragmentShader: `
    uniform sampler2D tAtlas;
    uniform sampler2D tFrame;
    uniform vec2 uResolution;
    uniform float uGain;
    varying vec2 vGlyph;
    varying float vShade;

    // Ниже этого знак всё равно не виден, и пиксель дешевле выбросить, чем смешивать.
    const float SPARK = 0.03;
    // Чем светится знак там, где кадр совсем чёрный.
    const vec3 EMBER = vec3(0.06, 0.07, 0.08);

    void main() {
      float mark = texture2D(tAtlas, vGlyph).r * vShade;
      if (mark < SPARK) discard;
      vec3 lit = texture2D(tFrame, gl_FragCoord.xy / uResolution).rgb;
      gl_FragColor = vec4(max(lit, EMBER) * mark * uGain, 1.0);
    }
  `,
};

const between = (min, max) => min + Math.random() * (max - min);

/** Атлас знаков: белым по чёрному, читается только красный канал. */
function inkAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIDE * ATLAS_CELL;
  canvas.height = ATLAS_SIDE * ATLAS_CELL;
  const ink = canvas.getContext('2d');
  ink.fillStyle = '#000';
  ink.fillRect(0, 0, canvas.width, canvas.height);
  ink.fillStyle = '#fff';
  ink.font = `${Math.round(ATLAS_CELL * GLYPH_INK)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ink.textAlign = 'center';
  ink.textBaseline = 'middle';
  for (let index = 0; index < GLYPHS.length; index += 1) {
    const column = index % ATLAS_SIDE;
    const row = Math.floor(index / ATLAS_SIDE);
    ink.fillText(GLYPHS[index], (column + 0.5) * ATLAS_CELL, (row + 0.55) * ATLAS_CELL);
  }
  return canvas;
}

/**
 * Числа экземпляров: колонка и место знака в её хвосте.
 *
 * Колонки раскладываются в случайном порядке, а не решёткой, потому что плотность режется
 * обрезанием списка: у случайного порядка любая его часть уже разбросана по всей коробке, и
 * ручка убирает колонки равномерно, а не выедает угол.
 */
function sow() {
  const column = new Float32Array(DROPS * 4);
  const drop = new Float32Array(DROPS * 2);
  for (let index = 0; index < COLUMNS; index += 1) {
    const depth = between(FAR, NEAR);
    const away = (NEAR - depth) / (NEAR - FAR);
    const spread = SPREAD[0] + (SPREAD[1] - SPREAD[0]) * away;
    const reach = REACH[0] + (REACH[1] - REACH[0]) * away;
    const speed = between(SPEED[0], SPEED[1]);
    const seed = Math.random();
    for (let rank = 0; rank < PER_COLUMN; rank += 1) {
      const at = (index * PER_COLUMN + rank) * 4;
      column[at] = between(-spread, spread);
      column[at + 1] = depth;
      column[at + 2] = speed;
      column[at + 3] = reach;
      const mark = (index * PER_COLUMN + rank) * 2;
      drop[mark] = rank;
      drop[mark + 1] = seed;
    }
  }
  return { column, drop };
}

export function createRain({ texture, resolution }) {
  const atlas = new THREE.CanvasTexture(inkAtlas());
  atlas.colorSpace = THREE.NoColorSpace;

  const geometry = new THREE.PlaneGeometry(1, 1);
  const { column, drop } = sow();
  geometry.setAttribute('aColumn', new THREE.InstancedBufferAttribute(column, 4));
  geometry.setAttribute('aDrop', new THREE.InstancedBufferAttribute(drop, 2));

  const material = new THREE.ShaderMaterial({
    ...RAIN_SHADER,
    uniforms: THREE.UniformsUtils.clone(RAIN_SHADER.uniforms),
    // Складывается, а не смешивается: у сложения нет порядка, и восемь сотен знаков не нужно
    // сортировать по глубине ни разу за сет. Глубина при этом читается, тела ливень закрывают.
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  material.uniforms.tAtlas.value = atlas;
  material.uniforms.tFrame.value = texture;
  material.uniforms.uResolution.value = resolution;

  const mesh = new THREE.InstancedMesh(geometry, material, DROPS);
  // Матрицы экземпляров не заполняются и не читаются: положение знака целиком выводится в
  // шейдере. По той же причине отсечение по объёму снято, иначе оно считалось бы по пустым
  // матрицам и вырезало бы весь ливень разом.
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.visible = false;
  mesh.renderOrder = 1;

  return {
    mesh,
    /** Ручка ведёт плотность: лишние колонки просто не доходят до видеокарты. */
    setDensity(amount) {
      const share = Math.min(Math.max(amount, 0), 1);
      const columns = Math.round(share * COLUMNS);
      mesh.count = columns * PER_COLUMN;
      mesh.visible = columns > 0;
    },
    /** Звук ведёт яркость и скорость: плотность на слух не меняется, она дело руки. */
    step({ time, level, high, hat }) {
      const uniforms = material.uniforms;
      uniforms.uTime.value = time;
      uniforms.uHaste.value = 1 + level * SPEED_LOUD + hat * SPEED_TICK;
      uniforms.uGain.value = GAIN_IDLE + level * GAIN_LOUD + high * GAIN_TOP;
      uniforms.uSize.value = GLYPH_SIZE * (1 + hat * SIZE_TICK);
    },
    dispose() {
      mesh.dispose();
      geometry.dispose();
      material.dispose();
      atlas.dispose();
    },
  };
}
