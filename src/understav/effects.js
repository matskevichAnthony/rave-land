import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createGradePass } from '../render/grade.js';
import { createDepthProbe } from '../render/depth-probe.js';
import { PALETTE } from './palette.js';
import { FULLSCREEN_VERTEX, MOTION_GLSL } from './motion-glsl.js';
import { MoshPass } from './pass-mosh.js';

/**
 * Постобработка сцены UNDERSTAV: разрушение ведут данные сцены, а не картинка.
 *
 * Глубина и две матрицы камеры дают на каждый пиксель настоящий вектор экранного смещения,
 * и уже он тянет датамош, разводит каналы, протягивает яркое и рвёт дальний план. Фильтр
 * поверх готового видео так не умеет: там движение приходится угадывать блочным поиском.
 */

const BLOOM_SCALE = 0.5;
const BLOOM_RADIUS = 0.7;
const BLOOM_THRESHOLD = 0.72;

const ROT_CELL_PIXELS = 22;
const TIME_WRAP_SECONDS = 1000;

const REFERENCE_DT = 1 / 60;
const MIN_DT = 1 / 240;
const MAX_DT = 1 / 20;
const MOTION_BASE = 1;
const MOTION_SPEED_GAIN = 0.12;
const MOTION_TURN_GAIN = 0.5;
const MOTION_DRIVE_MAX = 2.5;

const GRADE = {
  saturation: 0.74,
  contrast: 1.12,
  vignette: 0.58,
  warmth: 0.14,
  shadowLift: 0.05,
};

// Один сильный эффект бьёт четыре средних, поэтому по умолчанию ведут MOSH и GHOST,
// а разрушение подпирает их с краю: кадр должен читаться заголовком, а не блоками.
const KNOB_DEFAULTS = {
  mosh: 0.5,
  ghost: 0.55,
  chroma: 0.22,
  melt: 0.25,
  rot: 0.2,
  bloom: 0.9,
  grain: 0.05,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Финальное разрушение одним полноэкранным проходом.
 *
 * Порядок внутри кадра: ROT сдвигает и выедает дальний план блочным шумом (порог в метрах, и стоит
 * он за коробкой типографики, иначе разрушение съедает заголовок), затем по движению подмешивается
 * половинный буфер датамоша,
 * CHROMA разводит красный и синий на длину вектора скорости, MELT тянет яркое вдоль него же.
 * Честный пиксель-сорт в кадре не посчитать, поэтому MELT это направленное протягивание ярких
 * участков: снаружи это те же светлые полосы вдоль оси сортировки.
 *
 * Кириллицы в тексте шейдера нет намеренно: исходник шейдера обязан быть в ASCII.
 */
const TRIP_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    tMosh: { value: null },
    uInverseViewProjection: { value: new THREE.Matrix4() },
    uPreviousViewProjection: { value: new THREE.Matrix4() },
    uTripColor: { value: new THREE.Color(PALETTE.trip) },
    uRotCell: { value: new THREE.Vector2(0.02, 0.02) },
    uMosh: { value: 0 },
    uChroma: { value: 0 },
    uMelt: { value: 0 },
    uRot: { value: 0 },
    uPower: { value: 1 },
    uTime: { value: 0 },
    uNear: { value: 0.1 },
    uFar: { value: 100 },
  },
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform sampler2D tMosh;
    uniform mat4 uInverseViewProjection;
    uniform mat4 uPreviousViewProjection;
    uniform vec3 uTripColor;
    uniform vec2 uRotCell;
    uniform float uMosh;
    uniform float uChroma;
    uniform float uMelt;
    uniform float uRot;
    uniform float uPower;
    uniform float uTime;
    uniform float uNear;
    uniform float uFar;
    varying vec2 vUv;

    ${MOTION_GLSL}

    const float MOTION_REFERENCE = 0.005;
    const float VELOCITY_LIMIT = 0.03;
    const float CHROMA_REACH = 6.0;
    const float CHROMA_MAX = 0.03;
    const float CHROMA_LEAD = 1.0;
    const float CHROMA_LAG = 0.6;
    const int MELT_TAPS = 8;
    const float MELT_REACH = 9.0;
    const float MELT_MAX = 0.12;
    const float MELT_THRESHOLD = 0.5;
    const float ROT_REACH = 0.035;
    const float ROT_RATE = 5.0;
    const float ROT_BITE = 0.06;
    const float ROT_BITE_MIX = 0.72;
    const float ROT_GLOW = 0.2;
    const float ROT_NEAR_METRES = 20.0;
    const float ROT_FAR_METRES = 55.0;

    vec3 substrate(vec2 uv, float moshMix) {
      return mix(texture2D(tDiffuse, uv).rgb, texture2D(tMosh, uv).rgb, moshMix);
    }

    void main() {
      float depth = texture2D(tDepth, vUv).x;
      vec2 velocity = screenVelocity(
        vUv,
        depth,
        uInverseViewProjection,
        uPreviousViewProjection,
        VELOCITY_LIMIT
      ) * uPower;
      float motion = clamp(length(velocity) / MOTION_REFERENCE, 0.0, 1.0);
      float distant = smoothstep(
        ROT_NEAR_METRES,
        ROT_FAR_METRES,
        viewDistance(depth, uNear, uFar)
      );

      vec2 cell = floor(vUv / uRotCell);
      float tick = floor(uTime * ROT_RATE);
      float rot = uRot * distant;
      vec2 uv = clamp(vUv + hash22(cell + tick) * rot * ROT_REACH, vec2(0.0), vec2(1.0));

      float moshMix = uMosh * motion;
      vec2 split = clamp(velocity * uChroma * CHROMA_REACH, -CHROMA_MAX, CHROMA_MAX);
      vec3 color = vec3(
        substrate(clamp(uv + split * CHROMA_LEAD, vec2(0.0), vec2(1.0)), moshMix).r,
        substrate(uv, moshMix).g,
        substrate(clamp(uv - split * CHROMA_LAG, vec2(0.0), vec2(1.0)), moshMix).b
      );

      vec2 stride = clamp(velocity * MELT_REACH, -MELT_MAX, MELT_MAX) / float(MELT_TAPS);
      vec3 melted = color;
      float brightest = luma(color);
      for (int i = 1; i <= MELT_TAPS; i++) {
        vec3 tap = texture2D(tMosh, clamp(uv - stride * float(i), vec2(0.0), vec2(1.0))).rgb;
        float light = luma(tap);
        if (light > brightest && light > MELT_THRESHOLD) {
          brightest = light;
          melted = tap;
        }
      }
      color = mix(color, melted, uMelt * motion);

      // Выеденный блок не заливается ядовитым насухо: сплошной квадрат читается как сбой
      // интерфейса, а подмешанный оставляет под собой картинку и остаётся разрушением.
      float bite = step(1.0 - rot * ROT_BITE, hash21(cell + tick + 3.3)) * ROT_BITE_MIX;
      color = mix(color, uTripColor * (ROT_GLOW + luma(color)), bite);

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

class TripPass extends ShaderPass {
  constructor(mosh) {
    super(TRIP_SHADER);
    this.mosh = mosh;
  }

  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    // Глубину пишет RenderPass, и пишет он именно в буфер чтения
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    this.uniforms.tMosh.value = this.mosh.texture;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }

  setSize(width, height) {
    this.uniforms.uRotCell.value.set(ROT_CELL_PIXELS / width, ROT_CELL_PIXELS / height);
  }
}

function motionPower(dt, motion) {
  const frame = Number.isFinite(dt) && dt > 0 ? dt : REFERENCE_DT;
  const speed = Math.abs(motion?.speed ?? 0);
  const turn = Math.abs(motion?.turn ?? 0);
  const drive = Math.min(
    MOTION_BASE + speed * MOTION_SPEED_GAIN + turn * MOTION_TURN_GAIN,
    MOTION_DRIVE_MAX,
  );
  // Смещение за кадр приводится к опорным 60 кадрам, иначе на просадке смаз вырастет вдвое
  return (drive * REFERENCE_DT) / clamp(frame, MIN_DT, MAX_DT);
}

/** Цвет палитры в том виде, в каком его ждёт цветокоррекция: она работает уже после тонмаппинга. */
const displayColor = (hex) => new THREE.Color(hex).convertLinearToSRGB();

function tuneGrade(grade) {
  const ember = displayColor(PALETTE.emberHalo);
  const moon = displayColor(PALETTE.moon);
  grade.uniforms.uSaturation.value = GRADE.saturation;
  grade.uniforms.uContrast.value = GRADE.contrast;
  grade.uniforms.uVignette.value = GRADE.vignette;
  grade.uniforms.uTint.value.set(
    1 + (ember.r - 1) * GRADE.warmth,
    1 + (ember.g - 1) * GRADE.warmth,
    1 + (ember.b - 1) * GRADE.warmth,
  );
  grade.uniforms.uShadowTint.value.set(
    moon.r * GRADE.shadowLift,
    moon.g * GRADE.shadowLift,
    moon.b * GRADE.shadowLift,
  );
}

function createControls({ mosh, trip, bloom, grade }) {
  const knobs = {
    mosh: {
      label: 'MOSH: блоки тянет по вектору сцены',
      min: 0,
      max: 1,
      step: 0.01,
      get: () => trip.uniforms.uMosh.value,
      set: (value) => {
        trip.uniforms.uMosh.value = value;
        mosh.uniforms.uMosh.value = value;
      },
    },
    ghost: {
      label: 'GHOST: длина следа за движением',
      min: 0,
      max: 0.95,
      step: 0.01,
      get: () => mosh.uniforms.uGhost.value,
      set: (value) => {
        mosh.uniforms.uGhost.value = value;
      },
    },
    chroma: {
      label: 'CHROMA: разъезд красного и синего',
      min: 0,
      max: 1,
      step: 0.01,
      get: () => trip.uniforms.uChroma.value,
      set: (value) => {
        trip.uniforms.uChroma.value = value;
      },
    },
    melt: {
      label: 'MELT: яркое течёт по движению',
      min: 0,
      max: 1,
      step: 0.01,
      get: () => trip.uniforms.uMelt.value,
      set: (value) => {
        trip.uniforms.uMelt.value = value;
      },
    },
    rot: {
      label: 'ROT: разрушение дальнего плана',
      min: 0,
      max: 1,
      step: 0.01,
      get: () => trip.uniforms.uRot.value,
      set: (value) => {
        trip.uniforms.uRot.value = value;
      },
    },
    bloom: {
      label: 'BLOOM: свечение углей',
      min: 0,
      max: 2,
      step: 0.02,
      get: () => bloom.strength,
      set: (value) => {
        bloom.strength = value;
      },
    },
    grain: {
      label: 'GRAIN: зерно плёнки',
      min: 0,
      max: 0.16,
      step: 0.005,
      get: () => grade.uniforms.uGrain.value,
      set: (value) => {
        grade.uniforms.uGrain.value = value;
      },
    },
  };

  for (const [name, knob] of Object.entries(knobs)) {
    const write = knob.set;
    knob.set = (value) => write(clamp(Number(value) || 0, knob.min, knob.max));
    knob.set(KNOB_DEFAULTS[name]);
  }
  return knobs;
}

export function createEffects({ renderer, scene, camera }) {
  const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
  // Без текстуры глубины у композитора глубину не прочитать: буфер глубины по умолчанию
  // это renderbuffer, а из него шейдер не берёт. Второй буфер композитора клонируется вместе
  // со своей текстурой, поэтому проходы читают глубину того буфера, в который писал RenderPass.
  const sceneTarget = new THREE.WebGLRenderTarget(buffer.x, buffer.y, {
    type: THREE.HalfFloatType,
    depthTexture: new THREE.DepthTexture(buffer.x, buffer.y),
  });

  const composer = new EffectComposer(renderer, sceneTarget);

  const mosh = new MoshPass();
  const trip = new TripPass(mosh);
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(buffer.x * BLOOM_SCALE, buffer.y * BLOOM_SCALE),
    KNOB_DEFAULTS.bloom,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD,
  );
  const grade = createGradePass();
  tuneGrade(grade);

  // Порядок: сцена отдаёт цвет и глубину, датамош копит себя на свежей глубине, трип-проход
  // собирает разрушение ещё в линейном HDR, чтобы свечение подхватило сами следы, и только
  // потом тонмаппинг и цветокоррекция, иначе зерно размылось бы свечением.
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(mosh);
  composer.addPass(trip);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(grade);

  const controls = createControls({ mosh, trip, bloom, grade });

  const depthProbe = createDepthProbe({ renderer, scene, camera });

  const view = new THREE.Matrix4();
  const viewProjection = new THREE.Matrix4();
  const inverseViewProjection = new THREE.Matrix4();
  const previousViewProjection = new THREE.Matrix4();
  let firstFrame = true;

  const feedMotion = (pass, power) => {
    pass.uniforms.uInverseViewProjection.value.copy(inverseViewProjection);
    pass.uniforms.uPreviousViewProjection.value.copy(previousViewProjection);
    pass.uniforms.uPower.value = power;
  };

  const resize = (width, height) => {
    composer.setSize(width, height);
    // Композитор раздал свой размер всем проходам, поэтому уменьшенное свечение возвращаем после
    bloom.setSize(width * BLOOM_SCALE, height * BLOOM_SCALE);
    depthProbe.setSize(width, height);
  };

  // Композитор с чужой мишенью считает её размер экранным и домножает его на плотность пикселей
  // ещё раз, поэтому размер раздаётся сразу, а не ждёт первого ресайза окна.
  const screen = renderer.getSize(new THREE.Vector2());
  resize(screen.x, screen.y);

  return {
    render(dt, elapsed, motion) {
      camera.updateMatrixWorld();
      view.copy(camera.matrixWorld).invert();
      viewProjection.multiplyMatrices(camera.projectionMatrix, view);
      inverseViewProjection.copy(viewProjection).invert();
      if (firstFrame) {
        previousViewProjection.copy(viewProjection);
        firstFrame = false;
      }

      const power = motionPower(dt, motion);
      feedMotion(mosh, power);
      feedMotion(trip, power);
      trip.uniforms.uNear.value = camera.near;
      trip.uniforms.uFar.value = camera.far;
      const time = Number.isFinite(elapsed) ? elapsed % TIME_WRAP_SECONDS : 0;
      trip.uniforms.uTime.value = time;
      grade.uniforms.uTime.value = time;

      // Глубина непрозрачной сцены снимается до её отрисовки: воздуху нужно знать, где камень,
      // ещё до того, как он ляжет поверх него.
      depthProbe.update();
      composer.render(dt);
      previousViewProjection.copy(viewProjection);
    },

    resize,

    controls,
  };
}
