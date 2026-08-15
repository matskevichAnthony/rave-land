/**
 * Глубина непрозрачной сцены и мягкое гашение прозрачного по ней.
 *
 * Прозрачная плоскость рисуется в том же проходе, что и геометрия, и глубину этого прохода
 * прочитать не может: буфер ещё пишется. Поэтому глубина снимается заранее, отдельным дешёвым
 * проходом по одним непрозрачным объектам в уменьшенную мишень. По ней частица знает, сколько
 * метров до поверхности за ней, и у самой поверхности гаснет вместо жёсткого края на срезе.
 *
 * Дымка, искры и пыль рождаются глубоко в сцене и до этого модуля параметром не дотягиваются,
 * поэтому проход и материалы связаны одним набором юниформ на кадр: проход в него пишет,
 * `softenMaterial` из него читает. Своё у материала одно расстояние гашения в метрах, и его
 * назначает сцена.
 */

import * as THREE from 'three';

// Глубина идёт не в картинку, а в сравнение расстояний: половина стороны это вчетверо меньше
// пикселей, и на мягком крае разницы с полным разрешением не видно.
const DEPTH_SCALE = 0.5;

const sceneDepth = {
  tSceneDepth: { value: null },
  uSceneDepthSize: { value: new THREE.Vector2(1, 1) },
  uSceneDepthRange: { value: new THREE.Vector2(1, 100) },
};

const COLORSPACE_CHUNK = '#include <colorspace_fragment>';

const SOFT_DEPTH_GLSL = `
uniform sampler2D tSceneDepth;
uniform vec2 uSceneDepthSize;
uniform vec2 uSceneDepthRange;
uniform float uSoftFade;

float depthMetres(float depth) {
  float near = uSceneDepthRange.x;
  float far = uSceneDepthRange.y;
  return (near * far) / (far - (far - near) * depth);
}

// Fades the fragment out as it comes close to the opaque surface behind it
float softDepthFade() {
  vec2 screen = gl_FragCoord.xy / uSceneDepthSize;
  float behind = depthMetres(texture2D(tSceneDepth, screen).x);
  float own = depthMetres(gl_FragCoord.z);
  return clamp((behind - own) / uSoftFade, 0.0, 1.0);
}
`;

/**
 * Материал гаснет за `fadeMetres` до непрозрачной поверхности за ним.
 *
 * Правка идёт через `onBeforeCompile`, а не через свой шейдер: так под гашение годится и
 * готовый материал three, и чужой `ShaderMaterial`, лишь бы он собирал цвет в `gl_FragColor`.
 */
export function softenMaterial(material, fadeMetres) {
  const fade = { value: fadeMetres };
  material.onBeforeCompile = (shader) => {
    if (!shader.fragmentShader.includes(COLORSPACE_CHUNK)) {
      throw new Error('мягкое гашение ждёт материал с colorspace_fragment во фрагменте');
    }
    Object.assign(shader.uniforms, sceneDepth, { uSoftFade: fade });
    shader.fragmentShader = SOFT_DEPTH_GLSL + shader.fragmentShader.replace(
      COLORSPACE_CHUNK,
      `${COLORSPACE_CHUNK}\n  gl_FragColor.a *= softDepthFade();`,
    );
  };
  // Ключ программы собирается из параметров материала, и без своей отметки правленый материал
  // подхватил бы уже скомпилированную чужую программу, в которой гашения нет.
  material.customProgramCacheKey = () => 'soft-depth';
  return material;
}

/**
 * Проход глубины: один обход непрозрачной сцены за кадр до её отрисовки.
 *
 * Прозрачное на время прохода прячется целиком, а не только частицы: аддитивные блики, огонь
 * и лужи не поверхности, и загораживать ими воздух неверно.
 */
export function createDepthProbe({ renderer, scene, camera, scale = DEPTH_SCALE }) {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    depthTexture: new THREE.DepthTexture(1, 1),
  });
  const depthOnly = new THREE.MeshDepthMaterial();
  // Цвет мишени не читает никто, нужна одна глубина.
  depthOnly.colorWrite = false;
  sceneDepth.tSceneDepth.value = target.depthTexture;

  const hidden = [];

  function hideTransparent(node) {
    const material = node.material;
    if (!material || !node.visible) return;
    const transparent = Array.isArray(material)
      ? material.some((part) => part.transparent)
      : material.transparent;
    if (!transparent) return;
    node.visible = false;
    hidden.push(node);
  }

  return {
    update() {
      sceneDepth.uSceneDepthRange.value.set(camera.near, camera.far);
      scene.traverse(hideTransparent);
      const previousTarget = renderer.getRenderTarget();
      const previousOverride = scene.overrideMaterial;
      const previousShadows = renderer.shadowMap.autoUpdate;
      // Тени сцене уже посчитаны, и второй проход за кадр стоил бы ровно столько же
      renderer.shadowMap.autoUpdate = false;
      scene.overrideMaterial = depthOnly;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(previousTarget);
      scene.overrideMaterial = previousOverride;
      renderer.shadowMap.autoUpdate = previousShadows;
      for (const node of hidden) node.visible = true;
      hidden.length = 0;
    },

    setSize(width, height) {
      const pixels = renderer.getPixelRatio();
      sceneDepth.uSceneDepthSize.value.set(
        Math.round(width * pixels),
        Math.round(height * pixels),
      );
      target.setSize(
        Math.max(1, Math.round(width * pixels * scale)),
        Math.max(1, Math.round(height * pixels * scale)),
      );
    },
  };
}
