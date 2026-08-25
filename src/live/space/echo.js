/**
 * Эхо-тоннель: слой подмешивает в себя собственный прошлый кадр, слегка увеличенный и
 * подкрученный вокруг центра.
 *
 * Из этого получается бесконечный коридор, собранный из самого видео: всё, что произошло на
 * экране, не исчезает, а уезжает наружу через край, уменьшаясь и тускнея. Тела оставляют за
 * собой шлейф, вспышка на бочке разворачивается кольцом. Своего рисунка эхо не приносит ни
 * одного, поэтому и не приедается: зал видит свой же кадр, у которого появилась память.
 *
 * Обратная связь не уходит в белое по построению, а не по подобранным числам. В накопитель
 * пишется максимум из двух величин: свежего кадра и прошлого, умноженного на затухание строго
 * меньше единицы. Максимум не может превысить самое яркое из того, что в него положили, а
 * каждое следующее поколение эха умножается на затухание ещё раз, поэтому ряд сходится.
 * Потолок затухания взят из времени жизни следа: при 0.86 за кадр след держится около сорока
 * кадров, то есть примерно две трети секунды, и за это время успевает пройти видимый путь к
 * краю. Выше этого он живёт дольше кадра ручки и мажет весь экран в одно пятно.
 *
 * Накопитель считается в половину холста. Он и так размыт увеличением и затуханием, разницы в
 * зале не видно никакой, а стоит он вчетверо дешевле и по памяти, и по пропускной способности.
 * Слой пишется в полный размер, потому что именно он идёт на экран.
 *
 * Пока трипа нет, здесь не заведено ни одной текстуры и не посчитано ни одного прохода: буферы
 * появляются в первом же кадре, где ручка отошла от нуля, и остаются, чтобы её дрожание не
 * пересоздавало их каждый кадр.
 */

import * as THREE from 'three';

const HALF = 0.5;

// Затухание следа за кадр и шаг увеличения. Оба растут от ручки: на малом трипе след живёт
// пару кадров и читается смазом движения, на полном разворачивается в коридор.
const DECAY = [0.5, 0.86];
const PULL = [1.004, 1.045];
const TURN = [0.0, 0.02];

// Кадр, под который посчитаны шаги за кадр. На просадке шаг растягивается по времени, иначе
// тоннель на медленной машине идёт вдвое медленнее, чем на быстрой.
const FRAME = 1 / 60;

// Доля эха в готовом кадре при полном трипе. Дальше картинка перестаёт быть источником и
// становится собственным следом, в котором уже не разобрать, что показывает экран.
const SHARE = 0.62;

// Звук ускоряет наезд тоннеля: на удар коридор дёргается вперёд.
const PULL_HIT = 0.03;
const TURN_LOUD = 0.012;

const QUAD_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const TRAIL_SHADER = {
  uniforms: {
    tLayer: { value: null },
    tEcho: { value: null },
    uDecay: { value: 0 },
    uPull: { value: 1 },
    uTurn: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: QUAD_VERTEX,
  fragmentShader: `
    uniform sampler2D tLayer;
    uniform sampler2D tEcho;
    uniform float uDecay;
    uniform float uPull;
    uniform float uTurn;
    uniform float uAspect;
    varying vec2 vUv;

    void main() {
      vec2 centred = (vUv - 0.5) * vec2(uAspect, 1.0);
      float spin = uTurn;
      vec2 turned = vec2(
        centred.x * cos(spin) - centred.y * sin(spin),
        centred.x * sin(spin) + centred.y * cos(spin)
      ) / uPull;
      vec2 back = turned / vec2(uAspect, 1.0) + 0.5;
      vec3 tail = texture2D(tEcho, back).rgb * uDecay;
      gl_FragColor = vec4(max(tail, texture2D(tLayer, vUv).rgb), 1.0);
    }
  `,
};

const SHOW_SHADER = {
  uniforms: {
    tLayer: { value: null },
    tEcho: { value: null },
    uShare: { value: 0 },
  },
  vertexShader: QUAD_VERTEX,
  fragmentShader: `
    uniform sampler2D tLayer;
    uniform sampler2D tEcho;
    uniform float uShare;
    varying vec2 vUv;

    void main() {
      // Смешивание, а не сложение: там, где ничего не менялось, эхо совпадает со свежим
      // кадром, и смесь возвращает его как есть. Экран светлеет ровно там, где след разошёлся
      // с картинкой, то есть в самом тоннеле, и нигде больше.
      vec3 fresh = texture2D(tLayer, vUv).rgb;
      gl_FragColor = vec4(mix(fresh, texture2D(tEcho, vUv).rgb, uShare), 1.0);
    }
  `,
};

const reach = (span, amount) => span[0] + (span[1] - span[0]) * amount;

function pass(shader) {
  const material = new THREE.ShaderMaterial({
    ...shader,
    uniforms: THREE.UniformsUtils.clone(shader.uniforms),
    depthTest: false,
    depthWrite: false,
  });
  const geometry = new THREE.PlaneGeometry(2, 2);
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));
  return { scene, material, geometry };
}

const buffer = (width, height, depth) => new THREE.WebGLRenderTarget(width, height, {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: depth,
  stencilBuffer: false,
});

export function createEcho() {
  const trail = pass(TRAIL_SHADER);
  const show = pass(SHOW_SHADER);
  const flat = new THREE.Camera();

  let width = 1;
  let height = 1;
  let layer = null;
  let read = null;
  let write = null;
  let asleep = true;

  function build() {
    layer = buffer(width, height, true);
    read = buffer(Math.round(width * HALF), Math.round(height * HALF), false);
    write = buffer(Math.round(width * HALF), Math.round(height * HALF), false);
  }

  function resize() {
    layer.setSize(width, height);
    read.setSize(Math.round(width * HALF), Math.round(height * HALF));
    write.setSize(Math.round(width * HALF), Math.round(height * HALF));
    asleep = true;
  }

  return {
    setSize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      if (layer) resize();
    },

    /**
     * Куда рисовать слой в этом кадре.
     *
     * Пока ручка на нуле, тут не выделяется и не считается ничего, а слой уходит прямо на
     * экран. Проснувшись, тоннель начинает с чистого накопителя: иначе первым кадром всплыл бы
     * след, оставшийся с прошлого раза, когда на экране шло другое видео.
     */
    open(renderer) {
      if (!layer) build();
      if (asleep) {
        renderer.setRenderTarget(read);
        renderer.clear();
        renderer.setRenderTarget(write);
        renderer.clear();
        asleep = false;
      }
      return layer;
    },

    /** Слой нарисован: накопить след и показать смесь на экране. */
    close(renderer, { dt, trip, level, hit }) {
      const steps = Math.min(dt / FRAME, 3);
      const trailer = trail.material.uniforms;
      trailer.tLayer.value = layer.texture;
      trailer.tEcho.value = read.texture;
      trailer.uDecay.value = reach(DECAY, trip) ** steps;
      trailer.uPull.value = 1 + (reach(PULL, trip) - 1 + hit * PULL_HIT) * steps;
      trailer.uTurn.value = (reach(TURN, trip) + level * TURN_LOUD) * steps;
      trailer.uAspect.value = width / height;

      renderer.setRenderTarget(write);
      renderer.render(trail.scene, flat);

      const shower = show.material.uniforms;
      shower.tLayer.value = layer.texture;
      shower.tEcho.value = write.texture;
      shower.uShare.value = trip * SHARE;

      renderer.setRenderTarget(null);
      renderer.render(show.scene, flat);

      const spent = read;
      read = write;
      write = spent;
    },

    /** Ручка вернулась на ноль: накопитель забывается, чтобы не всплыть при следующем разе. */
    rest() {
      asleep = true;
    },

    dispose() {
      trail.material.dispose();
      trail.geometry.dispose();
      show.material.dispose();
      show.geometry.dispose();
      layer?.dispose();
      read?.dispose();
      write?.dispose();
    },
  };
}
