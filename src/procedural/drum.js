import * as THREE from 'three';

/**
 * Индустриальная бочка телом вращения.
 *
 * Цилиндр в двенадцать граней и диск сверху это не бочка, а банка: в кадре у него ровно один
 * силуэт, гранёный по контуру и без единой горизонтали. Настоящую двухсотлитровку узнают по
 * профилю, а не по обхвату: завальцованный борт сверху, отбортовка снизу и катучие обручи по
 * телу. Всё это лежит в одном профиле, а тело вращения делает из профиля бочку, поэтому здесь
 * нет ни одной отдельной детали и ни одного лишнего меша.
 *
 * Бочка открытая: в неё смотрит камера сверху и в ней горит огонь, поэтому профиль уходит
 * через борт обратно вниз по внутренней стенке и закрывается дном. Закрытая крышка тут была
 * бы враньём, а стенка в один слой светилась бы изнутри наружу.
 *
 * Профиль записан в долях: радиус в долях наружного радиуса, высота в долях полной высоты.
 * Метры бочке назначает сцена, потому что её метры это метры зала, а не этого модуля.
 */

const TAU = Math.PI * 2;

const SEGMENTS = 28;
// Стенка чуть уже наружного радиуса: за него выходят только борт и обручи, иначе бочка
// получается ровной трубой, у которой обручи не за что зацепить взглядом.
const WALL = 0.93;
const RIM = 1;
// Внутренняя стенка тоньше наружной ровно на толщину железа.
const LINING = 0.87;
const FLOOR = 0.05;
const CHIME = 0.035;
// Скос на входе и выходе пояса: обруч с прямым углом читается надетой шайбой, а не накаткой.
const BEVEL = 0.012;

/**
 * Виды бочек: разница только в поясах по телу.
 *
 * Пояс это `{ from, to, radius }` в долях высоты и наружного радиуса. Больше видов заводить
 * незачем: силуэт бочки держат борт и дно, а тело отличает как раз накатка.
 */
const KINDS = {
  // Двухсотлитровка: два катучих обруча, на которых бочку и катают по земле.
  hooped: [
    { from: 0.3, to: 0.42, radius: RIM },
    { from: 0.62, to: 0.74, radius: RIM },
  ],
  // Химическая: частый мелкий гофр по всему телу.
  ribbed: Array.from({ length: 6 }, (unused, index) => {
    const at = 0.16 + index * 0.13;
    return { from: at, to: at + 0.055, radius: 0.98 };
  }),
  // Гладкая с раздутым телом: такие стоят битыми и без обручей.
  swollen: [{ from: 0.18, to: 0.84, radius: 0.99 }],
};

export const DRUM_KINDS = Object.keys(KINDS);

/** Профиль бочки: наружу снизу вверх, через борт и обратно вниз по внутренней стенке. */
function profileOf(bands) {
  const points = [
    [0, 0],
    [LINING, 0],
    [RIM, CHIME],
    [RIM, CHIME * 2],
    [WALL, CHIME * 3],
  ];
  for (const band of bands) {
    points.push(
      [WALL, band.from],
      [band.radius, band.from + BEVEL],
      [band.radius, band.to - BEVEL],
      [WALL, band.to],
    );
  }
  points.push(
    [WALL, 1 - CHIME * 3],
    [RIM, 1 - CHIME * 2],
    [RIM, 1],
    [LINING, 1 - CHIME],
    [LINING, FLOOR + CHIME],
    [0, FLOOR],
  );
  return points.map(([radius, height]) => new THREE.Vector2(radius, height));
}

/**
 * Вмятины: бочка гнётся по телу, а не по борту.
 *
 * Без них тринадцать бочек в кадре читаются одной, размноженной по кругу: тело вращения
 * идеально ровное, и глаз ловит повтор раньше, чем успевает прочесть форму. Смещение идёт
 * по радиусу двумя волнами разной частоты, поэтому шва на стыке оборота не остаётся.
 */
function dent(geometry, depth, rng) {
  const phase = [rng() * TAU, rng() * TAU, rng() * TAU];
  const position = geometry.getAttribute('position');
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const x = position.getX(vertex);
    const z = position.getZ(vertex);
    const radius = Math.hypot(x, z);
    if (radius < CHIME) continue;
    const angle = Math.atan2(z, x);
    const height = position.getY(vertex);
    const wave = Math.sin(angle * 3 + phase[0]) * Math.sin(height * 7 + phase[1])
      + 0.5 * Math.sin(angle * 5 + height * 4 + phase[2]);
    const push = 1 + depth * wave;
    position.setX(vertex, x * push);
    position.setZ(vertex, z * push);
  }
  geometry.computeVertexNormals();
}

/**
 * Геометрия бочки одного вида, стоящая подошвой в начале координат.
 *
 * Единица высоты и единица радиуса: сцена ставит копии одним `InstancedMesh` и назначает
 * метры масштабом, поэтому модуль о метрах зала не знает.
 */
export function drumGeometry({ kind, depth = 0.012, rng }) {
  const bands = KINDS[kind];
  if (!bands) throw new Error(`бочки вида «${kind}» нет: есть ${DRUM_KINDS.join(', ')}`);
  const geometry = new THREE.LatheGeometry(profileOf(bands), SEGMENTS);
  if (depth > 0 && rng) dent(geometry, depth, rng);
  return geometry;
}
