import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import fontData from 'three/examples/fonts/helvetiker_bold.typeface.json';
import { COLONNADE, HALL, TYPE_BOX, VIEW } from './hall.js';
import { createMaterials, createStoneMaps, scaleUv, stoneBox, taperedBox } from './stone.js';

/**
 * Типографика сцены AKHET: имя события, лайнап и отсчёт, поставленные в камне.
 *
 * Шрифта с египетским характером в системе нет: `fc-list` отдаёт гротески и антиквы
 * (DejaVu, Liberation, Nimbus, Noto), а единственное египетское в списке это иероглифика,
 * латиницы в ней нет. Поэтому характер делается геометрией, а из готовых берётся самый
 * нейтральный носитель: helvetiker bold, штрих ровной толщины с плоским обрезом и без
 * единой засечки. Optimer стоял тут раньше и звучал римским: у него штрих расширяется к
 * концам, а это латинский капитальный шрифт, резец Траяна, а не резец Карнака.
 *
 * Дальше глиф правится тремя числами. `NAME_WIDEN` растягивает букву поперёк, пока она не
 * сядет в квадрат: египетская надпись широкая и низкая, а не стройная. `NAME_WEIGHT`
 * раздувает контур наружу (`bevelOffset` у экструдера смещает весь контур), и штрих
 * становится тяжёлым, а просветы узкими. Фаска шире врезки и в один сегмент, то есть
 * плоская грань, а не скруглённый вал: так выглядит скол, а не фрезеровка. Ставятся буквы
 * поблочно, с разбросом по завалу и по глубине, потому что кладку вели руками.
 *
 * Раскладка зеркальна привычной, столбца по центру нет. Имя стоит слева отдельным
 * монументом на ступенчатом стилобате, отсчёт поднят за ним на мастабу и выше букв имени,
 * лайнап уходит вправо стелами, и строки в них читаются сверху вниз, как в египетской
 * колонке. Между именем и первой стелой оставлен пролёт: без него первая строка лайнапа
 * налезает на монумент и не читается ни на одном холсте.
 *
 * Красок в кадре две. Строки лайнапа положены охрой по светлому камню, это краска, а не
 * свет. Выделена ровно одна строка, закрывающая, и выделена она не яркостью: под отвесным
 * солнцем и рядом с огнём светлое на светлом не выигрывает ничего. Её стела вырублена из
 * гранита, буква уведена в холодную синеву, и работают тут разница светлоты с подложкой и
 * разница температуры с огнём. Свечение и лампа только подтверждают, что горит именно она.
 *
 * Стоит монумент не в отданной коробке, а перед ней: коробка висит над аллеей, а на песке
 * под ней стоят фигуры, и от камеры до неё смотрит вся ближняя половина площадки. Поэтому
 * монумент выведен в устье аллеи, ближе камеры всего, что есть на площадке, а буквы поданы
 * стилобатом и мастабой выше человеческого роста: перед ними по лучу не встанет ни рельеф,
 * ни реквизит. От коробки остаётся ширина как нижняя граница и потолок как верхняя.
 *
 * Метров в файле нет ни одного: все размеры выведены из ширины монумента и высоты
 * прописной буквы имени, а сама ширина из аллеи. Поедет площадка, поедет и монумент.
 */

const CAP_PROBE = 'H';
const PROBE_DEPTH = 0.01;
/** Ширина пробела в высотах прописной: у шрифта её не спросить, глифа у пробела нет. */
const SPACE_ADVANCE = 0.42;

const NAME_WIDTH_SHARE = 0.5;
const NAME_Z_SHARE = 0.16;
const NAME_TRACKING = 0.15;
/** Растяжка глифа поперёк: буква из стройной становится широкой, почти квадратной. */
const NAME_WIDEN = 1.2;
/** Раздутие контура наружу в высотах прописной: отсюда тяжесть штриха и узкие просветы. */
const NAME_WEIGHT = 0.028;
const NAME_DEPTH = 0.6;
const NAME_BEVEL = 0.036;
const NAME_SEGMENTS = 3;
/** Разброс постановки блока в радианах: буквы ставили руками, а не печатали. */
const NAME_SET = 0.03;
/** Разброс блока по глубине: строка перестаёт лежать в одной плоскости, как кладка. */
const NAME_SINK = 0.05;

/** Стилобат в высотах прописной: он поднимает строку выше барханов и реквизита. */
const PLINTH_HEIGHT = 1.5;
const PLINTH_OVERHANG = 0.5;
const PLINTH_STEP_SHARE = 0.56;

const MASTABA_WIDTH_SHARE = 0.5;
const MASTABA_DEPTH_SHARE = 0.16;
/** Насколько верх мастабы поднят над верхом имени, в высотах прописной. */
const MASTABA_RISE = 0.7;
const MASTABA_BATTER = 0.88;
const MASTABA_Z_SHARE = -0.38;

const COUNTDOWN_CAP = 2.3;
const COUNTDOWN_MARGIN = 0.45;
const COUNTDOWN_TRACKING = 0.12;
const COUNTDOWN_WIDEN = 1.12;
const COUNTDOWN_WEIGHT = 0.026;
const COUNTDOWN_DEPTH = 0.4;
const COUNTDOWN_BEVEL = 0.03;
const COUNTDOWN_SEGMENTS = 4;

/** Пролёт между стилобатом имени и первой стелой в долях ширины монумента. */
const LINEUP_AIR_SHARE = 0.09;
/**
 * Отступ последней стелы от правого края монумента, в тех же долях.
 *
 * Край монумента это не край кадра. Камера афиши смотрит на площадку наискось и целится в
 * переднюю плоскость надписи, а не в середину её глубины, поэтому вся композиция уезжает
 * вправо метра на два, и стела, поставленная заподлицо с краем, первой лезет за рамку.
 * Отступ этот запас частично отыгрывает. Полностью его геометрией не убрать: пока прицел
 * стоит на передней плоскости, кадрирование считает нужную дальность по той же ширине, на
 * которую монумент уменьшили, и на вертикальном холсте промах возвращается тем же.
 */
const LINEUP_EDGE_SHARE = 0.09;
const LINEUP_Z_SHARE = -0.02;
const LINEUP_CAP = 0.26;
const LINEUP_TRACKING = 0.16;
const LINEUP_WEIGHT = 0.018;
const LINEUP_DEPTH = 0.22;
/** Доля толщины буквы, выступающая из стелы: остальное сидит в камне. */
const LINEUP_RELIEF = 0.5;
const LINEUP_BEVEL = 0.04;
const LINEUP_SEGMENTS = 2;
const STELE_GAP = 0.35;
const STELE_PAD = 1.3;
/** Глухое подножие стелы в высотах прописной имени: ниже строке начинаться нельзя. */
const STELE_FOOT = 1;
const STELE_DEPTH = 0.5;
const STELE_BATTER = 0.93;

/**
 * Охра по камню: краска, положенная в врезку, а не свет.
 *
 * Взята темнее, чем берут краску на бумаге. Солнце в этой сцене жжёт в три с половиной
 * силы, тональная кривая плёночная, а поверх всего идёт свечение от порога 0.72: светлый
 * красный на белом известняке выцветает в песок ещё до того, как попадёт в кадр.
 */
const OCHRE = { color: '#8f2b12', roughness: 0.78 };
/**
 * Горящая строка: холодный белый камень на чёрной стеле.
 *
 * Светом эту строку не выделить. Кругом полдень: песок, известняк и небо стоят светлыми,
 * а рядом горит огонь, и тёплое белое свечение садится ровно в его тон. Поэтому работают
 * два несветовых различия. Первое это подложка: стела у закрывающей строки гранитная, и
 * между буквой и камнем за ней остаётся почти вся шкала светлоты, тогда как на известняке
 * её было около нуля. Второе это температура: буква уведена в синеву, и с тёплым огнём она
 * спорит цветом, а не яркостью.
 *
 * Свечение оставлено, но малое. Известняк на солнце и так стоит у порога свечения
 * композитора, и добавка вдвое даёт не букву, а белое пятно во всю стелу.
 */
const BEACON = {
  color: '#e8f2ff',
  emissive: '#a8ccff',
  emissiveIntensity: 0.55,
  roughness: 0.4,
};
/**
 * Лампа горящей строки: светит только на свою стелу, дальше её съедает затухание.
 *
 * Вынос лампы от камня в высотах строчной прописной. Затухание квадратичное, и лампа,
 * подвешенная у самых букв, даёт не свет на строке, а прожжённое пятно посреди неё:
 * с четверти метра та же мощность бьёт в двадцать раз сильнее, чем с полутора.
 */
const BEACON_LIGHT = { intensity: 10, distance: 9, decay: 2, standoff: 3 };

/**
 * Доля разворота на съёмочную точку.
 *
 * Развернуть монумент на камеру целиком значит сделать из него плакат, оставить по осям
 * площадки значит потерять строку в ракурсе. Чуть больше половины угла: строка читается,
 * а свет остаётся косым и держит фаску в тени.
 */
const FACING_SHARE = 0.6;

const REQUIRED_EVENT_FIELDS = ['event', 'lineup'];

function requireEventFields(event) {
  const missing = REQUIRED_EVENT_FIELDS.filter((field) => !event?.[field]?.length);
  if (missing.length > 0) {
    throw new Error(`akhet: событие без полей ${missing.join(', ')}, высекать нечего`);
  }
}

function resolveBox(bounds) {
  const air = bounds?.radius ? bounds.radius * 2 : TYPE_BOX.width;
  return {
    width: Math.min(TYPE_BOX.width, air),
    top: TYPE_BOX.y + TYPE_BOX.height / 2,
    height: TYPE_BOX.height,
  };
}

/** Куда монумент повёрнут лицом: на точку съёмки афиши, но не до конца. */
function facingYaw() {
  const toCamera = Math.atan2(
    VIEW.poster.position[0] - TYPE_BOX.x,
    VIEW.poster.position[2] - TYPE_BOX.z,
  );
  return toCamera * FACING_SHARE;
}

/**
 * Ширина монумента: аллея вместе с фигурами, но не уже отданной коробки.
 *
 * Коробка нарисована под афишу, висящую в воздухе, и предмету на песке её мало. Монумент
 * стоит в устье аллеи и меряется по ней: две ширины крайнего ряда с фигурой.
 */
function monumentSpan(box) {
  const alley = (Math.abs(Math.min(...COLONNADE.rows)) + COLONNADE.capitalRadius) * 2;
  return Math.max(box.width, alley);
}

/**
 * Куда монумент выходит по глубине: перед аллеей, ближе камеры всего, что стоит на песке.
 *
 * Считается по самой дальней точке монумента, а не по его середине: развёрнутый на камеру
 * прямоугольник тянет назад свой правый угол, и уступить аллее должен именно он.
 */
function anchorZ(span, yaw) {
  const mouth = Math.max(...COLONNADE.stations) + COLONNADE.capitalRadius * 2;
  const back = span * (MASTABA_Z_SHARE - MASTABA_DEPTH_SHARE / 2);
  return mouth - back * Math.cos(yaw) + (span / 2) * Math.sin(yaw);
}

/** Высота прописной в единицах кегля: у шрифта её нет, она меряется по букве. */
function measureCapEm(font) {
  const probe = new TextGeometry(CAP_PROBE, {
    font,
    size: 1,
    depth: PROBE_DEPTH,
    curveSegments: 1,
    bevelEnabled: false,
  });
  probe.computeBoundingBox();
  const cap = probe.boundingBox.max.y;
  probe.dispose();
  return cap;
}

/**
 * Один глиф высотой в единицу, раздутый и растянутый до нужного характера.
 *
 * `bevelOffset` смещает наружу весь контур, `bevelSize` добавляет к этому смещению ещё и
 * подошву: лицо буквы выходит уже основания, и грань между ними это фаска. Растяжка
 * поперёк кладётся последней, уже на готовое тело, поэтому вертикальный штрих полнеет, а
 * горизонтальный остаётся прежним, как у резаного по камню.
 */
function glyphGeometry(font, glyph, options) {
  const { capEm, depth, bevel, curveSegments, weight = 0, widen = 1 } = options;
  const geometry = new TextGeometry(glyph, {
    font,
    size: 1 / capEm,
    depth,
    curveSegments,
    bevelEnabled: bevel > 0 || weight > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: weight,
    bevelSegments: 1,
  });
  if (widen !== 1) geometry.scale(widen, 1, 1);
  return geometry;
}

/** Блок ставят на площадку не идеально: завал вокруг собственной оси, а не вокруг строки. */
function settle(geometry, width, spread, sink, rng) {
  geometry.translate(-width / 2, 0, 0);
  geometry.rotateZ(rng.range(-spread, spread));
  geometry.rotateY(rng.range(-spread, spread));
  geometry.translate(width / 2, 0, rng.range(-sink, 0));
}

/**
 * Строка отдельными блоками, слитая в одну геометрию.
 *
 * Единица длины тут высота прописной: кегль подобран так, что она равна единице, и вся
 * раскладка снаружи считается в них. Начало строки в нуле, лицо букв в нуле по глубине,
 * тело уходит назад: так строку кладут на плоскость, не зная её толщины.
 */
function typeset(font, text, options) {
  const { tracking, set = 0, sink = 0, rng = null } = options;
  const letters = [];
  let cursor = 0;

  for (const glyph of text) {
    const geometry = glyphGeometry(font, glyph, options);
    geometry.computeBoundingBox();
    const width = geometry.boundingBox.max.x - geometry.boundingBox.min.x;
    if (!(width > 0)) {
      geometry.dispose();
      cursor += SPACE_ADVANCE + tracking;
      continue;
    }
    geometry.translate(-geometry.boundingBox.min.x, 0, 0);
    if (set > 0) settle(geometry, width, set, sink, rng);
    geometry.translate(cursor, 0, 0);
    letters.push(geometry);
    cursor += width + tracking;
  }

  if (letters.length === 0) throw new Error(`akhet: строка «${text}» не набралась ни одним глифом`);

  const geometry = mergeGeometries(letters, false);
  for (const letter of letters) letter.dispose();
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  geometry.translate(-min.x, 0, -max.z);
  return { geometry, width: max.x - min.x };
}

/** Строка из единиц прописной в метры: заодно и зерно камня, оно считается по метрам. */
function scaleRun(run, cap) {
  run.geometry.scale(cap, cap, cap);
  scaleUv(run.geometry, cap, cap);
  return run.geometry;
}

function place(geometry, x, y, z) {
  geometry.translate(x, y, z);
  return geometry;
}

/**
 * Имя события: строка блоков на ступенчатом стилобате, левым краем к краю монумента.
 *
 * Стоит впереди всего остального и ниже всего. Это не надпись на чём-то, а предмет на
 * песке, поэтому у него есть основание, а у основания свой вынос за строку. Вынос входит
 * в `right`: воздух до лайнапа меряется от края камня, а не от последней буквы.
 */
function buildName({ font, capEm, text, rng, span }) {
  const run = typeset(font, text, {
    capEm,
    tracking: NAME_TRACKING,
    depth: NAME_DEPTH,
    bevel: NAME_BEVEL,
    weight: NAME_WEIGHT,
    widen: NAME_WIDEN,
    curveSegments: NAME_SEGMENTS,
    set: NAME_SET,
    sink: NAME_SINK,
    rng,
  });

  const width = span * NAME_WIDTH_SHARE;
  const cap = width / run.width;
  const plinth = cap * PLINTH_HEIGHT;
  const left = -span / 2;
  const face = span * NAME_Z_SHARE;
  const depth = cap * NAME_DEPTH;
  const overhang = cap * PLINTH_OVERHANG;

  const letters = place(scaleRun(run, cap), left, plinth, face);

  const lower = plinth * PLINTH_STEP_SHARE;
  const steps = [
    { base: 0, height: lower, grow: overhang },
    { base: lower, height: plinth - lower, grow: overhang * PLINTH_STEP_SHARE },
  ].map(({ base, height, grow }) => place(
    stoneBox(width + grow * 2, height, depth + grow * 2).toNonIndexed(),
    left + width / 2,
    base + height / 2,
    face - depth / 2,
  ));

  return { letters, steps, cap, top: plinth + cap, right: left + width + overhang };
}

/**
 * Мастаба под отсчёт: тёмная гранитная площадка позади имени.
 *
 * Она держит две работы сразу. Снизу это фон, на котором светлое имя перестаёт спорить с
 * песком, сверху это подставка, поднимающая цифры выше всей надписи. Второй работы без
 * первой не бывает, поэтому гаснет она вместе с отсчётом: одна тёмная плита без цифр
 * читается дырой в кадре и вдобавок держит под себя место при кадрировании.
 *
 * Высота не выбрана, а отсчитана от верха имени: сколько бы ни занял стилобат с буквами,
 * площадка под цифры встанет над ним, а не вровень.
 */
function buildMastaba({ span, cap, above }) {
  const width = span * MASTABA_WIDTH_SHARE;
  const height = above + cap * MASTABA_RISE;
  const depth = span * MASTABA_DEPTH_SHARE;
  const center = -span / 2 + width / 2;
  const z = span * MASTABA_Z_SHARE;
  const block = taperedBox(width, height, depth, MASTABA_BATTER);
  return {
    geometry: place(block.toNonIndexed(), center, height / 2, z),
    top: height,
    // Передняя грань верхней площадки: наверху блок уже, чем у песка, на свой завал.
    face: z + (depth * MASTABA_BATTER) / 2,
    center,
    z,
    width,
  };
}

/**
 * Лайнап: стелы справа, строка в каждой читается сверху вниз.
 *
 * Полоса под стелы не задана числом, а осталась от имени: слева её держит край стилобата
 * плюс пролёт, справа край монумента. Высота стелы тоже посчитана, а не выбрана: имя
 * набирается общим для всех кеглем, и стела ровно настолько выше строки, насколько ей
 * нужны поля. Отсюда разнобой по высоте, он от длины имён, а не от вкуса.
 *
 * Строки разложены на две пачки. Закрывающая идёт горящей и вместе со своей стелой
 * уходит в гранит, остальные крашеными по известняку: правило позиционное, имён
 * конкретного лайнапа код не знает.
 */
function buildLineup({ font, capEm, names, span, cap, from }) {
  const band = span / 2 - span * LINEUP_EDGE_SHARE - from;
  if (band <= 0) throw new Error('akhet: лайнапу не осталось ширины, имя события съело монумент');

  const width = band / (names.length + (names.length - 1) * STELE_GAP);
  const gap = width * STELE_GAP;
  const lineCap = cap * LINEUP_CAP;
  const pad = lineCap * STELE_PAD;
  const foot = cap * STELE_FOOT;
  const depth = width * STELE_DEPTH;
  const z = span * LINEUP_Z_SHARE;

  const stelae = [];
  const painted = [];
  let closing = null;
  let burning = null;
  let beacon = null;

  names.forEach((name, index) => {
    const run = typeset(font, name, {
      capEm,
      tracking: LINEUP_TRACKING,
      depth: LINEUP_DEPTH,
      bevel: LINEUP_BEVEL,
      weight: LINEUP_WEIGHT,
      curveSegments: LINEUP_SEGMENTS,
    });
    const length = run.width * lineCap;
    const height = foot + length + pad * 2;
    const center = from + width / 2 + index * (width + gap);
    const slab = place(
      taperedBox(width, height, depth, STELE_BATTER).toNonIndexed(),
      center,
      height / 2,
      z,
    );

    const face = z + depth / 2 + lineCap * LINEUP_DEPTH * LINEUP_RELIEF;
    const column = scaleRun(run, lineCap);
    column.rotateZ(-Math.PI / 2);
    place(column, center - lineCap / 2, height - pad, face);

    if (index < names.length - 1) {
      stelae.push(slab);
      painted.push(column);
      return;
    }
    closing = slab;
    burning = column;
    beacon = new THREE.PointLight(
      BEACON.emissive,
      BEACON_LIGHT.intensity,
      BEACON_LIGHT.distance,
      BEACON_LIGHT.decay,
    );
    beacon.position.set(center, height - pad - length / 2, face + lineCap * BEACON_LIGHT.standoff);
  });

  return { stelae, closing, painted, burning, beacon };
}

/**
 * Отсчёт: цифры на мастабе, самые крупные буквы кадра.
 *
 * Кегль берётся вдвое с лишним от имени, но не шире площадки: с трёхзначного числа цифры
 * сами садятся мельче, лишь бы не свесились с камня. Лицо цифр вынесено на переднюю грань
 * мастабы, а не утоплено в её середину: посаженные по центру, они на треть уезжают внутрь
 * камня и с косого ракурса срезаются его же углом.
 *
 * В день события высекается ноль, а не слово из `todayLabel`: алфавит у этого камня
 * латинский, и кириллица осыпалась бы пустым местом.
 */
function createCountdown({ font, capEm, material, mastaba, box, nameCap }) {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.visible = false;

  const room = mastaba.width - nameCap * COUNTDOWN_MARGIN * 2;
  const ceiling = box.top - HALL.floorY - mastaba.top;
  let carved = null;

  return {
    mesh,
    show(days) {
      if (!Number.isFinite(days) || days < 0) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;
      const label = String(Math.max(0, Math.round(days)));
      if (label === carved) return;
      carved = label;

      const run = typeset(font, label, {
        capEm,
        tracking: COUNTDOWN_TRACKING,
        depth: COUNTDOWN_DEPTH,
        bevel: COUNTDOWN_BEVEL,
        weight: COUNTDOWN_WEIGHT,
        widen: COUNTDOWN_WIDEN,
        curveSegments: COUNTDOWN_SEGMENTS,
      });
      const cap = Math.min(nameCap * COUNTDOWN_CAP, room / run.width, ceiling);
      const digits = scaleRun(run, cap);
      place(
        digits,
        mastaba.center - (run.width * cap) / 2,
        mastaba.top,
        mastaba.face,
      );
      mesh.geometry.dispose();
      mesh.geometry = digits;
    },
  };
}

function carveMesh(geometries, material) {
  const mesh = new THREE.Mesh(mergeGeometries(geometries, false), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  for (const geometry of geometries) geometry.dispose();
  return mesh;
}

/** Краска и свечение: камень их не знает, они живут только на буквах лайнапа. */
function createInkMaterials(maps) {
  const ochre = new THREE.MeshStandardMaterial({
    color: OCHRE.color,
    roughness: OCHRE.roughness,
    metalness: 0,
    roughnessMap: maps.grain,
    bumpMap: maps.grain,
    bumpScale: NAME_BEVEL,
  });

  const beacon = new THREE.MeshStandardMaterial({
    color: BEACON.color,
    emissive: new THREE.Color(BEACON.emissive),
    emissiveIntensity: BEACON.emissiveIntensity,
    roughness: BEACON.roughness,
    metalness: 0,
  });

  return { ochre, beacon };
}

/**
 * Монумент афиши на площадке.
 *
 * От коробки берутся ширина как нижняя граница и потолок как предел для самой высокой
 * цифры. Место монумент выбирает себе сам: по оси коробки, но в устье аллеи, чтобы луч от
 * съёмочной точки до букв шёл над пустым песком.
 */
export async function createTypography({ event, rng, bounds, box = resolveBox(bounds) }) {
  requireEventFields(event);

  const font = new FontLoader().parse(fontData);
  const capEm = measureCapEm(font);
  const maps = createStoneMaps(rng);
  const materials = createMaterials(maps);
  const ink = createInkMaterials(maps);
  const ground = HALL.floorY;
  const span = monumentSpan(box);
  const yaw = facingYaw();

  const name = buildName({ font, capEm, text: event.event, rng, span });
  const mastaba = buildMastaba({ span, cap: name.cap, above: name.top });
  const lineup = buildLineup({
    font,
    capEm,
    names: event.lineup,
    span,
    cap: name.cap,
    from: name.right + span * LINEUP_AIR_SHARE,
  });

  const countdown = createCountdown({
    font,
    capEm,
    material: materials.limestone,
    mastaba,
    box,
    nameCap: name.cap,
  });
  const pedestal = new THREE.Mesh(mastaba.geometry, materials.granite);
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  pedestal.visible = false;

  const group = new THREE.Group();
  group.position.set(TYPE_BOX.x, ground, anchorZ(span, yaw));
  group.rotation.y = yaw;
  group.add(
    carveMesh([name.letters, ...lineup.stelae], materials.limestone),
    carveMesh([...name.steps, lineup.closing], materials.granite),
    carveMesh([lineup.burning], ink.beacon),
    lineup.beacon,
    pedestal,
    countdown.mesh,
  );
  // Лайнап из одного имени состоит из одной горящей строки, и красить в нём нечего.
  if (lineup.painted.length > 0) group.add(carveMesh(lineup.painted, ink.ochre));

  return {
    group,
    setDaysLeft(days) {
      countdown.show(days);
      pedestal.visible = countdown.mesh.visible;
    },
    // Камень не качается и не дышит: в этой сцене движется солнце, а надпись стоит.
    update() {},
  };
}
