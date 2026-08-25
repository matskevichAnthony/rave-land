import * as THREE from 'three';
import { PALETTE } from './palette.js';

/**
 * Раскалённое железо афиши: как выглядит прожжённая буква и как по ней ходит жар.
 *
 * Потребителей два, знак события и словесная надпись под ним, и гореть они обязаны одним
 * огнём. Правило прожога живёт здесь целиком: и раскраска вершин, и волна в шейдере, и
 * срывы дуги. Разведи их по двум модулям, и на первой же правке знак с надписью разъедутся
 * по цвету, оставшись при этом «одинаковыми» в глазах того, кто правил только один файл.
 *
 * Подъём эмиссии под порог блума живёт тоже здесь, хотя по смыслу просился в палитру: её
 * читают карточки, а они рисуются на canvas и обходятся без three. Один `THREE.Color` ради
 * одного множителя утянул бы в их сборку весь движок.
 */

// Доля лицевой нормали, ниже которой грань уже не лицо буквы, а фаска или стенка.
const FLAT_FACING = 0.94;
const EDGE_FACING = 0.2;
// Доля крови на стенке буквы: единица это фаска, раскалённая на полную.
const WALL_HEAT = 0.5;

const EMISSIVE_BASE = 2.1;
// Жар не мигает в такт, а ползёт по фаске, как по остывающему прокату, и изредка срывается
// дугой: ровный пульс в бит читается дискотечной гирляндой, а не раскалённым железом.
const HEAT_WAVES = 1.6;
const HEAT_SECONDS = 14;
const HEAT_LOW = 0.32;
const HEAT_HIGH = 1.35;
const ARC_GAP_MIN = 2.4;
const ARC_GAP_MAX = 7;
const ARC_BLINK_MIN = 0.03;
const ARC_BLINK_MAX = 0.11;
const ARC_DEPTH_MIN = 0.18;
const ARC_DEPTH_MAX = 0.45;

// Блум берёт по яркости, а не по цвету: у крови её вдвое меньше, чем у кости, и красная
// плита не доходит до порога свечения. Множитель выравнивает именно это.
const EMISSIVE_LUMA_REFERENCE = 0.55;
const EMISSIVE_LUMA_BOOST_CAP = 2.2;

const TAU = Math.PI * 2;

/** Насколько поднять эмиссию, чтобы цвет любой светлоты дотянулся до порога блума. */
export function emissiveBoost(color) {
  const { r, g, b } = new THREE.Color(color);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return Math.min(EMISSIVE_LUMA_REFERENCE / luma, EMISSIVE_LUMA_BOOST_CAP);
}

function facingTint(facing, tints) {
  if (facing > FLAT_FACING) return tints.flat;
  if (facing > EDGE_FACING) return tints.edge;
  return tints.wall;
}

/** Цвет вершины несёт и металл, и силу прожога: фаска кровь, стенки ржавчина, лицо железо. */
function paintBurn(geometry) {
  const normal = geometry.getAttribute('normal');
  // Лицо буквы чёрное железо, а горит только обрамление: раскалённой ржавчиной стенки
  // уводили всю строку в оранжевый, поэтому и фаска, и стенка идут кровью, а не жаром.
  const tints = {
    flat: new THREE.Color(PALETTE.iron),
    wall: new THREE.Color(PALETTE.blood).multiplyScalar(WALL_HEAT),
    edge: new THREE.Color(PALETTE.blood),
  };
  const colors = new Float32Array(normal.count * 3);
  for (let i = 0; i < normal.count; i += 1) {
    const tint = facingTint(Math.abs(normal.getZ(i)), tints);
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/**
 * Эмиссия горит только по фаске (её гасит цвет вершины) и волной идёт вдоль строки.
 *
 * Волна живёт в шейдере, потому что она разная в каждой точке буквы: из JS такое пришлось бы
 * гнать отдельным материалом на каждую букву, то есть отдельным вызовом отрисовки.
 */
function waveEmissiveByVertexColor(material, span) {
  const heat = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHeat = heat;
    shader.uniforms.uSpan = { value: span };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vHeatX;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvHeatX = position.x;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHeatX;\nuniform float uHeat;\nuniform float uSpan;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
\tfloat wave = 0.5 + 0.5 * sin(vHeatX / uSpan * ${HEAT_WAVES.toFixed(2)} * 6.2831853 - uHeat);
\ttotalEmissiveRadiance *= vColor * mix(${HEAT_LOW.toFixed(2)}, ${HEAT_HIGH.toFixed(2)}, wave);`,
      );
  };
  return heat;
}

/** Дуга не мигает по расписанию: горит ровно, изредка срывается и снова садится на ток. */
function createArcFlicker(rng) {
  let nextAt = rng.range(ARC_GAP_MIN, ARC_GAP_MAX);
  let until = 0;
  let depth = 1;
  return function flicker(elapsed) {
    if (elapsed >= nextAt) {
      until = elapsed + rng.range(ARC_BLINK_MIN, ARC_BLINK_MAX);
      depth = rng.range(ARC_DEPTH_MIN, ARC_DEPTH_MAX);
      nextAt = until + rng.range(ARC_GAP_MIN, ARC_GAP_MAX);
    }
    return elapsed < until ? depth : 1;
  };
}

/**
 * Геометрия в прожжённое железо: красит вершины, отдаёт материал и ход жара по нему.
 *
 * `span` это ширина набора в тех же единицах, в каких лежит геометрия. Волна меряется им,
 * а не метрами: в метрах она растягивалась бы и сжималась вместе с кадрированием, и на
 * вертикальной афише прокатывалась бы вдвое реже, чем на широкой.
 */
export function burnIron({ geometry, span, rng }) {
  paintBurn(geometry);
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    metalness: 0.95,
    roughness: 0.42,
    emissive: PALETTE.blood,
    emissiveIntensity: EMISSIVE_BASE * emissiveBoost(PALETTE.blood),
  });
  const heat = waveEmissiveByVertexColor(material, span);
  const flicker = createArcFlicker(rng);

  return {
    material,
    burn(elapsed) {
      heat.value = (elapsed / HEAT_SECONDS) * TAU;
      material.emissiveIntensity = EMISSIVE_BASE * emissiveBoost(PALETTE.blood) * flicker(elapsed);
    },
  };
}
