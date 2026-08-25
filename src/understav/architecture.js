/**
 * Разрушенный индустриальный неф UNDERSTAV: бетон, ржавое железо и стальная роза.
 *
 * Всё, что повторяется, живёт одним `InstancedMesh` на сорт: пилоны, хомуты, звенья цепей,
 * прутья решёток, бочки. Кадр держит около трёх десятков вызовов отрисовки, поэтому в
 * бюджет влезают ещё и типографика с постобработкой.
 */

import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BEAT, PALETTE } from './palette.js';
import {
  besideType, BOUNDS, CORRIDOR, crossesTypeOnScreen, EMBER_RING, NAVE, ROSE, TYPE_BOX,
} from './nave.js';
import { createFloorSmoke, createGodRay, createHaze, createSparks } from './embers.js';
import { createCat } from './cat.js';
import { createRandom } from './random.js';
import { buildInstanced } from '../procedural/instancing.js';
import { DRUM_KINDS, drumGeometry } from '../procedural/drum.js';
import { createFireVolume } from '../procedural/fire-volume.js';
import { createBarbedWire } from './wire.js';
import { planChain } from '../procedural/chain.js';
import { rgba } from '../procedural/canvas-texture.js';
import {
  createAtlas,
  loadWearMap,
  paintPlacard,
  paintStains,
  paintStencil,
  tileToMeters,
} from '../procedural/grunge.js';
import {
  archZ,
  chainLink,
  flatDisc,
  hook,
  openBandY,
} from '../procedural/shapes.js';

const TAU = Math.PI * 2;
const HALF = 0.5;

const SHELL = { margin: 2, sink: 0.25 };

const PYLON = {
  perRow: [6, 9],
  width: 1.7,
  depth: 1.9,
  height: [12, 17],
  brokenChance: 0.28,
  brokenScale: [0.4, 0.68],
  startZ: 6,
  endZ: -18,
  jitterX: 0.35,
  jitterZ: 0.6,
  lean: 0.022,
  capHeight: 0.7,
  capOverhang: 0.4,
  clamps: [2, 4],
  clampHeight: 0.44,
  clampBulge: 0.42,
  clampSlide: 0.4,
  clampRustChance: 0.6,
};

const RIB = { count: [7, 11], radius: 12.8, apex: 21.5, thickness: 0.55 };

const RUBBLE = {
  count: [18, 30],
  size: [0.35, 1.5],
  radius: [8.5, 15],
  margin: 1,
  sit: 0.4,
  squash: [0.5, 1],
  stretch: [0.7, 1.2],
};

/**
 * Роза читается силуэтом с двадцати восьми метров, поэтому мерится не в долях, а в пикселях.
 *
 * Окно радиусом шесть метров занимает в кадре около двухсот шестидесяти пикселей: метр там
 * стоит примерно двадцать два пикселя. Прут в семь сантиметров это полтора пикселя, его
 * съедает свечение ещё до того, как его увидят. Поэтому несущий каркас взят в метрах
 * (обод полметра, лучи сорок шесть сантиметров), а тонкая арматура оставлена деталью второго
 * плана, которую не жалко потерять.
 *
 * Кольца собраны короткими коробками по хорде, а не открытыми цилиндрами: цилиндр в торце
 * зала стоит к камере ребром и в проекции схлопывается в волос.
 *
 * Заголовок стоит перед окном и с точки съёмки съедает нижнюю треть круга, поэтому верхняя
 * дуга держит рисунок одна: её сектора никогда не выбиваются и светят в полную силу.
 *
 * Ширины подобраны так, чтобы каркас закрывал примерно половину окна. Толще, и роза
 * слипается в чёрный диск, а свечение оставшихся щелей заливает его в белое пятно.
 */
const ROSE_PLAN = {
  spokes: [8, 11],
  spokePhase: Math.PI * 0.5,
  rimRadius: 0.955,
  rimWidth: 0.5,
  rimSegments: 36,
  beltRadius: 0.55,
  beltWidth: 0.36,
  beltSegments: 28,
  hubRadius: 0.19,
  hubWidth: 0.34,
  hubSegments: 14,
  hubCore: 0.85,
  spokeWidth: 0.46,
  cuspWidth: 0.28,
  foilRing: 0.74,
  foilFill: 0.2,
  foilWidth: 0.24,
  foilSegments: 8,
  foilDepth: 0.6,
  frameDepth: 0.55,
  rebar: [3, 6],
  rebarWidth: 0.12,
  rebarSpread: [0.15, 0.8],
  glassSegments: 6,
  glassGap: 0.06,
  glassChance: 0.82,
  glassBright: [0.3, 0.7],
  topArc: 0.1,
  topBright: [0.9, 1.15],
  glassDepth: 0.18,
  glowScale: 1.8,
  glowOffset: 0.55,
  glowOpacity: 0.34,
  glowSwing: 0.2,
  textureSize: 256,
  lift: 0.06,
};

const ALTAR = {
  barSpacing: 0.44,
  barThickness: 0.06,
  barHeight: 0.09,
  crossCount: 7,
  crossDrop: 1.7,
  rimTube: 0.1,
  steps: 3,
  stepDepth: 0.85,
  stepWidth: 3.4,
  stepTaper: 0.35,
  chainAngles: [0.25, 0.75, 1.25, 1.75],
  chainRadius: 5.4,
  chainClearance: 0.9,
  chainDrop: 0.4,
};

const GRATE = {
  patches: [3, 5],
  bars: 8,
  width: 1.6,
  length: 2.4,
  radius: [9, 16],
  lift: 0.03,
  margin: 2,
};

const CHAIN = { link: 0.13, tube: 0.035, step: 0.3 };

const RIM_SEGMENTS = { tube: 4, ring: 44 };
const HOLE_SEGMENTS = 32;

const BARREL = {
  extra: [8, 13],
  radius: 0.45,
  height: 1.1,
  jitter: 0.9,
  lean: 0.05,
  // Углей в бочке нет: их работу целиком делает объёмное пламя. Светящийся диск в горловине
  // и был той самой мигающей бочкой, за которую сцену ругали, а вдобавок одинокое яркое пятно
  // в полкадра растаскивает CHROMA: красный канал уходит на два десятка пикселей в сторону,
  // синий в другую, и от углей остаётся зелёный блин поперёк огня.
};

const JUNK = {
  chains: [6, 11],
  chainLength: [3, 9],
  hooks: [5, 9],
  ducts: [4, 8],
  ductRadius: [0.28, 0.55],
  ductLength: [2.5, 7],
  trays: [3, 6],
  trayLength: [4, 11],
  trayHeight: 0.18,
  trayWidth: 0.5,
  hang: [2, 6],
  hookDrop: 0.2,
  hookScale: [0.8, 1.6],
  hookTilt: [0.9, 1.1],
  spreadX: 11.5,
  spreadZ: [-19, 7],
  clearance: 1.2,
  freeBottom: 6,
  sway: 0.012,
  swaySpeed: 0.5,
};

const PUDDLE = {
  count: [8, 14],
  radius: [1.2, 3.6],
  squash: [0.5, 1],
  lift: 0.02,
  spreadX: 11,
  spreadZ: [-19, 8],
  opacity: 0.55,
};

/**
 * Шероховатость поверхностей: одна карта на камень, одна на железо.
 *
 * Ровная шероховатость по всей площади и есть то, что читается пластиком: свет ложится на
 * стену одинаково от угла до угла, чего не бывает ни с бетоном, ни с ржавым железом.
 *
 * Развёртка примитивов three лежит на единичной грани, а стены и пол растянуты инстансами на
 * десятки метров, поэтому карта повторяется, и шаг задаётся метрами поверхности: натянутая
 * на всю стену, она размазалась бы в кисель. `props` это характерный размер мелкой детали
 * зала, у которой метров не спросить: её грань и есть единица развёртки.
 */
const GRUNGE = {
  tile: 3.4,
  props: 2.4,
  bump: 0.08,
  crack: 'assets/textures/plaster-crack.png',
  drip: 'assets/textures/concrete-drip.png',
  scratch: 'assets/textures/metal-scratch.png',
};

/**
 * Грязь декалями: подтёки по стенам, пятна на полу, копоть под огнём и наклейки в коридоре.
 *
 * Декаль ложится только на обычный меш: проектор `DecalGeometry` читает одну матрицу меша, а
 * у `InstancedMesh` матрица своя на каждую копию. Поэтому грязь живёт на оболочке, полу,
 * плите коридора и торцевой стене, а пилоны с бочками остаются на карте шероховатости.
 *
 * Вся пачка идёт одним мешем на материал: пятно своим мешем стоило бы вызова отрисовки, а их
 * в кадре и без грязи больше сотни.
 */
const DIRT = {
  atlasSize: 512,
  depth: 1.6,
  offset: -4,
  order: 1,
  clean: '#ffffff',
};

const GRIME_CELL = { drip: 0, blot: 1, soot: 2, spatter: 3 };
const SIGN_CELL = { placard: 0, stencil: 1 };

// Клетки атласа грязи: у каждой свой набор пятен и потёков, порядок задаёт `GRIME_CELL`.
const GRIME_MIX = [
  { drips: 4, blots: 2 },
  { blots: 6 },
  { blots: 3, blotRadius: [0.24, 0.34], blotAlpha: [0.7, 0.95] },
  { drips: 2, blots: 4 },
];

const GRIME_WALL = {
  count: [4, 6],
  x: [7, 11.6],
  top: [11, 18],
  width: [1.8, 3.4],
  height: [5, 10],
  roll: 0.1,
};

const GRIME_SHELL = {
  count: [3, 5],
  z: [-18, 6],
  top: [9, 17],
  width: [2.4, 4.4],
  height: [5, 11],
};

const GRIME_FLOOR = {
  count: [5, 8],
  radius: [4.5, 11],
  size: [2.6, 5.4],
  soot: 4.2,
};

// Копоть кладётся только у зала: дальше по коридору пол и так уходит в темноту, и умножение
// там уже нечего гасить.
const GRIME_PATH = { toZ: 58, soot: 3.4, blots: [2, 4], z: [26, 56], x: 3.6, size: [2.6, 4.8] };

const SIGN = {
  placards: 2,
  placardZ: [30, 52],
  placardY: 3.6,
  placardWidth: [1.5, 2.2],
  placardRatio: 1.5,
  roll: 0.09,
  stencils: 2,
  stencilZ: [50, 78],
  stencilX: 2.4,
  stencilWidth: [1.6, 2.4],
  stencilRatio: 1.4,
};

// Пол подхода: восемь клеток на плитку, тон каждой чуть свой, поверх крап камня и грязь.
// Метры клетки задаются повтором текстуры по плите, а не размером холста.
const FLOOR_TILE = {
  textureSize: 512,
  cells: 8,
  cellMeters: 0.95,
  tone: [0.62, 1.05],
  specks: 26,
  speck: [0.006, 0.05],
  speckAlpha: 0.5,
  grime: 34,
  grimeRadius: [0.05, 0.3],
  grimeAlpha: [0.06, 0.3],
  darkShare: 0.65,
  anisotropy: 8,
};

const CHECKER = {
  textureSize: 256,
  cells: 8,
  bandCells: 12,
  bandShare: 0.17,
  scuffs: 90,
  scuff: [2, 14],
  bites: 9,
  bite: [10, 30],
};

const CROSS = {
  height: 1.9,
  span: 1.1,
  bar: 0.13,
  arm: 0.62,
  mount: 5.6,
  floorCount: [6, 10],
  floorRadius: [10, 15],
  floorScale: [0.7, 1.4],
  tilt: 0.4,
  facing: 0.6,
  procession: [8, 13],
  processionX: [2.2, 6.8],
  processionZ: [-20.5, -9],
  processionScale: [0.7, 1.5],
};

/**
 * Шахматка рассыпана кусками, а не натянута полотном.
 *
 * Сплошной щит за алтарём закрывал глубину зала, а именно глубина тут и работает, поэтому
 * клетка живёт затёртыми пятнами на полу и редкими флажками у стен. Середина нефа
 * остаётся пустой: там смотрят в туман.
 *
 * Пол ближе примерно z = -2.8 уходит за нижнюю кромку кадра, поэтому пятна ставятся
 * дальше этой отметки, иначе отрисовка уходит впустую.
 */
const CHECKER_SCATTER = {
  patches: [5, 9],
  patchSize: [1.6, 4.4],
  patchRadius: [7, 17],
  patchFarZ: -3.5,
  flags: [3, 5],
  flagSize: [1.1, 2.4],
  flagX: [6.5, 11.5],
  flagY: [4, 12],
  lift: 0.025,
};
const CHECKER_ALPHA_TEST = 0.5;

/**
 * Кольцо, по которому ходит кот.
 *
 * Круга вокруг алтаря в зале не нашлось: снаружи платформы радиусом 6 почти сразу
 * начинается лестница на z до 8.5, а за ней внутренняя грань колоннады на 7.8. Поэтому
 * кольцо унесено за алтарь, в пятно света из розы, где пол виден с камеры и пуст.
 */
const CAT = { z: -11.5, radius: 5, clearance: 0.9 };

// Коты коридора: гуляют своими кругами по дороге к залу, каждый в своём пролёте.
const CORRIDOR_CATS = [{ z: 34, radius: 3.6 }, { z: 74, radius: 4.2 }];

const CORRIDOR_COLUMN = { x: 5.4, radius: 0.5, height: 6.6 };
// Факелы: у зала в каждом пролёте, дальше через один. Сплошной ряд огня на всю длину
// превращает коридор в гирлянду, а редеющий вдаль ряд читается разметкой пути и подсказывает,
// в какой стороне зал. Света они не дают, это эмиссия: шесть источников уже заняты.
const CORRIDOR_TORCH = {
  everyBays: 2,
  denseToZ: 54,
  x: 5.9,
  y: 3.4,
  bracket: [0.5, 0.12, 0.12],
  flame: [0.22, 0.42],
  flameLift: 0.3,
  swing: 0.3,
};

// Стекло держится у порога свечения, а не за ним: выше порога роза выгорает в белое пятно
// и цветение затекает на прутья, съедая рисунок ровно тем, чем его собирались подсветить.
// Пол коридора: доля света у зала и в дальнем конце, крутизна спада и скорость потепления.
// Дальний конец уходит в лунную темноту, ближний остаётся цветом самого камня и не красится
// ничем: оранжевая плита у портала спорила с афишей и разрывала кадр надвое на стыке.
// Ближний край плиты почти гаснет намеренно: у зала она стыкуется с тёмным мокрым полом, и
// светлее его читается серой заплатой прямо в нижнем крае афиши. Свет на дорогу дают жаровни.
// `seamBlend` это метры, на которых плита коридора гаснет к стыку с залом. Без него на
// стыке двух разных материалов ложится светлая полоса, и в вертикальном кадре она режет
// кадр ровно под лайнапом.
const PATH = { steps: 64, near: 0.13, far: 0.045, falloff: 1.6, warmth: 3, seamBlend: 18 };
const PATH_COLD = new THREE.Color(PALETTE.moon);
const PATH_WARM = new THREE.Color(1, 1, 1);

// Реквизит коридора гаснет вдаль вместе с полом, но не до нуля: в чёрном пропадает силуэт,
// а вместе с ним и глубина, ради которой коридор и построен. Огонь гаснет мягче камня:
// он и в темноте обязан оставаться точкой, иначе дальний конец превращается в пустоту.
const CORRIDOR_DIM = 0.62;
const FLAME_DIM = 0.55;

// Пламя рисуется мягким пятном на квадрате, а не гранёным камешком: многогранник в упор
// читается лоуполли-обломком и убивает огонь. Ореол это тот же квадрат крупнее и тусклее,
// он идёт вторым инстансом в тот же меш и потому ничего не стоит по вызовам.
const FLAME = { textureSize: 96, haloScale: 2.8, haloShade: 0.16, gain: 1.5 };
// Огонь жаровен объёмный, а не щит с картинкой: по коридору камера идёт вплотную мимо них, и
// в упор щит выдаёт себя тем, что разворачивается следом за взглядом. Факелам и свечам объём
// не нужен, они мелкие и стоят далеко, а объёмный огонь стоит пикселей, а не треугольников.
// `sink` это метры, на которые основание пламени утоплено в жаровню: у объёмного огня низ
// коробки и есть низ пламени, и поставленный по краю он висит над углями отдельным телом.
const FIRE_VOLUME = { spread: 2.9, sink: 0.22, gain: 0.3, magnitude: 1.45, speed: 0.45 };

// Колючка поперёк коридора: чёрная, читается силуэтом на огне жаровен и на свете из портала.
// Прогоны идут парами выше и ниже линии полёта, чтобы камера проходила между ними, а не
// сквозь прут. Отрезок по Z берётся у самого коридора, а не выписан числами заново.
// Огонь бочек у алтаря: он в кадре афиши, поэтому объём нужен ему в первую очередь. Пламя
// шире и ниже коридорного: бочка стоит на полу зала, и высокий язык лезет в лайнап.
// Высота держится в полтора роста самой бочки. Втрое выше неё язык переставал читаться огнём
// в бочке: луч набирал плотность на всю высоту коробки, цветение растягивало её ещё, и по
// кругу алтаря вставали жёлтые столбы вдвое выше всего, что рядом. Свет от бочек эта правка
// не трогает: его дают точечные источники сцены, и он остался прежним.
const BARREL_FIRE = { width: 1.25, height: 1.7, sink: 0.26, gain: 0.3, magnitude: 1.25, speed: 0.4 };

const CORRIDOR_WIRE = { count: 5, width: 13.5, high: 5.4, low: 1.35, fromZ: 34, toZ: 96 };

// Дым коридора: тот же приземный дым, что в зале, но полосой по всей длине пути. Без него
// свет жаровен висит в пустоте, и коридор читается чёрной трубой, а не воздухом.
const CORRIDOR_SMOKE = { layers: 8, width: 12, farZ: 26, nearZ: 96, opacity: 0.1 };

// Пятно света под жаровней. Седьмого источника в бюджете нет, а огонь без отсвета на полу
// висит наклейкой, поэтому свет здесь нарисован: мягкий круг аддитивом под каждым огнём.
const FIRE_POOL = { radius: 3.2, opacity: 0.7, textureSize: 64, lift: 0.03, swing: 0.35 };

/**
 * Три события на пути: сорванные ворота на подходе, обвал в середине и стража вдоль дороги.
 *
 * Один пролёт, повторённый два десятка раз, читается заставкой, а не дорогой: зритель ловит
 * период с третьей арки и дальше смотрит мимо. Событие ломает период, и коридор снова длинный.
 */
const GATE = {
  z: 36,
  hingeX: 4.75,
  leaf: [3, 5.4, 0.22],
  open: 0.85,
  fallen: { x: 1.7, z: 41.4, lift: 0.36, tilt: 1.44, turn: 0.5 },
  lintel: [10.4, 0.55, 0.7],
  lintelY: 6.1,
  lintelSag: 0.05,
  rubble: [4, 7],
  rubbleSpread: [3.4, 2.6],
  braziers: { x: 4.3, z: 39.4, scale: 1.35 },
};

const COLLAPSE = {
  z: 62,
  beam: [13, 0.85, 0.95],
  beamY: 2.2,
  beamTurn: 0.44,
  beamTilt: 0.24,
  pile: [10, 16],
  piece: [0.4, 1.6],
  spread: [4.6, 3.4],
};

/**
 * Стража дороги: фигуры на плинтах вдоль самого прохода.
 *
 * У стен коридора им не место: пилястры стоят сплошным частоколом и боковые нефы с камеры
 * не видно вовсе, там пропадает что угодно. Читается только то, что стоит у прохода и берётся
 * силуэтом на светлом полу, поэтому фигуры вынесены к дороге и расставлены по очереди на
 * сторону: строй в затылок читается забором, зигзаг дорогой.
 */
const FIGURE = {
  count: [5, 8],
  zRange: [44, 88],
  x: 4.05,
  plinth: { width: 1.3, height: 0.45, depth: 1.2 },
  height: [1.9, 2.4],
  radius: [0.42, 0.56],
  taper: 0.3,
  segments: 10,
  lean: 0.07,
  head: 0.23,
  headlessChance: 0.34,
};

// Ступени порога: перепад уровня перед воротами. Поперечные полосы ложатся на светлый пол
// и дают дороге отсчёт, которого ровная плита не даёт.
const THRESHOLD = { steps: 3, fromZ: 44, depth: 1.5, rise: 0.17, width: 9.4 };

/**
 * Дорога огней: жаровни в проходе и свечи у ног фигур.
 *
 * Шаг между жаровнями растёт вдаль, поэтому огни сами сгущаются к залу, а после `litEnd`
 * не горит ни одна: дальний конец коридора мёртвый, и холодная жаровня в темноте говорит
 * об этом лучше, чем её отсутствие.
 */
const BRAZIER = {
  fromZ: 34,
  step: 4.6,
  stepGrowth: 0.14,
  toZ: 96,
  x: 3.6,
  jitter: 0.7,
  radius: 0.5,
  height: 0.9,
  flame: [0.4, 0.86],
  flameLift: 1.25,
  litFull: 52,
  litEnd: 92,
};

const CANDLE = {
  clusters: [4, 7],
  perCluster: [3, 6],
  x: [3, 3.8],
  spread: 0.8,
  radius: 0.06,
  height: [0.22, 0.5],
  flame: 0.13,
  flameStretch: 1.8,
  flameLift: 0.12,
  pool: 1.3,
};

// Кресты в проходе: те же, что в зале, только реже и мельче. Процессия крестов доводит
// мотив зала до самого коридора, поэтому дорога читается его частью, а не подъездом к нему.
const PATH_CROSS = {
  count: [6, 9],
  zRange: [40, 84],
  x: [2.3, 4.2],
  scale: [0.7, 1.2],
  lean: 0.22,
  fallenChance: 0.3,
  fallenTilt: 1.45,
  turn: 0.7,
};

// Цепь перекинута поперёк прохода и провисает дугой: вдоль стены она пропала бы в темноте,
// а поперёк берётся силуэтом на свету портала. Прямая между колоннами читалась бы трубой.
const SPAN_CHAIN = {
  count: [2, 4],
  zRange: [40, 70],
  x: 5.4,
  top: 6.4,
  sag: [1.4, 2.2],
  segments: 6,
};

const GLASS = { emissive: 1.3, swing: 0.2 };
const GLASS_TINT = new THREE.Color(PALETTE.moon);
// Множитель огня один на всю сцену и он тёплый почти белый. Красным его держать нельзя: цвет
// пламени несут сами картинки, и объёмная растяжка, и язык факела оранжевые, а красный
// множитель обнуляет им зелёный канал, оставляя ровное пятно без формы. Кратность у объёма
// доля, а не разы: луч копит растяжку двадцатью шагами и набирает втрое больше яркости кадра,
// а цветение подхватывает всё ярче 0.72, и жаровня с бочкой светились белым шаром на полкадра.
const FIRE_TINT = new THREE.Color(PALETTE.flame);
const FLICKER_SPEED = [3.7, 6.3];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** Доля света на пути: ноль это дальний конец коридора, единица порог зала. */
function pathLevel(nearness) {
  return PATH.far + (PATH.near - PATH.far) * nearness ** PATH.falloff;
}

function pathNearness(z) {
  const hall = NAVE.frontZ + SHELL.margin;
  const far = CORRIDOR.farZ + SHELL.margin;
  return clamp((far - z) / (far - hall), 0, 1);
}

/** Камень коридора темнеет вдаль вместе с полом: свет один на всё, что в нём стоит. */
function propLevel(z) {
  return CORRIDOR_DIM + (1 - CORRIDOR_DIM) * clamp(pathLevel(pathNearness(z)), 0, 1);
}

function flameLevel(z) {
  return FLAME_DIM + (1 - FLAME_DIM) * clamp(pathLevel(pathNearness(z)), 0, 1);
}

/** На тропе кота реквизит не ставится: иначе он проходит сквозь крест или бочку. */
function onCatRing(x, z) {
  const distance = Math.hypot(x, z - CAT.z);
  return Math.abs(distance - CAT.radius) < CAT.clearance;
}

function shadowCaster(mesh) {
  mesh.castShadow = true;
  return mesh;
}

/**
 * Заготовки на весь зал: единичные формы, которые инстансы растягивают до нужных метров.
 *
 * Кольца и арки сделаны открытыми цилиндрами, а не торами: полоса стали и есть полоса,
 * лишняя толщина трубы стоила бы треугольников и ничего не добавила бы в кадр.
 */
function createGeometries() {
  return {
    box: new THREE.BoxGeometry(1, 1, 1),
    bandY: openBandY(),
    archZ: archZ(),
    quad: new THREE.PlaneGeometry(1, 1),
    disc: flatDisc(),
    figure: openBandY({ top: FIGURE.taper, bottom: 1, segments: FIGURE.segments }),
    link: chainLink({ radius: CHAIN.link, tube: CHAIN.tube }),
    hook: hook(),
    chunk: new THREE.DodecahedronGeometry(1),
    rim: new THREE.TorusGeometry(NAVE.altarRadius, ALTAR.rimTube, RIM_SEGMENTS.tube, RIM_SEGMENTS.ring)
      .rotateX(Math.PI * HALF),
  };
}

function createMaterials({ roseGlow, checker, checkerFloor, fireGlow }) {
  const concrete = new THREE.MeshStandardMaterial({
    color: PALETTE.concrete,
    roughness: 0.96,
    metalness: 0.02,
    flatShading: true,
  });
  return {
    concrete,
    shell: new THREE.MeshStandardMaterial({
      color: PALETTE.concrete,
      roughness: 1,
      metalness: 0,
      side: THREE.BackSide,
    }),
    wall: new THREE.MeshStandardMaterial({
      color: PALETTE.concrete,
      roughness: 0.98,
      metalness: 0.02,
      side: THREE.DoubleSide,
      shadowSide: THREE.DoubleSide,
    }),
    // Пол коридора не освещается вовсе, его яркость целиком лежит в цвете вершин.
    // Освещаемая плита ловила зеркальный блик направленного света: тот не слабеет с
    // расстоянием, и на скользящем взгляде Френель поднимал его по всей длине до зеркала,
    // одинаково яркого и у зала, и в темноте. Никакой градиент по диффузу этого не перебивал.
    // Основа взята светлой намеренно: цвет вершин может только гасить, и на тёмном бетоне
    // весь градиент лёг бы в первые проценты яркости, то есть в чёрное.
    // Плита подхода: шахматка в карте, свет в цвете вершин. Свой цвет материала белый,
    // иначе он второй раз красит уже покрашенную текстуру.
    path: new THREE.MeshBasicMaterial({ map: checkerFloor, vertexColors: true }),
    floor: new THREE.MeshStandardMaterial({
      color: PALETTE.iron,
      // Пол мокрый, но не полированный: на низкой шероховатости он собирал вокруг алтаря
      // ровное зеркало без единой царапины, и подделка читалась раньше самой сцены.
      roughness: 0.62,
      metalness: 0.12,
    }),
    iron: new THREE.MeshStandardMaterial({
      color: PALETTE.iron,
      roughness: 0.55,
      metalness: 0.8,
      flatShading: true,
    }),
    // Каркас розы стоит против света и обязан быть чёрным силуэтом: и блик на металле, и
    // туман на пятидесяти метрах одинаково поднимают прутья до яркости стекла, после чего
    // рисунок пропадает. Поэтому материал не освещается и не туманится.
    tracery: new THREE.MeshBasicMaterial({ color: PALETTE.void, fog: false }),
    rust: new THREE.MeshStandardMaterial({
      color: PALETTE.rust,
      roughness: 0.92,
      metalness: 0.25,
      flatShading: true,
    }),
    // Стекло светит само и берёт яркость из цвета инстанса: только так сектора розы
    // отличаются друг от друга, ведь `emissive` у копий один на всех.
    glass: new THREE.MeshBasicMaterial({
      color: GLASS_TINT.clone().multiplyScalar(GLASS.emissive),
      side: THREE.DoubleSide,
      fog: false,
    }),
    // Белый материал под инстансы: цвет каждой копии приходит своим, поэтому ржавые жаровни
    // и костяные свечи живут в одном вызове отрисовки.
    tinted: new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.12, flatShading: true }),
    firePool: new THREE.MeshBasicMaterial({
      map: fireGlow,
      transparent: true,
      opacity: FIRE_POOL.opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
    reflection: new THREE.MeshBasicMaterial({
      map: roseGlow,
      transparent: true,
      opacity: PUDDLE.opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
    checker: new THREE.MeshStandardMaterial({
      map: checker,
      roughness: 0.7,
      metalness: 0.1,
      side: THREE.DoubleSide,
      alphaTest: CHECKER_ALPHA_TEST,
    }),
    halo: new THREE.MeshBasicMaterial({
      map: roseGlow,
      transparent: true,
      opacity: ROSE_PLAN.glowOpacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
  };
}

/**
 * Отражение розы для луж и подсвета за окном.
 *
 * Честные отражения тут не окупаются: рисунок розы один раз рисуется на canvas и потом
 * просто лежит аддитивным пятном в лужах.
 */
function createRoseGlowTexture(rng, spokes) {
  const size = ROSE_PLAN.textureSize;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const center = size / 2;

  const halo = ctx.createRadialGradient(center, center, 0, center, center, center);
  halo.addColorStop(0, rgba(PALETTE.bone, 0.9));
  halo.addColorStop(0.4, rgba(PALETTE.moon, 0.3));
  halo.addColorStop(1, rgba(PALETTE.moon, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = rgba(PALETTE.moon, 0.45);
  for (let index = 0; index < spokes; index += 1) {
    const angle = (index / spokes) * TAU;
    ctx.lineWidth = rng.range(2, 5);
    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.lineTo(center + Math.cos(angle) * center, center + Math.sin(angle) * center);
    ctx.stroke();
  }
  for (const ring of [ROSE_PLAN.rimRadius, ROSE_PLAN.beltRadius, ROSE_PLAN.hubRadius]) {
    ctx.lineWidth = rng.range(2, 4);
    ctx.beginPath();
    ctx.arc(center, center, center * ring, 0, TAU);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Отсвет огня на полу: мягкий круг, которым коридор освещается вместо седьмой лампы. */
function createFireGlowTexture() {
  const size = FIRE_POOL.textureSize;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const center = size * HALF;
  const glow = ctx.createRadialGradient(center, center, 0, center, center, center);
  glow.addColorStop(0, rgba(PALETTE.ember, 0.8));
  glow.addColorStop(0.4, rgba(PALETTE.emberHalo, 0.26));
  glow.addColorStop(1, rgba(PALETTE.emberHalo, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Язык пламени: силуэт огня, а не круглое пятно.
 *
 * Радиальная растяжка, растянутая инстансом, даёт светящийся овал: огня в нём ровно столько
 * же, сколько в фонаре. Форму огню держит контур, поэтому язык рисуется путём: широкое
 * основание, перегиб и вытянутое остриё, которое уводит вбок. Заливка идёт снизу вверх, от
 * белой сердцевины к оранжевому краю и в ноль на самом кончике, а вокруг остаётся мягкий
 * ореол, иначе вырезанный контур читается наклейкой.
 */
function createFlameTexture() {
  const size = FLAME.textureSize;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const center = size * HALF;

  const halo = ctx.createRadialGradient(center, size * 0.62, 0, center, size * 0.62, center);
  halo.addColorStop(0, rgba(PALETTE.emberHalo, 0.34));
  halo.addColorStop(1, rgba(PALETTE.ember, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  ctx.beginPath();
  ctx.moveTo(center, size);
  ctx.bezierCurveTo(size * 0.94, size * 0.8, size * 0.78, size * 0.46, size * 0.56, 0);
  ctx.bezierCurveTo(size * 0.4, size * 0.4, size * 0.14, size * 0.62, size * 0.12, size * 0.84);
  ctx.bezierCurveTo(size * 0.16, size * 0.96, size * 0.3, size, center, size);
  ctx.closePath();
  const body = ctx.createLinearGradient(0, size, 0, 0);
  body.addColorStop(0, rgba(PALETTE.ember, 0.35));
  body.addColorStop(0.18, rgba(PALETTE.bone, 1));
  body.addColorStop(0.5, rgba(PALETTE.emberHalo, 0.85));
  body.addColorStop(0.82, rgba(PALETTE.ember, 0.38));
  body.addColorStop(1, rgba(PALETTE.ember, 0));
  ctx.fillStyle = body;
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function paintChecker(ctx, x, y, width, height, cells) {
  const cell = width / cells;
  const rows = Math.max(1, Math.round(height / cell));
  const rowHeight = height / rows;
  ctx.fillStyle = rgba(PALETTE.bone, 1);
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = rgba(PALETTE.void, 1);
  for (let row = 0; row < rows; row += 1) {
    for (let column = row % 2; column < cells; column += 2) {
      ctx.fillRect(x + column * cell, y + row * rowHeight, cell, rowHeight);
    }
  }
}

function bitePoint(edge, along, size) {
  if (edge === 0) return [along, 0];
  if (edge === 1) return [size, along];
  if (edge === 2) return [along, size];
  return [0, along];
}

function wearAndTear(ctx, rng, size) {
  ctx.fillStyle = rgba(PALETTE.concrete, 0.5);
  for (let index = 0; index < CHECKER.scuffs; index += 1) {
    ctx.fillRect(rng() * size, rng() * size, rng.range(...CHECKER.scuff), rng.range(1, 3));
  }
  // Дыры выедаются в альфу, поэтому полотно и его тень рвутся одинаково: карта теней
  // читает ту же альфу через alphaTest.
  ctx.globalCompositeOperation = 'destination-out';
  for (let index = 0; index < CHECKER.bites; index += 1) {
    const [x, y] = bitePoint(rng.int(0, 3), rng() * size, size);
    ctx.beginPath();
    ctx.arc(x, y, rng.range(...CHECKER.bite), 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function createTexture(paint, textureSize = CHECKER.textureSize) {
  const size = textureSize;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  paint(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Шахматка во всё поле: она ложится на пол, где по ней никто не читает буквы. */
/**
 * Шахматный пол подхода: тот же приём, что у полотен, но плитка целая и грязная.
 *
 * Клетка не рисуется ровной заливкой: у камня свой крап, у затёртого пола свои пятна, и без
 * них шахматка в кадре читается служебной сеткой из редактора. Всё кладётся с заворотом за
 * край, иначе на стыке плитки видно шов.
 */
function createCheckerFloorTexture(rng) {
  return createTexture((ctx, size) => {
    paintCheckerStone(ctx, rng, size);
    grindFloor(ctx, rng, size);
  }, FLOOR_TILE.textureSize);
}

/** Клетки с разбросом тона и крапом камня: соседние плитки не бывают одинаковыми. */
function paintCheckerStone(ctx, rng, size) {
  const cell = size / FLOOR_TILE.cells;
  const stone = new THREE.Color();
  for (let row = 0; row < FLOOR_TILE.cells; row += 1) {
    for (let column = 0; column < FLOOR_TILE.cells; column += 1) {
      const light = (row + column) % 2 === 0;
      stone.set(light ? PALETTE.bone : PALETTE.void)
        .multiplyScalar(rng.range(...FLOOR_TILE.tone));
      ctx.fillStyle = `#${stone.getHexString()}`;
      ctx.fillRect(column * cell, row * cell, cell, cell);
      speckleCell(ctx, rng, column * cell, row * cell, cell, light);
    }
  }
}

/** Крап камня: на светлой плитке тёмный, на тёмной светлый, иначе клетка выглядит краской. */
function speckleCell(ctx, rng, x, y, cell, light) {
  ctx.fillStyle = rgba(light ? PALETTE.void : PALETTE.bone, FLOOR_TILE.speckAlpha);
  for (let index = 0; index < FLOOR_TILE.specks; index += 1) {
    const radius = rng.range(...FLOOR_TILE.speck) * cell;
    ctx.beginPath();
    ctx.ellipse(
      x + rng() * cell,
      y + rng() * cell,
      radius,
      radius * rng.range(0.5, 1),
      rng() * TAU,
      0,
      TAU,
    );
    ctx.fill();
  }
}

/** Грязь поверх плитки: пятна с заворотом за край, чтобы стык плитки не читался линией. */
function grindFloor(ctx, rng, size) {
  for (let index = 0; index < FLOOR_TILE.grime; index += 1) {
    const radius = rng.range(...FLOOR_TILE.grimeRadius) * size;
    const x = rng() * size;
    const y = rng() * size;
    const dark = rng() < FLOOR_TILE.darkShare;
    ctx.fillStyle = rgba(dark ? PALETTE.void : PALETTE.rust, rng.range(...FLOOR_TILE.grimeAlpha));
    for (const shiftX of [-size, 0, size]) {
      for (const shiftY of [-size, 0, size]) {
        ctx.beginPath();
        ctx.ellipse(x + shiftX, y + shiftY, radius, radius * rng.range(0.4, 1), 0, 0, TAU);
        ctx.fill();
      }
    }
  }
}

function createCheckerTexture(rng) {
  return createTexture((ctx, size) => {
    paintChecker(ctx, 0, 0, size, size, CHECKER.cells);
    wearAndTear(ctx, rng, size);
  });
}

function planCheckerScatter(rng) {
  const pieces = [];
  const patches = rng.int(...CHECKER_SCATTER.patches);
  for (let index = 0; index < patches; index += 1) {
    const angle = rng() * TAU;
    const away = rng.range(...CHECKER_SCATTER.patchRadius);
    const size = rng.range(...CHECKER_SCATTER.patchSize);
    const x = clamp(Math.cos(angle) * away, -NAVE.halfWidth + 1, NAVE.halfWidth - 1);
    const z = clamp(Math.sin(angle) * away, NAVE.endZ + 1, CHECKER_SCATTER.patchFarZ);
    pieces.push({
      flat: true,
      x,
      y: CHECKER_SCATTER.lift,
      z,
      turn: rng() * TAU,
      width: size,
      height: size * rng.range(0.5, 1),
    });
  }
  const flags = rng.int(...CHECKER_SCATTER.flags);
  for (let index = 0; index < flags; index += 1) {
    const size = rng.range(...CHECKER_SCATTER.flagSize);
    pieces.push({
      flat: false,
      x: rng.sign() * rng.range(...CHECKER_SCATTER.flagX),
      y: rng.range(...CHECKER_SCATTER.flagY),
      z: rng.range(NAVE.endZ + 2, CHECKER_SCATTER.patchFarZ),
      turn: rng.range(-CROSS.facing, CROSS.facing),
      width: size,
      height: size * rng.range(0.8, 1.4),
    });
  }
  return pieces;
}

function buildCheckerScatter(rng, geometries, materials) {
  const pieces = planCheckerScatter(rng);
  const mesh = buildInstanced(geometries.quad, materials.checker, pieces.length, (item, index) => {
    const piece = pieces[index];
    item.position.set(piece.x, piece.y, piece.z);
    // Пятну на полу разворот идёт по собственной нормали, иначе поворот вокруг Y уводит
    // плоскость из горизонтали и кусок встаёт на ребро.
    if (piece.flat) item.rotation.set(-Math.PI * HALF, 0, piece.turn);
    else item.rotation.set(0, piece.turn, 0);
    item.scale.set(piece.width, piece.height, 1);
  }, (color, index) => color.set(pieces[index].flat ? PALETTE.concrete : PALETTE.bone));
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Кресты стоят лицом в камеру, а не ребром.
 *
 * Крест в плоскости вдоль нефа с фронта читается просто вертикальной палкой, поэтому
 * настенные вешаются на грань пилона, смотрящую в +Z, а напольные только слегка развёрнуты.
 */
function planCrosses(rng, pylons) {
  const list = [];
  for (const pylon of pylons) {
    if (pylon.broken) continue;
    list.push({
      x: pylon.x,
      y: CROSS.mount,
      z: pylon.z + PYLON.depth * HALF + CROSS.bar,
      turn: 0,
      tilt: 0,
      scale: 1,
    });
  }
  // Процессия в глубину: кресты уходят за алтарь к торцу и тонут в дымке, это и есть
  // то, ради чего в кадре держат перспективу.
  const procession = rng.int(...CROSS.procession);
  for (let index = 0; index < procession; index += 1) {
    const along = (index + HALF) / procession;
    const scale = rng.range(...CROSS.processionScale);
    const x = rng.sign() * rng.range(...CROSS.processionX);
    const z = CROSS.processionZ[1] + (CROSS.processionZ[0] - CROSS.processionZ[1]) * along
      + rng.range(-1, 1);
    if (onCatRing(x, z)) continue;
    list.push({
      x,
      y: CROSS.height * scale * HALF,
      z,
      turn: rng.range(-CROSS.facing, CROSS.facing),
      tilt: rng.range(-CROSS.tilt, CROSS.tilt),
      scale,
    });
  }

  const standing = rng.int(...CROSS.floorCount);
  for (let index = 0; index < standing; index += 1) {
    const angle = rng() * TAU;
    const away = rng.range(...CROSS.floorRadius);
    const scale = rng.range(...CROSS.floorScale);
    list.push({
      x: clamp(Math.cos(angle) * away, -NAVE.halfWidth + 1, NAVE.halfWidth - 1),
      y: CROSS.height * scale * HALF,
      z: clamp(Math.sin(angle) * away, NAVE.endZ + 1, NAVE.frontZ),
      turn: rng.range(-CROSS.facing, CROSS.facing),
      tilt: rng.range(-CROSS.tilt, CROSS.tilt),
      scale,
    });
  }
  return list;
}

function buildCrosses(rng, geometries, materials, pylons) {
  const crosses = planCrosses(rng, pylons);
  const mesh = buildInstanced(geometries.box, materials.rust, crosses.length * 2, (item, index) => {
    const cross = crosses[index >> 1];
    const arm = index % 2 === 1;
    item.position.set(cross.x, cross.y, cross.z);
    item.rotation.set(0, cross.turn, cross.tilt);
    item.translateY(arm ? CROSS.height * cross.scale * (CROSS.arm - HALF) : 0);
    item.scale.set(
      (arm ? CROSS.span : CROSS.bar) * cross.scale,
      (arm ? CROSS.bar : CROSS.height) * cross.scale,
      CROSS.bar * cross.scale,
    );
  }, (color, index) => color.set(index % 2 === 0 ? PALETTE.rust : PALETTE.iron));
  return shadowCaster(mesh);
}

function planPylons(rng) {
  const perRow = rng.int(...PYLON.perRow);
  const list = [];
  for (const side of [-1, 1]) {
    for (let index = 0; index < perRow; index += 1) {
      const along = perRow === 1 ? 0 : index / (perRow - 1);
      const full = rng.range(...PYLON.height);
      const broken = rng() < PYLON.brokenChance;
      list.push({
        x: side * (NAVE.colonnadeHalfWidth + rng.range(-PYLON.jitterX, PYLON.jitterX)),
        z: PYLON.startZ + (PYLON.endZ - PYLON.startZ) * along
          + rng.range(-PYLON.jitterZ, PYLON.jitterZ),
        height: broken ? full * rng.range(...PYLON.brokenScale) : full,
        broken,
        lean: rng.range(-PYLON.lean, PYLON.lean),
      });
    }
  }
  return list;
}

function planClamps(rng, pylons) {
  const list = [];
  for (const pylon of pylons) {
    const count = rng.int(...PYLON.clamps);
    for (let index = 0; index < count; index += 1) {
      list.push({
        pylon,
        y: pylon.height * ((index + 1) / (count + 1))
          + rng.range(-PYLON.clampSlide, PYLON.clampSlide),
        rusty: rng() < PYLON.clampRustChance,
      });
    }
  }
  return list;
}

function buildColonnade(rng, geometries, materials, pylons) {
  const shafts = buildInstanced(geometries.box, materials.concrete, pylons.length, (item, index) => {
    const pylon = pylons[index];
    item.position.set(pylon.x, pylon.height * HALF, pylon.z);
    item.rotation.z = pylon.lean;
    item.scale.set(PYLON.width, pylon.height, PYLON.depth);
  });
  shafts.castShadow = true;
  shafts.receiveShadow = true;

  const capped = pylons.filter((pylon) => !pylon.broken);
  const capitals = buildInstanced(geometries.box, materials.concrete, capped.length, (item, index) => {
    const pylon = capped[index];
    item.position.set(pylon.x, pylon.height + PYLON.capHeight * HALF, pylon.z);
    item.rotation.z = pylon.lean;
    item.scale.set(
      PYLON.width + PYLON.capOverhang * 2,
      PYLON.capHeight,
      PYLON.depth + PYLON.capOverhang * 2,
    );
  });
  shadowCaster(capitals);

  const clamps = planClamps(rng, pylons);
  const collars = buildInstanced(geometries.bandY, materials.rust, clamps.length, (item, index) => {
    const collar = clamps[index];
    item.position.set(collar.pylon.x, collar.y, collar.pylon.z);
    item.rotation.z = collar.pylon.lean;
    item.scale.set(
      PYLON.width * HALF + PYLON.clampBulge,
      PYLON.clampHeight,
      PYLON.depth * HALF + PYLON.clampBulge,
    );
  }, (color, index) => color.set(clamps[index].rusty ? PALETTE.rust : PALETTE.iron));
  shadowCaster(collars);

  return [shafts, capitals, collars];
}

function buildRibs(rng, geometries, materials) {
  const count = rng.int(...RIB.count);
  return buildInstanced(geometries.archZ, materials.concrete, count, (item, index) => {
    const along = (index + HALF) / count;
    item.position.set(0, RIB.apex - RIB.radius, NAVE.endZ + (NAVE.frontZ - NAVE.endZ) * along);
    item.scale.set(RIB.radius, RIB.radius, RIB.thickness);
  });
}

function buildRubble(rng, geometries, materials) {
  const count = rng.int(...RUBBLE.count);
  return buildInstanced(geometries.chunk, materials.concrete, count, (item) => {
    const angle = rng() * TAU;
    const radius = rng.range(...RUBBLE.radius);
    const size = rng.range(...RUBBLE.size);
    item.position.set(
      clamp(Math.cos(angle) * radius, -NAVE.halfWidth + RUBBLE.margin, NAVE.halfWidth - RUBBLE.margin),
      size * RUBBLE.sit,
      clamp(Math.sin(angle) * radius, NAVE.endZ + RUBBLE.margin, NAVE.frontZ),
    );
    item.rotation.set(rng() * TAU, rng() * TAU, rng() * TAU);
    item.scale.set(size, size * rng.range(...RUBBLE.squash), size * rng.range(...RUBBLE.stretch));
  });
}

function buildEndWall(materials) {
  const shape = new THREE.Shape();
  shape.moveTo(-NAVE.halfWidth, 0);
  shape.lineTo(NAVE.halfWidth, 0);
  shape.lineTo(NAVE.halfWidth, NAVE.vaultHeight);
  shape.lineTo(-NAVE.halfWidth, NAVE.vaultHeight);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, ROSE.y, ROSE.radius, 0, TAU, true);
  shape.holes.push(hole);

  const wall = new THREE.Mesh(new THREE.ShapeGeometry(shape, HOLE_SEGMENTS), materials.wall);
  wall.position.z = NAVE.endZ;
  wall.castShadow = true;
  wall.receiveShadow = true;
  return wall;
}

/** Кольцо, набранное коробками по хорде: у полосы есть ширина, и её видно с камеры. */
function pushRing(bars, center, radius, width, segments, depth) {
  const chord = 2 * radius * Math.tan(Math.PI / segments);
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * TAU;
    bars.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
      turn: angle + Math.PI * HALF,
      length: chord,
      width,
      depth,
    });
  }
}

function pushSpan(bars, from, to, width, depth) {
  bars.push({
    x: (from.x + to.x) * HALF,
    y: (from.y + to.y) * HALF,
    turn: Math.atan2(to.y - from.y, to.x - from.x),
    length: Math.hypot(to.x - from.x, to.y - from.y),
    width,
    depth,
  });
}

function polar(radius, angle) {
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/** Луч смотрит вверх, поэтому рисунок симметричен относительно вертикали кадра. */
function spokeAngle(index, spokes) {
  return (index / spokes) * TAU + ROSE_PLAN.spokePhase;
}

/**
 * Каркас розы: обод, пояс, ступица, лучи, стрельчатые дольки и розетки в них.
 *
 * Сид меняет число лучей, ржавчину и выбитые сектора стекла, но набор частей постоянный:
 * иначе на неудачном сиде роза перестала бы быть розой.
 */
function planRoseFrame(rng, spokes) {
  const bars = [];
  const center = { x: 0, y: 0 };
  const rim = ROSE_PLAN.rimRadius * ROSE.radius;
  const belt = ROSE_PLAN.beltRadius * ROSE.radius;
  const hub = ROSE_PLAN.hubRadius * ROSE.radius;

  pushRing(bars, center, rim, ROSE_PLAN.rimWidth, ROSE_PLAN.rimSegments, ROSE_PLAN.frameDepth);
  pushRing(bars, center, belt, ROSE_PLAN.beltWidth, ROSE_PLAN.beltSegments, ROSE_PLAN.frameDepth);
  pushRing(bars, center, hub, ROSE_PLAN.hubWidth, ROSE_PLAN.hubSegments, ROSE_PLAN.frameDepth);

  bars.push({
    x: 0,
    y: 0,
    turn: Math.PI / 4,
    length: ROSE_PLAN.hubCore,
    width: ROSE_PLAN.hubCore,
    depth: ROSE_PLAN.frameDepth,
  });

  const foilCenter = ROSE_PLAN.foilRing * ROSE.radius;
  const foilRadius = ((TAU * foilCenter) / spokes) * ROSE_PLAN.foilFill;
  for (let index = 0; index < spokes; index += 1) {
    const angle = spokeAngle(index, spokes);
    const middle = spokeAngle(index + HALF, spokes);
    pushSpan(bars, polar(hub, angle), polar(rim, angle), ROSE_PLAN.spokeWidth,
      ROSE_PLAN.frameDepth);
    // Долька острая, а не круглая: две тяги от пояса сходятся в точку на ободе.
    const tip = polar(rim, middle);
    pushSpan(bars, polar(belt, angle), tip, ROSE_PLAN.cuspWidth, ROSE_PLAN.foilDepth);
    pushSpan(bars, polar(belt, spokeAngle(index + 1, spokes)), tip, ROSE_PLAN.cuspWidth,
      ROSE_PLAN.foilDepth);
    pushRing(bars, polar(foilCenter, middle), foilRadius, ROSE_PLAN.foilWidth,
      ROSE_PLAN.foilSegments, ROSE_PLAN.foilDepth);
  }

  const rebar = rng.int(...ROSE_PLAN.rebar);
  for (let index = 0; index < rebar; index += 1) {
    const angle = rng() * TAU;
    const offset = rng.range(...ROSE_PLAN.rebarSpread) * ROSE.radius;
    const half = Math.sqrt(Math.max(0, ROSE.radius * ROSE.radius - offset * offset));
    bars.push({
      x: Math.cos(angle + Math.PI * HALF) * offset,
      y: Math.sin(angle + Math.PI * HALF) * offset,
      turn: angle,
      length: half * 2,
      width: ROSE_PLAN.rebarWidth,
      depth: ROSE_PLAN.rebarWidth,
    });
  }
  return bars;
}

/**
 * Сектор стекла: выбить можно любой, кроме верхней дуги.
 *
 * Низ круга закрыт заголовком, и если сид выбьет заодно пару верхних секторов, рисунка в
 * кадре не останется вовсе. Поэтому наверху стекло всегда цело и всегда светит ярче.
 */
function planPanes(rng, spokes) {
  const panes = [];
  for (let index = 0; index < spokes; index += 1) {
    const top = Math.sin(spokeAngle(index + HALF, spokes)) > ROSE_PLAN.topArc;
    if (top) {
      panes.push({ index, bright: rng.range(...ROSE_PLAN.topBright) });
      continue;
    }
    if (rng() < ROSE_PLAN.glassChance) {
      panes.push({ index, bright: rng.range(...ROSE_PLAN.glassBright) });
    }
  }
  return panes;
}

function planRose(rng) {
  const spokes = rng.int(...ROSE_PLAN.spokes);
  return {
    spokes,
    bars: planRoseFrame(rng, spokes),
    outer: planPanes(rng, spokes),
    inner: planPanes(rng, spokes),
  };
}

/** Сектор стекла между двумя лучами: доли считаются в метрах, инстанс только поворачивают. */
function glassSector(spokes, from, to) {
  const span = TAU / spokes;
  return new THREE.RingGeometry(
    from * ROSE.radius,
    to * ROSE.radius,
    ROSE_PLAN.glassSegments,
    1,
    ROSE_PLAN.glassGap * HALF,
    span - ROSE_PLAN.glassGap,
  );
}

function buildRoseGlass(materials, rose, geometry, panes) {
  const mesh = buildInstanced(geometry, materials.glass, panes.length, (item, index) => {
    item.position.set(0, ROSE.y, NAVE.endZ - ROSE_PLAN.glassDepth);
    item.rotation.z = spokeAngle(panes[index].index, rose.spokes);
  }, (color, index) => color.setScalar(panes[index].bright));
  return mesh;
}

function buildRoseFrame(geometries, materials, rose) {
  const tracery = buildInstanced(
    geometries.box,
    materials.tracery,
    rose.bars.length,
    (item, index) => {
      const bar = rose.bars[index];
      item.position.set(bar.x, ROSE.y + bar.y, NAVE.endZ + ROSE_PLAN.lift);
      item.rotation.z = bar.turn;
      item.scale.set(bar.length, bar.width, bar.depth);
    },
  );
  shadowCaster(tracery);

  const halo = new THREE.Mesh(geometries.quad, materials.halo);
  halo.position.set(0, ROSE.y, NAVE.endZ - ROSE_PLAN.glowOffset);
  halo.scale.setScalar(ROSE.radius * ROSE_PLAN.glowScale);
  halo.renderOrder = -1;

  return [
    halo,
    buildRoseGlass(materials, rose, glassSector(rose.spokes, ROSE_PLAN.beltRadius, 1), rose.outer),
    buildRoseGlass(
      materials,
      rose,
      glassSector(rose.spokes, ROSE_PLAN.hubRadius, ROSE_PLAN.beltRadius),
      rose.inner,
    ),
    tracery,
  ];
}

function planBars(rng) {
  const bars = [];
  const radius = NAVE.altarRadius;
  for (let z = -radius + ALTAR.barSpacing * HALF; z < radius; z += ALTAR.barSpacing) {
    bars.push({
      x: 0,
      y: NAVE.altarHeight - ALTAR.barHeight * HALF,
      z,
      length: 2 * Math.sqrt(Math.max(0, radius * radius - z * z)),
      turn: 0,
    });
  }
  for (let index = 0; index < ALTAR.crossCount; index += 1) {
    const x = -radius + 2 * radius * ((index + HALF) / ALTAR.crossCount);
    bars.push({
      x,
      y: NAVE.altarHeight - ALTAR.barHeight * ALTAR.crossDrop,
      z: 0,
      length: 2 * Math.sqrt(Math.max(0, radius * radius - x * x)),
      turn: Math.PI * HALF,
    });
  }

  const patches = rng.int(...GRATE.patches);
  for (let patch = 0; patch < patches; patch += 1) {
    const angle = rng() * TAU;
    const away = rng.range(...GRATE.radius);
    const centerX = clamp(
      Math.cos(angle) * away,
      -NAVE.halfWidth + GRATE.margin,
      NAVE.halfWidth - GRATE.margin,
    );
    const centerZ = clamp(Math.sin(angle) * away, NAVE.endZ + GRATE.margin, NAVE.frontZ);
    const turn = rng.pick([0, Math.PI * HALF]);
    for (let index = 0; index < GRATE.bars; index += 1) {
      const offset = -GRATE.width * HALF + GRATE.width * ((index + HALF) / GRATE.bars);
      bars.push({
        x: centerX + (turn === 0 ? 0 : offset),
        y: GRATE.lift,
        z: centerZ + (turn === 0 ? offset : 0),
        length: GRATE.length,
        turn,
      });
    }
  }
  return bars;
}

function buildGrating(rng, geometries, materials) {
  const bars = planBars(rng);
  const mesh = buildInstanced(geometries.box, materials.iron, bars.length, (item, index) => {
    const bar = bars[index];
    item.position.set(bar.x, bar.y, bar.z);
    item.rotation.y = bar.turn;
    item.scale.set(bar.length, ALTAR.barHeight, ALTAR.barThickness);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildRim(geometries, materials) {
  const rim = new THREE.Mesh(geometries.rim, materials.iron);
  rim.position.y = NAVE.altarHeight - ALTAR.rimTube;
  return shadowCaster(rim);
}

function buildSteps(geometries, materials) {
  const mesh = buildInstanced(geometries.box, materials.concrete, ALTAR.steps, (item, index) => {
    const height = (NAVE.altarHeight * (index + 1)) / ALTAR.steps;
    item.position.set(
      0,
      height * HALF,
      NAVE.altarRadius + ALTAR.stepDepth * (ALTAR.steps - index - HALF),
    );
    item.scale.set(ALTAR.stepWidth - index * ALTAR.stepTaper, height, ALTAR.stepDepth);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildChain(geometries, materials, links, tint) {
  return buildInstanced(geometries.link, materials.rust, links.length, (item, index) => {
    const link = links[index];
    item.position.copy(link.point);
    item.quaternion.copy(link.twist);
    item.rotateY(link.flip * Math.PI * HALF);
  }, tint);
}

/**
 * Цепи алтаря обрамляют текст, а не перечёркивают его.
 *
 * Кольцо радиусом с алтарь ставило все четыре цепи на луч зрения поверх имён, поэтому
 * место по оси зала остаётся, а поперёк цепь уводится за экранный край коробки.
 */
function buildAltarChains(geometries, materials) {
  const links = [];
  for (const turn of ALTAR.chainAngles) {
    const angle = turn * Math.PI;
    const z = Math.sin(angle) * ALTAR.chainRadius;
    const x = besideType(Math.cos(angle) * ALTAR.chainRadius, z, ALTAR.chainClearance);
    planChain(
      links,
      new THREE.Vector3(x, NAVE.vaultHeight - ALTAR.chainDrop, z),
      new THREE.Vector3(x, NAVE.altarHeight, z),
      CHAIN.step,
    );
  }
  return shadowCaster(buildChain(geometries, materials, links));
}

/**
 * Низ подвешенного хлама: над коробкой типографики висеть нечему.
 *
 * Половина габарита предмета входит в проверку, иначе длинный лоток краем заедет в текст,
 * хотя его середина висит снаружи.
 */
/**
 * Роза единственное светлое пятно кадра, и поперечная балка на её фоне читается чёрной дырой.
 *
 * Убирать хлам оттуда совсем незачем: достаточно развернуть его вдоль зала, тогда он уходит
 * в перспективу точкой, а не перечёркивает окно.
 */
function crossesRose(x) {
  return Math.abs(x) < ROSE.radius + JUNK.clearance;
}

function junkBottom(x, z, halfX = 0) {
  if (!crossesTypeOnScreen(x, z, JUNK.clearance + halfX)) return JUNK.freeBottom;
  return TYPE_BOX.y + TYPE_BOX.height * HALF + JUNK.clearance;
}

function planJunkChains(rng) {
  const links = [];
  const tips = [];
  const count = rng.int(...JUNK.chains);
  for (let index = 0; index < count; index += 1) {
    const x = rng.range(-JUNK.spreadX, JUNK.spreadX);
    const z = rng.range(...JUNK.spreadZ);
    const bottom = Math.max(junkBottom(x, z), NAVE.vaultHeight - rng.range(...JUNK.chainLength));
    planChain(
      links,
      new THREE.Vector3(x, NAVE.vaultHeight, z),
      new THREE.Vector3(x, bottom, z),
      CHAIN.step,
    );
    tips.push({ x, y: bottom, z });
  }
  return { links, tips };
}

function buildJunk(rng, geometries, materials) {
  const group = new THREE.Group();
  group.position.y = NAVE.vaultHeight;

  const { links, tips } = planJunkChains(rng);
  for (const link of links) link.point.y -= NAVE.vaultHeight;
  group.add(buildChain(geometries, materials, links));

  const hooks = rng.int(...JUNK.hooks);
  group.add(buildInstanced(geometries.hook, materials.rust, hooks, (item, index) => {
    const tip = tips[index % tips.length];
    item.position.set(tip.x, tip.y - NAVE.vaultHeight - JUNK.hookDrop, tip.z);
    item.rotation.set(0, rng() * TAU, Math.PI * rng.range(...JUNK.hookTilt));
    item.scale.setScalar(rng.range(...JUNK.hookScale));
  }));

  const ducts = rng.int(...JUNK.ducts);
  const pipes = buildInstanced(geometries.bandY, materials.iron, ducts, (item) => {
    const x = rng.range(-JUNK.spreadX, JUNK.spreadX);
    const z = rng.range(...JUNK.spreadZ);
    const radius = rng.range(...JUNK.ductRadius);
    const length = rng.range(...JUNK.ductLength);
    const alongZ = rng() < HALF || crossesRose(x);
    const bottom = junkBottom(x, z, alongZ ? 0 : length * HALF);
    item.position.set(x, bottom + rng.range(...JUNK.hang) - NAVE.vaultHeight, z);
    item.rotation.set(alongZ ? Math.PI * HALF : 0, 0, alongZ ? 0 : Math.PI * HALF);
    item.scale.set(radius, length, radius);
  }, (color) => color.set(rng() < HALF ? PALETTE.rust : PALETTE.iron));
  group.add(shadowCaster(pipes));

  const trays = rng.int(...JUNK.trays);
  group.add(buildInstanced(geometries.box, materials.rust, trays, (item) => {
    const x = rng.range(-JUNK.spreadX, JUNK.spreadX);
    const z = rng.range(...JUNK.spreadZ);
    const length = rng.range(...JUNK.trayLength);
    const alongZ = rng() < HALF || crossesRose(x);
    const bottom = junkBottom(x, z, alongZ ? 0 : length * HALF);
    item.position.set(x, bottom + rng.range(...JUNK.hang) - NAVE.vaultHeight, z);
    item.rotation.y = alongZ ? Math.PI * HALF : 0;
    item.scale.set(length, JUNK.trayHeight, JUNK.trayWidth);
  }));

  return group;
}

function planBarrels(rng) {
  const angles = [...EMBER_RING.anchors];
  const extra = rng.int(...BARREL.extra);
  for (let index = 0; index < extra; index += 1) angles.push(rng() * TAU);
  const placed = [];
  for (let index = 0; index < angles.length; index += 1) {
    const radius = EMBER_RING.radius + rng.range(-BARREL.jitter, BARREL.jitter);
    const x = Math.cos(angles[index]) * radius;
    const z = Math.sin(angles[index]) * radius;
    // Закреплённые бочки не выбрасываются никогда: на них смотрят точечные источники.
    const anchored = index < EMBER_RING.anchors.length;
    if (!anchored && onCatRing(x, z)) continue;
    placed.push({
      x,
      z,
      lean: rng.range(-BARREL.lean, BARREL.lean),
      kind: rng.pick(DRUM_KINDS),
      spin: rng() * TAU,
    });
  }
  return placed;
}

/** Огонь в бочках зала: тот же объёмный костёр, что в коридоре, только шире и ниже. */
function buildBarrelFires(rng, barrels) {
  return barrels.map((barrel) => {
    const size = { width: BARREL_FIRE.width, height: BARREL_FIRE.height };
    const fire = createFireVolume({
      size,
      color: FIRE_TINT.clone().multiplyScalar(BARREL_FIRE.gain),
      seed: rng.range(0, TAU),
      noise: { magnitude: BARREL_FIRE.magnitude, speed: BARREL_FIRE.speed },
    });
    fire.mesh.position.set(barrel.x, BARREL.height - BARREL_FIRE.sink + size.height / 2, barrel.z);
    return fire;
  });
}

/**
 * Бочки по видам: свой `InstancedMesh` на вид.
 *
 * Вид отличается геометрией, а `InstancedMesh` держит одну на все копии, поэтому три вида
 * это три вызова отрисовки вместо одного. Это и есть вся цена разнообразия: тринадцать
 * одинаковых бочек по кругу читаются копипастой раньше, чем зритель успевает их сосчитать.
 */
function buildBarrels(rng, geometries, materials, barrels) {
  const drums = DRUM_KINDS.map((kind) => {
    const family = barrels.filter((barrel) => barrel.kind === kind);
    if (family.length === 0) return null;
    const mesh = buildInstanced(drumGeometry({ kind, rng }), materials.rust, family.length,
      (item, index) => {
        const barrel = family[index];
        item.position.set(barrel.x, 0, barrel.z);
        item.rotation.set(0, barrel.spin, barrel.lean);
        item.scale.set(BARREL.radius, BARREL.height, BARREL.radius);
      });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }).filter(Boolean);

  return drums;
}

function buildPuddles(rng, geometries, materials) {
  const count = rng.int(...PUDDLE.count);
  return buildInstanced(geometries.disc, materials.reflection, count, (item) => {
    const radius = rng.range(...PUDDLE.radius);
    item.position.set(
      rng.range(-PUDDLE.spreadX, PUDDLE.spreadX),
      PUDDLE.lift,
      rng.range(...PUDDLE.spreadZ),
    );
    item.rotation.y = rng() * TAU;
    item.scale.set(radius, 1, radius * rng.range(...PUDDLE.squash));
  });
}

/** Фигуры стоят по очереди на сторону: строй в затылок читается забором, зигзаг дорогой. */
function planFigures(rng) {
  const count = rng.int(...FIGURE.count);
  const figures = [];
  for (let index = 0; index < count; index += 1) {
    const along = (index + HALF) / count;
    figures.push({
      x: (index % 2 === 0 ? -1 : 1) * FIGURE.x,
      z: FIGURE.zRange[0] + (FIGURE.zRange[1] - FIGURE.zRange[0]) * along + rng.range(-1, 1),
      height: rng.range(...FIGURE.height),
      radius: rng.range(...FIGURE.radius),
      lean: rng.range(-FIGURE.lean, FIGURE.lean),
      headless: rng() < FIGURE.headlessChance,
    });
  }
  return figures;
}

function planCorridorArches(first, bays) {
  const list = [];
  const collapsed = Math.round((COLLAPSE.z - first) / CORRIDOR.span);
  for (let bay = 0; bay < bays; bay += 1) {
    // Свод над завалом обрушен: он и лежит поперёк прохода, оттого завал там и оказался.
    if (bay === collapsed) continue;
    list.push({
      x: 0,
      y: CORRIDOR.arch.lift,
      z: first + bay * CORRIDOR.span,
      radius: CORRIDOR.arch.radius,
      thickness: CORRIDOR.arch.thickness,
    });
  }
  return list;
}

/** Ступени порога: подъём к воротам, поперечные полосы на светлом полу. */
function planThreshold() {
  const blocks = [];
  for (let step = 0; step < THRESHOLD.steps; step += 1) {
    const height = THRESHOLD.rise * (THRESHOLD.steps - step);
    blocks.push({
      x: 0,
      y: height * HALF,
      z: THRESHOLD.fromZ + step * THRESHOLD.depth,
      sx: THRESHOLD.width,
      sy: height,
      sz: THRESHOLD.depth,
    });
  }
  return blocks;
}

function planPlinths(figures) {
  return figures.map((figure) => ({
    x: figure.x,
    y: FIGURE.plinth.height * HALF,
    z: figure.z,
    sx: FIGURE.plinth.width,
    sy: FIGURE.plinth.height,
    sz: FIGURE.plinth.depth,
  }));
}

/**
 * Ворота на дороге: одна створка держится на петле, вторая сорвана и лежит в проходе.
 *
 * Целые ворота закрыли бы кадр, а пустой проём ничего не рассказывает. Ближе к залу их не
 * поставить: с двадцати шести метров начинается кадр афиши, и перекладина легла бы поперёк
 * лайнапа, поэтому створки стоят там, где их видит только пролёт.
 */
function planGate() {
  const [width, height, thickness] = GATE.leaf;
  const swing = width * HALF;
  const [lintelWidth, lintelHeight, lintelDepth] = GATE.lintel;
  return [
    {
      x: -GATE.hingeX + Math.cos(GATE.open) * swing,
      y: height * HALF,
      z: GATE.z + Math.sin(GATE.open) * swing,
      sx: width,
      sy: height,
      sz: thickness,
      yaw: -GATE.open,
    },
    {
      x: GATE.fallen.x,
      y: GATE.fallen.lift,
      z: GATE.fallen.z,
      sx: width,
      sy: height,
      sz: thickness,
      pitch: GATE.fallen.tilt,
      yaw: GATE.fallen.turn,
    },
    {
      x: 0,
      y: GATE.lintelY,
      z: GATE.z,
      sx: lintelWidth,
      sy: lintelHeight,
      sz: lintelDepth,
      roll: GATE.lintelSag,
    },
  ];
}

/**
 * Кресты в проходе: те же две коробки, что в зале, поставленные редко и вразнобой.
 *
 * Перекладина едет вдоль оси креста, поэтому её смещение поворачивается вместе с ним: у
 * лежащего креста она уходит по Z, а не висит в воздухе там, где была бы у стоящего.
 */
function planPathCrosses(rng) {
  const blocks = [];
  const count = rng.int(...PATH_CROSS.count);
  for (let index = 0; index < count; index += 1) {
    const along = (index + HALF) / count;
    const scale = rng.range(...PATH_CROSS.scale);
    const height = CROSS.height * scale;
    const fallen = rng() < PATH_CROSS.fallenChance;
    const pitch = fallen
      ? PATH_CROSS.fallenTilt * rng.sign()
      : rng.range(-PATH_CROSS.lean, PATH_CROSS.lean);
    const yaw = rng.range(-PATH_CROSS.turn, PATH_CROSS.turn);
    const x = rng.sign() * rng.range(...PATH_CROSS.x);
    const z = PATH_CROSS.zRange[0]
      + (PATH_CROSS.zRange[1] - PATH_CROSS.zRange[0]) * along + rng.range(-1.5, 1.5);
    const y = fallen ? CROSS.bar * scale : height * HALF;
    blocks.push({
      x,
      y,
      z,
      sx: CROSS.bar * scale,
      sy: height,
      sz: CROSS.bar * scale,
      pitch,
      yaw,
    });
    const reach = height * (CROSS.arm - HALF);
    blocks.push({
      x,
      y: y + Math.cos(pitch) * reach,
      z: z + Math.sin(pitch) * reach,
      sx: CROSS.span * scale,
      sy: CROSS.bar * scale,
      sz: CROSS.bar * scale,
      pitch,
      yaw,
    });
  }
  return blocks;
}

function pushChunk(rng, chunks, x, y, z, size) {
  chunks.push({
    x,
    y,
    z,
    size,
    squash: rng.range(...RUBBLE.squash),
    stretch: rng.range(...RUBBLE.stretch),
    turn: [rng() * TAU, rng() * TAU, rng() * TAU],
  });
}

function planCorridorChunks(rng, figures) {
  const chunks = [];
  for (const figure of figures) {
    if (figure.headless) continue;
    const head = FIGURE.plinth.height + figure.height + FIGURE.head * HALF;
    pushChunk(rng, chunks, figure.x, head, figure.z, FIGURE.head);
  }
  const pile = rng.int(...COLLAPSE.pile);
  for (let index = 0; index < pile; index += 1) {
    const size = rng.range(...COLLAPSE.piece);
    pushChunk(
      rng,
      chunks,
      rng.range(-COLLAPSE.spread[0], COLLAPSE.spread[0]),
      size * RUBBLE.sit,
      COLLAPSE.z + rng.range(-COLLAPSE.spread[1], COLLAPSE.spread[1]),
      size,
    );
  }
  const rubble = rng.int(...GATE.rubble);
  for (let index = 0; index < rubble; index += 1) {
    const size = rng.range(...COLLAPSE.piece);
    pushChunk(
      rng,
      chunks,
      rng.range(-GATE.rubbleSpread[0], GATE.rubbleSpread[0]),
      size * RUBBLE.sit,
      GATE.z + rng.range(0, GATE.rubbleSpread[1] * 2),
      size,
    );
  }
  return chunks;
}

function planBraziers(rng) {
  const spots = [];
  for (const side of [-1, 1]) {
    spots.push({
      x: side * GATE.braziers.x,
      z: GATE.braziers.z,
      size: GATE.braziers.scale,
      lit: true,
    });
  }
  let z = BRAZIER.fromZ;
  let step = BRAZIER.step;
  let side = 1;
  while (z < BRAZIER.toZ) {
    const chance = (BRAZIER.litEnd - z) / (BRAZIER.litEnd - BRAZIER.litFull);
    spots.push({
      x: side * (BRAZIER.x + rng.range(-BRAZIER.jitter, BRAZIER.jitter)),
      z,
      size: 1,
      lit: rng() < chance,
    });
    side = -side;
    z += step;
    step *= 1 + BRAZIER.stepGrowth;
  }
  return spots;
}

/** Свечи горят у ног фигур: огонь на полу должен на что-то указывать, иначе он декорация. */
function planCandles(rng, figures) {
  const candles = [];
  const clusters = rng.int(...CANDLE.clusters);
  for (let index = 0; index < clusters; index += 1) {
    const figure = figures[index % figures.length];
    const count = rng.int(...CANDLE.perCluster);
    for (let candle = 0; candle < count; candle += 1) {
      candles.push({
        x: Math.sign(figure.x) * rng.range(...CANDLE.x),
        z: figure.z + rng.range(-CANDLE.spread, CANDLE.spread),
        height: rng.range(...CANDLE.height),
      });
    }
  }
  return candles;
}

// Ближе к залу факелы стоят в каждом пролёте, дальше через один: огня на подходе прибывает.
function planTorches(first, bays) {
  const torches = [];
  for (let bay = 0; bay < bays; bay += 1) {
    const z = first + bay * CORRIDOR.span;
    if (z > CORRIDOR_TORCH.denseToZ && bay % CORRIDOR_TORCH.everyBays !== 0) continue;
    for (const side of [-1, 1]) torches.push({ x: side * CORRIDOR_TORCH.x, z });
  }
  return torches;
}

function planFlames(torches, candles) {
  const flames = torches.map((torch) => ({
    x: torch.x,
    y: CORRIDOR_TORCH.y + CORRIDOR_TORCH.flameLift,
    z: torch.z,
    size: CORRIDOR_TORCH.flame,
  }));
  for (const candle of candles) {
    flames.push({
      x: candle.x,
      y: candle.height + CANDLE.flameLift,
      z: candle.z,
      size: [CANDLE.flame, CANDLE.flame * CANDLE.flameStretch],
    });
  }
  return flames;
}

/** Провисающая цепь: дуга набирается прямыми кусками, прямая между колоннами это труба. */
function planSagChain(links, from, to, sag, segments) {
  const point = (share) => new THREE.Vector3(
    from.x + (to.x - from.x) * share,
    from.y + (to.y - from.y) * share - sag * 4 * share * (1 - share),
    from.z + (to.z - from.z) * share,
  );
  for (let index = 0; index < segments; index += 1) {
    planChain(links, point(index / segments), point((index + 1) / segments), CHAIN.step);
  }
}

function planCorridorChains(rng, first, bays) {
  const links = [];
  const count = rng.int(...SPAN_CHAIN.count);
  for (let index = 0; index < count; index += 1) {
    const along = (index + HALF) / count;
    const z = SPAN_CHAIN.zRange[0] + (SPAN_CHAIN.zRange[1] - SPAN_CHAIN.zRange[0]) * along;
    const bay = clamp(Math.round((z - first) / CORRIDOR.span), 0, bays - 1);
    const bayZ = first + bay * CORRIDOR.span;
    planSagChain(
      links,
      new THREE.Vector3(-SPAN_CHAIN.x, SPAN_CHAIN.top, bayZ),
      new THREE.Vector3(SPAN_CHAIN.x, SPAN_CHAIN.top, bayZ),
      rng.range(...SPAN_CHAIN.sag),
      SPAN_CHAIN.segments,
    );
  }
  return links;
}

function buildBlocks(geometries, material, blocks) {
  return buildInstanced(geometries.box, material, blocks.length, (item, index) => {
    const block = blocks[index];
    item.position.set(block.x, block.y, block.z);
    item.rotation.set(block.pitch ?? 0, block.yaw ?? 0, block.roll ?? 0);
    item.scale.set(block.sx, block.sy, block.sz);
  }, (color, index) => color.setScalar(propLevel(blocks[index].z)));
}

function buildCorridorStone(rng, geometries, materials, { first, bays, figures }) {
  const archPlan = planCorridorArches(first, bays);
  const arches = buildInstanced(geometries.archZ, materials.concrete, archPlan.length,
    (item, index) => {
      const arch = archPlan[index];
      item.position.set(arch.x, arch.y, arch.z);
      item.scale.set(arch.radius, arch.radius, arch.thickness);
    }, (color, index) => color.setScalar(propLevel(archPlan[index].z)));

  const piers = buildInstanced(geometries.box, materials.concrete, bays * 2, (item, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    item.position.set(
      side * CORRIDOR.pier.x,
      CORRIDOR.arch.lift * HALF,
      first + Math.floor(index / 2) * CORRIDOR.span,
    );
    item.scale.set(CORRIDOR.pier.width, CORRIDOR.arch.lift, CORRIDOR.pier.depth);
  }, (color, index) => color.setScalar(propLevel(first + Math.floor(index / 2) * CORRIDOR.span)));

  const columns = buildInstanced(geometries.bandY, materials.concrete, bays * 2, (item, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    item.position.set(
      side * CORRIDOR_COLUMN.x,
      CORRIDOR_COLUMN.height * HALF,
      first + Math.floor(index / 2) * CORRIDOR.span,
    );
    item.scale.set(CORRIDOR_COLUMN.radius, CORRIDOR_COLUMN.height, CORRIDOR_COLUMN.radius);
  }, (color, index) => color.setScalar(propLevel(first + Math.floor(index / 2) * CORRIDOR.span)));

  const blocks = buildBlocks(geometries, materials.concrete, [
    ...planThreshold(),
    ...planPlinths(figures),
    {
      x: 0,
      y: COLLAPSE.beamY,
      z: COLLAPSE.z,
      sx: COLLAPSE.beam[0],
      sy: COLLAPSE.beam[1],
      sz: COLLAPSE.beam[2],
      yaw: COLLAPSE.beamTurn,
      roll: COLLAPSE.beamTilt,
    },
  ]);

  const chunkPlan = planCorridorChunks(rng, figures);
  const chunks = buildInstanced(geometries.chunk, materials.concrete, chunkPlan.length,
    (item, index) => {
      const piece = chunkPlan[index];
      item.position.set(piece.x, piece.y, piece.z);
      item.rotation.set(...piece.turn);
      item.scale.set(piece.size, piece.size * piece.squash, piece.size * piece.stretch);
    }, (color, index) => color.setScalar(propLevel(chunkPlan[index].z)));

  const guards = buildInstanced(geometries.figure, materials.concrete, figures.length,
    (item, index) => {
      const figure = figures[index];
      item.position.set(figure.x, FIGURE.plinth.height + figure.height * HALF, figure.z);
      item.rotation.z = figure.lean;
      item.scale.set(figure.radius, figure.height, figure.radius);
    }, (color, index) => color.setScalar(propLevel(figures[index].z)));

  const ironwork = buildBlocks(geometries, materials.iron, [
    ...planGate(),
    ...planPathCrosses(rng),
  ]);

  return [arches, piers, columns, blocks, chunks, guards, ironwork];
}

function buildCorridorFire(rng, geometries, materials, flameMaterial, { torches, braziers, candles }) {
  const brackets = buildInstanced(geometries.box, materials.rust, torches.length,
    (item, index) => {
      item.position.set(torches[index].x, CORRIDOR_TORCH.y, torches[index].z);
      item.scale.set(...CORRIDOR_TORCH.bracket);
    }, (color, index) => color.setScalar(propLevel(torches[index].z)));

  const stems = [
    ...braziers.map((spot) => ({
      x: spot.x,
      z: spot.z,
      radius: BRAZIER.radius * spot.size,
      height: BRAZIER.height * spot.size,
      color: PALETTE.rust,
    })),
    ...candles.map((candle) => ({
      x: candle.x,
      z: candle.z,
      radius: CANDLE.radius,
      height: candle.height,
      color: PALETTE.bone,
    })),
  ];
  const bodies = buildInstanced(geometries.bandY, materials.tinted, stems.length,
    (item, index) => {
      const stem = stems[index];
      item.position.set(stem.x, stem.height * HALF, stem.z);
      item.scale.set(stem.radius, stem.height, stem.radius);
    }, (color, index) =>
      color.set(stems[index].color).multiplyScalar(propLevel(stems[index].z)));

  const lit = braziers.filter((spot) => spot.lit);

  // Свечи светят наравне с жаровнями: огонь, не кладущий пятна под ноги, выглядит наклейкой.
  const glows = [
    ...lit.map((spot) => ({ x: spot.x, z: spot.z, radius: FIRE_POOL.radius * spot.size })),
    ...candles.map((candle) => ({ x: candle.x, z: candle.z, radius: CANDLE.pool })),
  ];
  const pools = buildInstanced(geometries.disc, materials.firePool, glows.length, (item, index) => {
    const glow = glows[index];
    item.position.set(glow.x, FIRE_POOL.lift, glow.z);
    item.scale.setScalar(glow.radius);
  }, (color, index) => color.setScalar(flameLevel(glows[index].z)));

  const fires = lit.map((spot) => {
    const size = {
      width: BRAZIER.flame[0] * spot.size * FIRE_VOLUME.spread,
      height: BRAZIER.flame[1] * spot.size * FIRE_VOLUME.spread,
    };
    const flame = createFireVolume({
      size,
      // Дальняя жаровня тусклее ближней ровно как весь реквизит коридора: иначе дальний огонь
      // в чёрном конце горит ярче того, что стоит у зала.
      color: FIRE_TINT.clone().multiplyScalar(FIRE_VOLUME.gain * flameLevel(spot.z)),
      seed: rng.range(0, TAU),
      noise: { magnitude: FIRE_VOLUME.magnitude, speed: FIRE_VOLUME.speed },
    });
    flame.mesh.position.set(
      spot.x,
      BRAZIER.height * spot.size - FIRE_VOLUME.sink + size.height / 2,
      spot.z,
    );
    return flame;
  });

  // Факелам и свечам идёт пара инстансов на огонь: язык и ореол вокруг него.
  const flamePlan = planFlames(torches, candles);
  const flames = buildInstanced(geometries.quad, flameMaterial, flamePlan.length * 2,
    (item, index) => {
      const flame = flamePlan[index >> 1];
      const spread = index % 2 === 1 ? FLAME.haloScale : 1;
      item.position.set(flame.x, flame.y, flame.z);
      item.scale.set(flame.size[0] * 2 * spread, flame.size[1] * 2 * spread, 1);
    }, (color, index) => color.setScalar(
      flameLevel(flamePlan[index >> 1].z) * (index % 2 === 1 ? FLAME.haloShade : 1),
    ));

  return { parts: [brackets, bodies, pools, flames], fires };
}

/**
 * Оснастка коридора: только цепи поперёк прохода.
 *
 * Полотнища в шахмату отсюда убраны. Плоский щит с узором на стене прохода читается не флагом
 * рейва, а иконой в киоте: он единственный предмет коридора с рисунком, и взгляд цепляется за
 * него как за надпись, которой там нет. Коридор говорит огнём, колючкой и цепями.
 */
function buildCorridorRig(rng, geometries, materials, { first, bays }) {
  const links = planCorridorChains(rng, first, bays);
  const chains = buildChain(geometries, materials, links,
    (color, index) => color.setScalar(propLevel(links[index].point.z)));

  return [chains];
}

/**
 * Коридор к порталу: ряд арок на пилястрах, по которому камера подлетает издалека.
 *
 * Тени он не отбрасывает намеренно: коробка теней держится вокруг алтаря, до коридора она
 * не достаёт, а проход геометрии в ней всё равно платный. Свет тоже не заводится: все шесть
 * источников стоят в зале, а огонь коридора это эмиссия и цвет копий.
 */
function buildCorridor(rng, geometries, materials) {
  const first = NAVE.frontZ + CORRIDOR.span;
  const bays = Math.floor((CORRIDOR.farZ - first) / CORRIDOR.span) + 1;
  const figures = planFigures(rng);
  const braziers = planBraziers(rng);
  const candles = planCandles(rng, figures);
  const torches = planTorches(first, bays);

  const flameMaterial = new THREE.MeshBasicMaterial({
    map: createFlameTexture(),
    color: PALETTE.emberHalo,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const fire = buildCorridorFire(rng, geometries, materials, flameMaterial, { torches, braziers, candles });
  const parts = [
    ...buildCorridorStone(rng, geometries, materials, { first, bays, figures }),
    ...fire.parts,
    ...buildCorridorRig(rng, geometries, materials, { first, bays }),
  ];

  return { parts, flameMaterial, braziers, fires: fire.fires };
}

/** Прогоны колючки поперёк коридора: через один выше и ниже линии полёта камеры. */
function planCorridorWire(rng) {
  const span = CORRIDOR_WIRE.toZ - CORRIDOR_WIRE.fromZ;
  return Array.from({ length: CORRIDOR_WIRE.count }, (unused, index) => ({
    x: rng.range(-1, 1),
    y: index % 2 === 0 ? CORRIDOR_WIRE.high : CORRIDOR_WIRE.low,
    z: CORRIDOR_WIRE.fromZ + (span * (index + 0.5)) / CORRIDOR_WIRE.count + rng.range(-2, 2),
    width: CORRIDOR_WIRE.width,
  }));
}

/**
 * Пол коридора гаснет вдаль цветом вершин.
 *
 * Свет обязан прибывать по мере приближения к залу, а дальний конец обязан тонуть в темноте.
 * У портала плита остаётся серым камнем: подкрашенная тёплым, она спорила с афишей, а
 * подкрашенная холодным читалась зеркалом, ради которого всё и переделывалось.
 */
function fadingFloor(length) {
  const geometry = new THREE.PlaneGeometry(1, 1, 1, PATH.steps);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const tint = new THREE.Color();
  for (let index = 0; index < position.count; index += 1) {
    // Локальная ось Y после разворота плиты смотрит против Z: единица это край у зала.
    const nearness = position.getY(index) + HALF;
    const seam = THREE.MathUtils.smoothstep((1 - nearness) * length, 0, PATH.seamBlend);
    tint.copy(PATH_COLD).lerp(PATH_WARM, nearness ** PATH.warmth)
      .multiplyScalar(pathLevel(nearness) * seam);
    colors.set([tint.r, tint.g, tint.b], index * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Повтор шахматки по плите: клетка держит свой размер в метрах на любой длине. */
function tileFloor(texture, width, length) {
  const tile = FLOOR_TILE.cells * FLOOR_TILE.cellMeters;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(width / tile, length / tile);
  texture.anisotropy = FLOOR_TILE.anisotropy;
}

function buildShellAndFloor(geometries, materials) {
  const back = NAVE.endZ - SHELL.margin;
  const front = CORRIDOR.farZ + SHELL.margin;
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(NAVE.halfWidth * 2, NAVE.vaultHeight + SHELL.sink, front - back),
    materials.shell,
  );
  shell.position.set(0, (NAVE.vaultHeight - SHELL.sink) * HALF, (front + back) * HALF);
  shell.receiveShadow = true;

  // Мокрый блестящий пол это про зал: у алтаря он собирает отражения углей и розы. В сухом
  // коридоре тот же материал читается зеркалом и выдаёт подделку раньше, чем начнётся сцена.
  const hallFront = NAVE.frontZ + SHELL.margin;
  const floor = new THREE.Mesh(geometries.quad, materials.floor);
  floor.rotation.x = -Math.PI * HALF;
  floor.position.set(0, 0, (hallFront + back) * HALF);
  floor.scale.set(NAVE.halfWidth * 2, hallFront - back, 1);
  floor.receiveShadow = true;

  const path = new THREE.Mesh(fadingFloor(front - hallFront), materials.path);
  path.rotation.x = -Math.PI * HALF;
  path.position.set(0, 0, (front + hallFront) * HALF);
  path.scale.set(NAVE.halfWidth * 2, front - hallFront, 1);
  // Клетка меряется метрами пола, а не долями плиты: длина коридора и его ширина разные,
  // и одинаковый повтор растянул бы клетку в прямоугольник.
  tileFloor(materials.path.map, NAVE.halfWidth * 2, front - hallFront);

  return { shell, floor, path };
}

/**
 * Шероховатость раздаётся материалам поимённо: у каждой поверхности свои метры.
 *
 * Карта выбирается по тому, как поверхность изнашивается на самом деле: кракелюр садится на
 * камень, потёки идут сверху вниз по вертикальному, царапина ложится на металл. Вешаются они
 * шероховатостью и рельефом, но не цветом: цвет зала подобран, и подкрасить его картинкой
 * значит переписать палитру мимо `palette.js`.
 *
 * Развёртка `ShapeGeometry` лежит прямо в метрах фигуры, поэтому торцевой стене метры не
 * нужны, ей хватает обратного шага. Оболочка мерится длинной боковой гранью: её и видно из
 * коридора, а торцы коробки прячутся за стеной апсиды и за дальним концом дороги.
 */
function wearSurfaces(materials) {
  const crack = loadWearMap(GRUNGE.crack);
  const drip = loadWearMap(GRUNGE.drip);
  const scratch = loadWearMap(GRUNGE.scratch);
  const tile = GRUNGE.tile;
  const prop = { width: GRUNGE.props, height: GRUNGE.props, tile };
  const hallDepth = NAVE.frontZ + SHELL.margin * 2 - NAVE.endZ;
  const shellLength = CORRIDOR.farZ - NAVE.endZ + SHELL.margin * 2;

  materials.concrete.roughnessMap = tileToMeters(crack, prop);
  materials.concrete.bumpMap = materials.concrete.roughnessMap;
  materials.concrete.bumpScale = GRUNGE.bump;

  materials.wall.roughnessMap = tileToMeters(drip, { width: 1, height: 1, tile });
  materials.wall.bumpMap = materials.wall.roughnessMap;
  materials.wall.bumpScale = GRUNGE.bump;

  materials.shell.roughnessMap = tileToMeters(drip, {
    width: shellLength,
    height: NAVE.vaultHeight,
    tile,
  });

  materials.floor.roughnessMap = tileToMeters(scratch, {
    width: NAVE.halfWidth * 2,
    height: hallDepth,
    tile,
  });

  materials.iron.roughnessMap = tileToMeters(scratch, prop);
  materials.rust.roughnessMap = tileToMeters(scratch, prop);
  // Ржавчина единственная отслаивается: на бочках и цепях царапина идёт ещё и рельефом,
  // иначе стальной блик остаётся ровным на всей полосе.
  materials.rust.bumpMap = materials.rust.roughnessMap;
  materials.rust.bumpScale = GRUNGE.bump;
  materials.tinted.roughnessMap = materials.rust.roughnessMap;
}

function createGrimeAtlas(rng) {
  return createAtlas({
    size: DIRT.atlasSize,
    paint: (ctx, box, index) => paintStains(ctx, box, {
      random: rng,
      ink: PALETTE.void,
      base: DIRT.clean,
      ...GRIME_MIX[index],
    }),
  });
}

function createSignAtlas(rng) {
  return createAtlas({
    size: DIRT.atlasSize,
    columns: 2,
    rows: 1,
    paint: (ctx, box, index) => (index === SIGN_CELL.placard
      ? paintPlacard(ctx, box, { random: rng, paper: PALETTE.bone, ink: PALETTE.void })
      : paintStencil(ctx, box, { random: rng, ink: PALETTE.bone })),
  });
}

/**
 * Грязь умножает то, что под ней, а не кладётся поверх альфой.
 *
 * Одна и та же наклейка попадает и на светлую плиту коридора, и на тёмную стену зала:
 * умножение гасит их вместе с их освещением, а полупрозрачная краска читалась бы на светлом
 * пятном сажи, на тёмном пятном тумана. Туман поэтому же выключен: он подмешал бы к
 * умножению свой цвет и вычернил бы дальнюю грязь вместо того, чтобы её убрать.
 */
function createGrimeMaterial(map) {
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    blending: THREE.MultiplyBlending,
    // Умножение в three собирается только на предумноженной альфе. Клетки атласа
    // непрозрачны целиком, поэтому предумножать нечего и картинка идёт как есть.
    premultipliedAlpha: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: DIRT.offset,
    polygonOffsetUnits: DIRT.offset,
    side: THREE.DoubleSide,
    fog: false,
  });
}

// Афиши и трафареты гаснут вдаль вместе с остальным реквизитом коридора, а яркость приходит
// цветом вершин: инстансов тут нет, красить каждую наклейку своим материалом нечем.
function createSignMaterial(map) {
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    vertexColors: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: DIRT.offset,
    polygonOffsetUnits: DIRT.offset,
    side: THREE.DoubleSide,
  });
}

function planWallGrime(rng) {
  const spots = [];
  const count = rng.int(...GRIME_WALL.count);
  for (let index = 0; index < count; index += 1) {
    const height = rng.range(...GRIME_WALL.height);
    const middle = rng.range(...GRIME_WALL.top) - height * HALF;
    spots.push({
      face: 'wall',
      point: [rng.sign() * rng.range(...GRIME_WALL.x), middle, NAVE.endZ],
      turn: [0, 0, rng.range(-GRIME_WALL.roll, GRIME_WALL.roll)],
      size: [rng.range(...GRIME_WALL.width), height],
      cell: rng.pick([GRIME_CELL.drip, GRIME_CELL.spatter]),
    });
  }
  return spots;
}

/** Проектор смотрит вдоль своего +Z, поэтому боковая стена поворачивается к залу по Y. */
function planShellGrime(rng) {
  const spots = [];
  const count = rng.int(...GRIME_SHELL.count);
  for (let index = 0; index < count; index += 1) {
    const height = rng.range(...GRIME_SHELL.height);
    const middle = rng.range(...GRIME_SHELL.top) - height * HALF;
    const side = rng.sign();
    spots.push({
      face: 'shell',
      point: [side * NAVE.halfWidth, middle, rng.range(...GRIME_SHELL.z)],
      turn: [0, -side * Math.PI * HALF, 0],
      size: [rng.range(...GRIME_SHELL.width), height],
      cell: rng.pick([GRIME_CELL.drip, GRIME_CELL.spatter]),
    });
  }
  return spots;
}

function floorSpot(face, x, z, size, cell, turn) {
  return {
    face,
    point: [x, 0, z],
    turn: [-Math.PI * HALF, 0, turn],
    size: [size, size],
    cell,
  };
}

function planFloorGrime(rng, barrels) {
  const spots = barrels.map((barrel) => floorSpot(
    'floor', barrel.x, barrel.z, GRIME_FLOOR.soot, GRIME_CELL.soot, rng() * TAU,
  ));
  const count = rng.int(...GRIME_FLOOR.count);
  for (let index = 0; index < count; index += 1) {
    const angle = rng() * TAU;
    const away = rng.range(...GRIME_FLOOR.radius);
    spots.push(floorSpot(
      'floor',
      clamp(Math.cos(angle) * away, -NAVE.halfWidth + 1, NAVE.halfWidth - 1),
      clamp(Math.sin(angle) * away, NAVE.endZ + 1, NAVE.frontZ),
      rng.range(...GRIME_FLOOR.size),
      GRIME_CELL.blot,
      rng() * TAU,
    ));
  }
  return spots;
}

function planPathGrime(rng, braziers) {
  const spots = braziers
    .filter((spot) => spot.lit && spot.z < GRIME_PATH.toZ)
    .map((spot) => floorSpot(
      'path', spot.x, spot.z, GRIME_PATH.soot * spot.size, GRIME_CELL.soot, rng() * TAU,
    ));
  const count = rng.int(...GRIME_PATH.blots);
  for (let index = 0; index < count; index += 1) {
    spots.push(floorSpot(
      'path',
      rng.sign() * rng.range(0, GRIME_PATH.x),
      rng.range(...GRIME_PATH.z),
      rng.range(...GRIME_PATH.size),
      GRIME_CELL.blot,
      rng() * TAU,
    ));
  }
  return spots;
}

/** Наклейки: афиши на боковой стене коридора и трафаретные знаки на самой дороге. */
function planSigns(rng) {
  const spots = [];
  for (let index = 0; index < SIGN.placards; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const width = rng.range(...SIGN.placardWidth);
    spots.push({
      face: 'shell',
      point: [side * NAVE.halfWidth, SIGN.placardY, rng.range(...SIGN.placardZ)],
      turn: [0, -side * Math.PI * HALF, rng.range(-SIGN.roll, SIGN.roll)],
      size: [width, width * SIGN.placardRatio],
      cell: SIGN_CELL.placard,
    });
  }
  for (let index = 0; index < SIGN.stencils; index += 1) {
    const width = rng.range(...SIGN.stencilWidth);
    spots.push({
      face: 'path',
      point: [rng.sign() * rng.range(0, SIGN.stencilX), 0, rng.range(...SIGN.stencilZ)],
      turn: [-Math.PI * HALF, 0, rng.range(-SIGN.roll, SIGN.roll)],
      size: [width, width * SIGN.stencilRatio],
      cell: SIGN_CELL.stencil,
    });
  }
  return spots;
}

/** Развёртка декали приходит на всю клетку атласа: её остаётся уложить в свою. */
function cutDecal(surface, spot, cell) {
  const geometry = new DecalGeometry(
    surface,
    new THREE.Vector3(...spot.point),
    new THREE.Euler(...spot.turn),
    new THREE.Vector3(spot.size[0], spot.size[1], DIRT.depth),
  );
  const uv = geometry.getAttribute('uv');
  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(index, cell.u + uv.getX(index) * cell.width, cell.v + uv.getY(index) * cell.height);
  }
  return geometry;
}

function paintVertices(geometry, level) {
  const levels = new Float32Array(geometry.getAttribute('position').count * 3).fill(level);
  geometry.setAttribute('color', new THREE.BufferAttribute(levels, 3));
}

/** Проектор мимо поверхности отдаёт пустую геометрию: такие куски в общий меш не идут. */
function mergeDecals(spots, surfaces, cells, shade) {
  const pieces = [];
  for (const spot of spots) {
    const geometry = cutDecal(surfaces[spot.face], spot, cells[spot.cell]);
    if (geometry.getAttribute('position').count === 0) continue;
    if (shade) paintVertices(geometry, shade(spot));
    pieces.push(geometry);
  }
  return pieces.length > 0 ? mergeGeometries(pieces) : null;
}

/**
 * Свой поток случайности для грязи, выведенный из уже разложенного зала.
 *
 * Общий поток расходуется строго по порядку, и после зала его берут ещё типографика с
 * камерой: любой лишний вызов отсюда сдвинул бы им всю выборку и переписал бы лайнап на всех
 * сохранённых сидах. Пилоны и бочки этим же сидом уже разложены, поэтому их метры годятся
 * сидом для грязи и при этом не двигают ни одной детали.
 */
function grimeRandom(pylons, barrels) {
  const spread = [...pylons, ...barrels]
    .reduce((total, item) => total + Math.abs(item.x * item.z), 0);
  return createRandom(Math.round(spread * 1e6).toString(16));
}

function buildGrime(rng, surfaces, { barrels, braziers }) {
  // Проектор режет геометрию в мировых координатах, а меши только что собраны: без этого
  // их матрица ещё единичная, и вся грязь легла бы в начало координат.
  for (const surface of Object.values(surfaces)) surface.updateMatrixWorld();

  const grime = createGrimeAtlas(rng);
  const signs = createSignAtlas(rng);
  const dirt = mergeDecals([
    ...planWallGrime(rng),
    ...planShellGrime(rng),
    ...planFloorGrime(rng, barrels),
    ...planPathGrime(rng, braziers),
  ], surfaces, grime.cells);
  const marks = mergeDecals(planSigns(rng), surfaces, signs.cells,
    (spot) => propLevel(spot.point[2]));

  const meshes = [];
  if (dirt) {
    const stained = new THREE.Mesh(dirt, createGrimeMaterial(grime.texture));
    // Копоть кладётся поверх пятен огня на полу: без порядка прозрачные пятна света рисуются
    // последними и стирают её ровно там, где грязь только и видно, в свету.
    stained.renderOrder = DIRT.order;
    meshes.push(stained);
  }
  if (marks) meshes.push(new THREE.Mesh(marks, createSignMaterial(signs.texture)));
  return meshes;
}

/**
 * Неф целиком: геометрия, воздух и габариты для камеры с типографикой.
 *
 * Сид меняет число пилонов и их обломы, рисунок розы, плотность углей, лужи и подвешенный
 * хлам, но не трогает оси зала: алтарь остаётся в начале координат, роза в торце.
 */
/**
 * Зал, коридор и всё, что в них стоит.
 *
 * Сборка асинхронная из-за колючей проволоки: она приходит готовой моделью, а модель тянется
 * по сети. Всё остальное строится кодом и ждать не заставляет.
 */
export async function createArchitecture({ rng }) {
  const group = new THREE.Group();
  const geometries = createGeometries();
  const rose = planRose(rng);
  const materials = createMaterials({
    roseGlow: createRoseGlowTexture(rng, rose.spokes),
    checker: createCheckerTexture(rng),
    checkerFloor: createCheckerFloorTexture(rng),
    fireGlow: createFireGlowTexture(),
  });

  const pylons = planPylons(rng);
  const barrels = planBarrels(rng);

  const surfaces = buildShellAndFloor(geometries, materials);
  group.add(surfaces.shell, surfaces.floor, surfaces.path);
  const corridor = buildCorridor(rng, geometries, materials);
  group.add(...corridor.parts, ...corridor.fires.map((fire) => fire.mesh));
  group.add(buildRibs(rng, geometries, materials));
  group.add(...buildColonnade(rng, geometries, materials, pylons));
  group.add(buildRubble(rng, geometries, materials));
  group.add(buildCrosses(rng, geometries, materials, pylons));
  const endWall = buildEndWall(materials);
  group.add(endWall);
  group.add(...buildRoseFrame(geometries, materials, rose));
  group.add(buildGrating(rng, geometries, materials));
  group.add(buildRim(geometries, materials));
  group.add(buildSteps(geometries, materials));
  group.add(buildAltarChains(geometries, materials));
  group.add(buildCheckerScatter(rng, geometries, materials));
  group.add(...buildBarrels(rng, geometries, materials, barrels));
  const barrelFires = buildBarrelFires(rng, barrels);
  group.add(...barrelFires.map((fire) => fire.mesh));
  group.add(buildPuddles(rng, geometries, materials));

  const junk = buildJunk(rng, geometries, materials);
  group.add(junk);

  const wire = await createBarbedWire({ runs: planCorridorWire(rng), rng });
  group.add(wire.mesh);

  const sparks = createSparks({
    rng,
    sources: barrels.map((barrel) => [barrel.x, BARREL.height, barrel.z]),
  });
  const haze = createHaze({ rng });
  const smoke = createFloorSmoke({ rng });
  const pathSmoke = createFloorSmoke({ rng, band: CORRIDOR_SMOKE });
  const ray = createGodRay({ rng });
  group.add(sparks.object, haze.object, smoke.object, pathSmoke.object, ray.object);

  // Кот сам ведёт позицию своей группы каждый кадр, поэтому кольцо сдвигается контейнером,
  // а не его собственным position: тот перезаписывается на первом же update.
  const cat = createCat({ rng, radius: CAT.radius });
  const catRing = new THREE.Group();
  catRing.position.z = CAT.z;
  catRing.add(cat.group);
  group.add(catRing);

  const corridorCats = CORRIDOR_CATS.map((spot) => {
    const walker = createCat({ rng, radius: spot.radius });
    const ring = new THREE.Group();
    ring.position.z = spot.z;
    ring.add(walker.group);
    group.add(ring);
    return walker;
  });

  const dirt = grimeRandom(pylons, barrels);
  wearSurfaces(materials);
  group.add(...buildGrime(dirt, { ...surfaces, wall: endWall }, {
    barrels,
    braziers: corridor.braziers,
  }));

  // Кадру достаются только числа: ни новых векторов, ни пересборки буферов.
  function update(elapsed) {
    const breath = HALF + HALF * Math.sin((elapsed / BEAT.seconds) * TAU);
    const flicker = Math.sin(elapsed * FLICKER_SPEED[0]) * Math.sin(elapsed * FLICKER_SPEED[1]);
    materials.glass.color.copy(GLASS_TINT).multiplyScalar(GLASS.emissive + GLASS.swing * breath);
    materials.halo.opacity = ROSE_PLAN.glowOpacity * (1 + ROSE_PLAN.glowSwing * breath);
    materials.firePool.opacity = FIRE_POOL.opacity * (1 + FIRE_POOL.swing * flicker);
    junk.rotation.z = Math.sin(elapsed * JUNK.swaySpeed) * JUNK.sway;
    cat.update(elapsed);
    for (const walker of corridorCats) walker.update(elapsed);
    // Огонь светит выше единицы намеренно: цветение подхватывает только то, что ярче кадра.
    corridor.flameMaterial.color.copy(FIRE_TINT)
      .multiplyScalar(FLAME.gain * (1 + CORRIDOR_TORCH.swing * flicker));
    for (const fire of corridor.fires) fire.update(elapsed);
    for (const fire of barrelFires) fire.update(elapsed);
    wire.update(elapsed);
    sparks.update(elapsed, breath);
    haze.update(elapsed);
    smoke.update(elapsed);
    pathSmoke.update(elapsed);
    ray.update(breath);
  }

  // Афиша меняет длину луча из розы: без неё столб света упирается в пол, а не в воздух
  // перед коробкой типографики.
  return { group, update, setPoster: ray.setPoster, bounds: BOUNDS };
}
