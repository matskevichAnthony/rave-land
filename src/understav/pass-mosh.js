import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FULLSCREEN_VERTEX, MOTION_GLSL } from './motion-glsl.js';

/**
 * Датамош: буфер накапливает сам себя, обратный варп тянет его по вектору движения сцены.
 *
 * Это ровно приём px-77 (вычесть ключевой кадр, оставить векторы), но вектор не угадан блочным
 * поиском по картинке, а посчитан из глубины и матриц камеры. Проход живёт в собственной паре
 * мишеней вполовину стороны: смаз крупный, разрешение ему не нужно, а четверть площади это
 * четверть работы.
 *
 * Ключевой кадр пропадает только там, где есть движение: камера встала, и картинка снова резкая.
 * Текст шейдера держим в ASCII, кириллица в исходнике шейдера запрещена спецификацией.
 */

const HALF_RESOLUTION = 0.5;
const BLOCK_PIXELS = 12;

const FRAGMENT_SHADER = `
  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform sampler2D tHistory;
  uniform mat4 uInverseViewProjection;
  uniform mat4 uPreviousViewProjection;
  uniform vec2 uBlock;
  uniform float uMosh;
  uniform float uGhost;
  uniform float uPower;
  uniform float uHistoryReady;
  varying vec2 vUv;

  ${MOTION_GLSL}

  const float MOTION_REFERENCE = 0.005;
  const float VELOCITY_LIMIT = 0.03;
  const float MOSH_REACH = 3.0;
  const float HOLD_LIMIT = 0.97;

  void main() {
    vec2 block = (floor(vUv / uBlock) + 0.5) * uBlock;
    float depth = texture2D(tDepth, block).x;
    vec2 velocity = screenVelocity(
      block,
      depth,
      uInverseViewProjection,
      uPreviousViewProjection,
      VELOCITY_LIMIT
    ) * uPower;

    vec3 fresh = texture2D(tScene, vUv).rgb;
    vec2 pull = velocity * uMosh * MOSH_REACH;
    vec3 history = texture2D(tHistory, clamp(vUv - pull, vec2(0.0), vec2(1.0))).rgb;

    float motion = clamp(length(velocity) / MOTION_REFERENCE, 0.0, 1.0);
    float hold = min(uGhost * motion, HOLD_LIMIT) * uHistoryReady;

    gl_FragColor = vec4(mix(fresh, history, hold), 1.0);
  }
`;

const createTarget = () => new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType,
  depthBuffer: false,
  // Ближайший сосед оставляет смаз хрустящим: билинейка размазала бы его в туман
  magFilter: THREE.NearestFilter,
  minFilter: THREE.NearestFilter,
});

export class MoshPass extends Pass {
  // Глубину проход берёт у сцены, а не из буфера чтения: между ними стоят проходы с обменом
  // буферов, и в том, что окажется буфером чтения, лежит копия глубины, в которую не пишут.
  constructor(depthSource) {
    super();
    this.depthSource = depthSource;
    // Проход пишет в свои мишени, буферы композитора не двигает
    this.needsSwap = false;

    this.uniforms = {
      tScene: { value: null },
      tDepth: { value: null },
      tHistory: { value: null },
      uInverseViewProjection: { value: new THREE.Matrix4() },
      uPreviousViewProjection: { value: new THREE.Matrix4() },
      uBlock: { value: new THREE.Vector2(0.01, 0.01) },
      uMosh: { value: 0 },
      uGhost: { value: 0 },
      uPower: { value: 1 },
      uHistoryReady: { value: 0 },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });

    this.quad = new FullScreenQuad(this.material);
    this.targets = [createTarget(), createTarget()];
    this.current = 0;
  }

  /** Накопленное состояние датамоша, его читает финальный проход. */
  get texture() {
    return this.targets[this.current].texture;
  }

  setSize(width, height) {
    const halfWidth = Math.max(1, Math.round(width * HALF_RESOLUTION));
    const halfHeight = Math.max(1, Math.round(height * HALF_RESOLUTION));
    for (const target of this.targets) target.setSize(halfWidth, halfHeight);
    this.uniforms.uBlock.value.set(BLOCK_PIXELS / halfWidth, BLOCK_PIXELS / halfHeight);
    // Мишени пересозданы, накопленного кадра больше нет, иначе первый кадр вспыхнет чёрным
    this.uniforms.uHistoryReady.value = 0;
  }

  render(renderer, writeBuffer, readBuffer) {
    const next = 1 - this.current;
    this.uniforms.tScene.value = readBuffer.texture;
    this.uniforms.tDepth.value = this.depthSource.depthTexture;
    this.uniforms.tHistory.value = this.targets[this.current].texture;

    renderer.setRenderTarget(this.targets[next]);
    this.quad.render(renderer);

    this.current = next;
    this.uniforms.uHistoryReady.value = 1;
  }

  dispose() {
    for (const target of this.targets) target.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
