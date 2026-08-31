import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Настоящий знак UNDERSTAV, отлитый в объём.
 *
 * Заголовок афиши раньше набирался готическим шрифтом по буквам. Шрифт даёт строку, а у
 * события есть знак: три строки UND / ERST / AV, нарисованные руками, плюс четыре креста
 * ромбом. Набор из шрифта их не повторяет и повторить не может, поэтому буквы едут не из
 * `typeface.json`, а из нарисованного знака.
 *
 * Наружу отдаётся геометрия в долях собственной высоты с началом координат в левом нижнем
 * углу краски. Метры знака выбирает афиша: она одна знает, сколько места осталось под
 * лайнап, а знак почти квадратный и посаженный по ширине коробки закрыл бы её целиком.
 */

// Афиша печатает вторую редакцию знака, карточки артистов остались на первой: у знака
// поменялся рисунок, а не смысл, и переводить на него всё разом никто не просил.
const WORDMARK_URL = 'assets/logo/understav-wordmark-v2.svg';

// Кривые блэклеттера ломаные, а не дуги: на диагоналях засечек трёх делений хватает, а
// каждое следующее умножает треугольники знака, который и так стоит в кадре крупнее всего.
const CURVE_SEGMENTS = 3;

/** Толщина и фаска в долях высоты знака: они обязаны пережить любой его кегль в метрах. */
const RELIEF = { depth: 0.055, bevel: 0.006, bevelSegments: 1 };

async function fetchDrawing() {
  const response = await fetch(WORDMARK_URL);
  if (!response.ok) throw new Error(`знак UNDERSTAV не отдался: ${response.status}`);
  return new SVGLoader().parse(await response.text());
}

/**
 * Одна фигура знака в объём.
 *
 * `jitter` качает каждую фигуру порознь вокруг её собственной середины: знак печатали
 * железом по камню, и абсолютно ровный ряд букв выдаёт вектор раньше, чем зритель успевает
 * прочитать слово. Качать группой бесполезно, наклон целого знака читается ошибкой монтажа.
 */
function reliefOf(shape, height, jitter) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height * RELIEF.depth,
    curveSegments: CURVE_SEGMENTS,
    bevelEnabled: true,
    bevelThickness: height * RELIEF.bevel,
    bevelSize: height * RELIEF.bevel,
    bevelOffset: 0,
    bevelSegments: RELIEF.bevelSegments,
  });
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  const pivot = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
  geometry.translate(-pivot.x, -pivot.y, 0);
  geometry.rotateZ(jitter);
  geometry.translate(pivot.x, pivot.y, 0);
  return geometry;
}

/**
 * Знак одной геометрией в долях своей высоты.
 *
 * Фигуры сливаются в одну: их девять, и на каждую платить отдельным вызовом отрисовки
 * незачем, а разными их делает только наклон, который уже запечён в вершины.
 *
 * Ось Y у SVG смотрит вниз, у сцены вверх, поэтому фигуры приходят вверх ногами и знак
 * переворачивается разом, уже после слияния.
 */
export async function createWordmark({ rng, tilt }) {
  const drawing = await fetchDrawing();
  const box = drawing.xml.viewBox.baseVal;
  const parts = drawing.paths.flatMap((path) => SVGLoader.createShapes(path)
    .map((shape) => reliefOf(shape, box.height, rng.range(-tilt, tilt))));
  if (parts.length === 0) throw new Error('знак UNDERSTAV пуст: ни одной фигуры');

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  merged.scale(1 / box.height, -1 / box.height, 1 / box.height);
  merged.computeBoundingBox();
  const { min, max } = merged.boundingBox;
  merged.translate(-min.x, -min.y, 0);

  return { geometry: merged, aspect: (max.x - min.x) / (max.y - min.y) };
}
