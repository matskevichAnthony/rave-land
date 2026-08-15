/**
 * Координатное соглашение площадки AKHET.
 *
 * Сцена открытая: песок до горизонта, процессионная дорога с фигурами, пилон в конце
 * дороги и вихрь, стоящий столбом в небо. Метры площадки, ворот, дороги и вихря записаны
 * здесь один раз, потому что их меряют все сразу: геометрия, свет, коллайдеры, камера и
 * типографика.
 *
 * Имена экспортов остались от прежней, закрытой версии сцены (`HALL`, `DOOR`,
 * `COLONNADE`, `SLOT`): по ним ходит обвязка. Значат они теперь другое, и это расписано
 * у каждого набора.
 */

/**
 * Площадка: не стены, а рабочий прямоугольник песка.
 *
 * `halfWidth`, `frontZ` и `endZ` очерчивают то, по чему ходят и что накрывает карта теней.
 * Песок нарисован далеко за этими границами, но за ними мир только смотрится, а не живёт.
 * `roofY` это потолок для свободной камеры, `waterY` и `floorY` совпадают: уровень песка.
 */
export const HALL = {
  halfWidth: 34,
  frontZ: 40,
  endZ: -54,
  roofY: 44,
  wallThickness: 2,
  waterY: 0,
  floorY: 0,
};

/**
 * Пилон: двубашенные ворота в конце дороги, глухие для прохода.
 *
 * Ключи достались от ложной двери и читаются так: `jambHalf` это внешний край башни от
 * оси, `jambWidth` ширина одной башни, `leafHalf` половина проёма между ними, `threshold`
 * это лестница перед воротами, `top` верх башни.
 */
export const DOOR = {
  jambHalf: 11.4,
  jambWidth: 7.6,
  jambDepth: 7,
  nicheDepth: 1.4,
  leafHalf: 3.8,
  leafDepth: 1.2,
  thresholdHalf: 13.5,
  thresholdHeight: 1.6,
  thresholdDepth: 4.4,
  top: 27,
};

/**
 * Аллея фигур: два ряда бараноголовых сфинксов вдоль дороги.
 *
 * `rows` это координаты рядов по X, `stations` шаги по Z, `capitalRadius` половина
 * ширины фигуры вместе с плинтом. По этим же числам обвязка ставит коллайдеры, поэтому
 * второго списка расстановки в сцене нет.
 *
 * Ближняя станция вынесена перед началом площадки намеренно: с афишной точки ряд, начатый
 * в глубине, весь укладывался в полосу у горизонта и читался пунктиром. Первая пара стоит
 * в пятидесяти метрах от камеры и задаёт мерку роста, дальняя доходит до самых ворот.
 */
export const COLONNADE = {
  rows: [-9, 9],
  stations: [2, -6.6, -15.2, -23.8, -32.4, -41],
  capitalRadius: 2.3,
  plinth: [4.4, 0.7, 2.5],
  bodyHeight: 3.2,
};

/**
 * Вихрь: вертикальная ось, вокруг которой идёт спираль из плит, осколков и фигурок.
 *
 * Ось стоит в стороне от дороги и от пилона: в кадре она проходит между массой ворот и
 * пустым краем, и ни то, ни другое не перекрывает. Воронка узкая у песка и раскрытая
 * вверху, вершина уходит за верхний край кадра.
 */
export const VORTEX = {
  x: 3.5,
  z: -24,
  baseRadius: 4.6,
  topRadius: 14,
  height: 54,
  craterRadius: 11,
};

/** Прежний «пролом»: обвязка держит по нему точку спуска, это подножие вихря. */
export const SLOT = { z: VORTEX.z, width: VORTEX.baseRadius * 2 };

/**
 * Коробка под типографику: воздух слева от вихря, над открытым песком.
 *
 * Пустой держится не только сама коробка, но и коридор от афишной камеры до неё. Считано
 * по лучу: на всём пути от `VIEW.poster` до коробки нет ничего выше семи метров (ближняя
 * пара сфинксов, обломки и лежащий обелиск), песок под лучом ровный и к камере не
 * поднимается, а дюны начинаются за коробкой, то есть от камеры дальше. По кадру коробка
 * занимает от -18 до -4 градусов от оси взгляда и стоит целиком выше линии горизонта,
 * так что за буквами небо, а не рельеф.
 */
export const TYPE_BOX = { x: -5.3, y: 20, z: -2.2, width: 16, height: 12, depth: 4 };

/** Габариты для облёта и типографики: радиус берётся по массе ворот, а не по песку. */
export const BOUNDS = { radius: 26, height: 26 };

/**
 * Точки съёмки.
 *
 * Афишная камера стоит справа и высоко, ось дороги идёт по кадру наискось, а не в лоб.
 * Считанные углы от оси взгляда при половине поля зрения в 21 градус: пилон +8, вихрь
 * +8, коробка типографики от -17 до -4. Масса и событие справа от середины, воздух слева.
 *
 * Крупные фигуры стоят на ближней половине этих метров, а не у горизонта: Анубис в
 * шестидесяти метрах занимает половину высоты кадра, стоящий бог в семидесяти почти
 * столько же, и оба перекрывают ворота силуэтом. Всё, что стоит в полосе типографики,
 * держит вершину ниже нулевого градуса, то есть под самой надписью.
 */
export const VIEW = {
  poster: { position: [36, 15.5, 48], target: [-4, 13, -26] },
  entry: { position: [28, 7, 62], target: [-2, 12, -30] },
  walk: { position: [12, 0, 26], heading: Math.PI },
};

/**
 * Буря идёт кругом за один проход камеры.
 *
 * Половину цикла вихрь тянет ровно, потом набирает и выдирает из песка новую плиту,
 * остаток стоит на пике. Стоянка на пике длинная намеренно: случайный снимок обязан
 * заставать сцену на её событии, а не на разгоне.
 */
export const STORM = {
  cycle: 23,
  surge: [0.42, 0.7],
  hold: 0.24,
  floor: 0.34,
  spin: 0.16,
};

function smoothstep(edge0, edge1, value) {
  const share = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return share * share * (3 - 2 * share);
}

/** Фаза бури в долях цикла: ноль это затишье, единица это конец пика. */
export function stormPhase(elapsed) {
  const share = (elapsed / STORM.cycle) % 1;
  return share < 0 ? share + 1 : share;
}

/**
 * Сила вихря в момент `phase`: от затишья до пика и обратно.
 *
 * Ниже `STORM.floor` она не падает никогда. Вихрь, который останавливается, читается
 * поломкой сцены, а не паузой.
 */
export function surgeAt(phase) {
  const rise = smoothstep(STORM.surge[0], STORM.surge[1], phase);
  const fall = smoothstep(1 - STORM.hold, 1, phase);
  return STORM.floor + (1 - STORM.floor) * rise * (1 - fall);
}

/**
 * Фигуры аллеи на плане: расстановка детерминированная и не зависит от сида.
 *
 * Ей пользуются и мир, и коллайдеры обвязки. Второго списка чисел не заводится: в
 * UNDERSTAV он завёлся, и с тех пор две копии расстановки правятся руками.
 */
export function planColumns() {
  return COLONNADE.stations.flatMap((z) => COLONNADE.rows.map((x) => ({
    x,
    z,
    radius: COLONNADE.capitalRadius,
    height: COLONNADE.bodyHeight + COLONNADE.plinth[1],
  })));
}

/**
 * Занятость песка кругами: одна проверка места на всю сцену.
 *
 * Мир набивают два источника: процедурные монументы и готовые модели. Пока каждый считал
 * место сам, они лезли друг в друга, и ступенчатая пирамида вставала внутрь процедурной.
 * План один: кто встал первым, тот держит круг, следующий отходит в сторону или не
 * ставится вовсе.
 *
 * Круг меряется по фактическому габариту вещи, а не по её замыслу, поэтому и собранная
 * геометрия, и загруженная модель считают радиус одним и тем же `planRadius`.
 */
const PLAN = { tries: 12, gap: 0.4, corner: 1.12 };

/** Радиус занятого круга по плану вещи: половина большей стороны с запасом на углы. */
export function planRadius(spanX, spanZ) {
  return Math.max(spanX, spanZ) * 0.5 * PLAN.corner;
}

/**
 * Коридор от афишной камеры до коробки типографики, кругами по лучу.
 *
 * Пустым держится не сама коробка, а путь до неё: вещь, вставшая на этом луче, перекрывает
 * буквы, где бы она ни стояла по глубине. Коридор бронируется в плане первым, поэтому
 * крупная фигура туда не попадёт даже случайным сдвигом.
 */
export const CORRIDOR = { radius: 7, steps: 6 };

export function planCorridor() {
  const [fromX, , fromZ] = VIEW.poster.position;
  const circles = [];
  for (let step = 0; step <= CORRIDOR.steps; step += 1) {
    const share = step / CORRIDOR.steps;
    circles.push({
      x: fromX + (TYPE_BOX.x - fromX) * share,
      z: fromZ + (TYPE_BOX.z - fromZ) * share,
      radius: CORRIDOR.radius,
    });
  }
  return circles;
}

export function createSitePlan() {
  const taken = [];

  const blocker = (x, z, radius) => taken.find(
    (spot) => Math.hypot(x - spot.x, z - spot.z) < radius + spot.radius + PLAN.gap,
  );

  /** Ближайшая точка за краем занятого круга: по линии от его центра наружу. */
  const aside = (point, hit, radius) => {
    const dx = point.x - hit.x;
    const dz = point.z - hit.z;
    const away = Math.hypot(dx, dz);
    const need = hit.radius + radius + PLAN.gap;
    const [alongX, alongZ] = away > 1e-3 ? [dx / away, dz / away] : [1, 0];
    return { x: hit.x + alongX * need, z: hit.z + alongZ * need };
  };

  /**
   * Место для вещи: своё, если свободно, сдвинутое в пределах `drift` или ничего.
   *
   * `drift` в метрах: ноль значит, что точка выставлена по кадру и двигать её нельзя,
   * такая вещь занимает место даже поверх чужого круга и становится помехой для следующих.
   * `skippable` разрешает не ставить вещь вовсе: в поле пирамид у горизонта одной больше
   * или меньше не считается, а вот пирамида внутри пирамиды считается.
   */
  const place = ({ x, z, radius, drift = 0, skippable = false }) => {
    let point = { x, z };
    for (let attempt = 0; attempt <= PLAN.tries; attempt += 1) {
      const hit = blocker(point.x, point.z, radius);
      if (!hit) {
        taken.push({ x: point.x, z: point.z, radius });
        return point;
      }
      if (!drift) break;
      point = aside(point, hit, radius);
      if (Math.hypot(point.x - x, point.z - z) > drift) break;
    }
    if (skippable) return null;
    taken.push({ x, z, radius });
    return { x, z };
  };

  return { place };
}

/**
 * Границы площадки коробками: центр и полуразмеры, как их ждёт коллайдер.
 *
 * Снаружи их не видно и видно быть не должно: это край рабочего песка, дальше начинается
 * та часть мира, которая только смотрится. Прогулка упирается в них раньше, чем успевает
 * заметить, что дюны за спиной не имеют дна.
 */
export function planWalls() {
  const { halfWidth, frontZ, endZ, wallThickness } = HALL;
  const half = wallThickness / 2;
  const middleZ = (frontZ + endZ) / 2;
  const halfDepth = (frontZ - endZ) / 2 + wallThickness;
  return [
    { x: -halfWidth - half, z: middleZ, halfWidth: half, halfDepth },
    { x: halfWidth + half, z: middleZ, halfWidth: half, halfDepth },
    { x: 0, z: frontZ + half, halfWidth: halfWidth + wallThickness, halfDepth: half },
    { x: 0, z: endZ - half, halfWidth: halfWidth + wallThickness, halfDepth: half },
  ];
}
