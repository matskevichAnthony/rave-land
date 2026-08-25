import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { burnIron } from './burn.js';
import { loadGothicTypeface } from './gothic.js';

/**
 * Название события словом: готика, набранная по буквам и отлитая в то же железо, что знак.
 *
 * Знак читается силуэтом, а не текстом: три строки из ломаных, и зритель, который видит его
 * впервые, слово в нём не разбирает. Поэтому под знаком стоит и обычная строка, набранная
 * шрифтом. Кегль у неё заведомо мелкий: главным на афише остаётся знак, а строка работает
 * подписью к нему, как подпись под гравюрой.
 *
 * Буквы строятся поштучно и сливаются в одну геометрию только после разгона: за каждую
 * букву иначе платили бы отдельным вызовом отрисовки.
 */

const UNIT_SIZE = 1;
// Готика узкая по природе, и набор сжимается поперёк ещё немного: широкая строка спорит
// со знаком за место в кадре, а спорить ей не положено.
const NARROW = 0.72;
const TRACKING = 0.12;
const SPACE_ADVANCE = 0.32;

const DEPTH = 0.16;
const DEPTH_JITTER = 0.22;
const BEVEL = 0.018;
const BEVEL_SEGMENTS = 1;
const CURVE_SEGMENTS = 2;

// Буквы качаются каждая сама по себе: печатали железом по камню, и ровный ряд выдаёт вектор
// раньше, чем зритель успевает прочитать слово.
const TILT_Z = 0.022;
const TILT_X = 0.03;

// Воздух под строкой в долях её краски. Строка носит его в своей высоте, а не ждёт промежутка
// от афиши: содержимое афиши шире её коробки, и промежутки между строками сжимаются в ноль.
// Без этого запаса плита тэглайна встаёт впритык и срезает нижние засечки готики.
const LEAD = 0.34;

function tiltLetter(geometry, halfWidth, rng) {
  geometry.translate(-halfWidth, -UNIT_SIZE / 2, 0);
  geometry.rotateZ(rng.range(-TILT_Z, TILT_Z));
  geometry.rotateX(rng.range(-TILT_X, TILT_X));
  geometry.translate(halfWidth, UNIT_SIZE / 2, 0);
}

function letterGeometry(font, glyph, rng) {
  return new TextGeometry(glyph, {
    font,
    size: UNIT_SIZE,
    depth: DEPTH * rng.range(1 - DEPTH_JITTER, 1 + DEPTH_JITTER),
    curveSegments: CURVE_SEGMENTS,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelOffset: 0,
    bevelSegments: BEVEL_SEGMENTS,
  });
}

function setLetters(font, text, rng) {
  const trackingUnits = TRACKING / NARROW;
  const letters = [];
  let cursor = 0;

  for (const glyph of text) {
    const geometry = letterGeometry(font, glyph, rng);
    geometry.computeBoundingBox();
    const width = geometry.boundingBox.max.x - geometry.boundingBox.min.x;
    if (!(width > 0)) {
      geometry.dispose();
      cursor += UNIT_SIZE * SPACE_ADVANCE + trackingUnits;
      continue;
    }
    geometry.translate(-geometry.boundingBox.min.x, 0, 0);
    tiltLetter(geometry, width / 2, rng);
    geometry.translate(cursor, 0, 0);
    letters.push(geometry);
    cursor += width + trackingUnits;
  }

  if (letters.length === 0) throw new Error('строка названия пуста: ни одной буквы');
  const merged = mergeGeometries(letters, false);
  for (const letter of letters) letter.dispose();
  merged.computeBoundingBox();
  return merged;
}

/**
 * Строка названия в метрах коробки, началом координат в левом верхнем углу краски.
 *
 * Высота меряется по всей краске, а не по прописной: у готики росчерки уходят под базовую
 * линию, и без этого строка легла бы на то, что стоит под ней.
 */
export async function createWordline({ text, rng, targetWidth }) {
  const font = new FontLoader().parse(await loadGothicTypeface());
  const geometry = setLetters(font, text, rng);

  const unitWidth = geometry.boundingBox.max.x - geometry.boundingBox.min.x;
  const scale = targetWidth / (unitWidth * NARROW);
  const inkTop = geometry.boundingBox.max.y * scale;
  const iron = burnIron({ geometry, span: unitWidth, rng });

  const mesh = new THREE.Mesh(geometry, iron.material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.scale.set(scale * NARROW, scale, scale);
  mesh.position.set(-targetWidth / 2 - geometry.boundingBox.min.x * scale * NARROW, -inkTop, 0);

  const group = new THREE.Group();
  group.add(mesh);
  const inkHeight = inkTop - geometry.boundingBox.min.y * scale;
  return {
    group,
    height: inkHeight * (1 + LEAD),
    burn: iron.burn,
  };
}
