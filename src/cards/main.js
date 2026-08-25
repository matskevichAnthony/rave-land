/**
 * Страница генератора афиш UNDERSTAV: данные, знак, шрифты, витрина и пульт.
 *
 * Сид живёт в адресе тем же параметром, что у сцены: удачную серию пересылают ссылкой, а не
 * пересказом настроек. Сидов у вида три: общий кормит направление, компоновочный двигает
 * текст и знак, фактурный держит сыпь, объём и эффектор. Пока компоновку и фактуру не
 * перебрасывали отдельно, они висят пустыми и наследуют общий сид: «всё заново» честно
 * меняет всю карточку целиком.
 *
 * Порядок загрузки жёсткий: шрифты приезжают файлами, и карточка, нарисованная до них,
 * молча встаёт системным гротеском вместо готики.
 */

import { loadGothic } from '../understav/gothic.js';
import { randomSeed } from '../understav/random.js';
import { DEFAULT_HOT, DEFAULT_COLD } from './ink.js';
import { createDeck } from './deck.js';
import { createGallery } from './gallery.js';
import { loadEvent } from './event.js';
import { loadLogo } from './logo.js';
import { DEFAULT_DIRECTION } from './directions/index.js';
import { DEFAULT_FORMAT } from './format.js';
import { PLAIN_SCALE, defaultText } from './typeset.js';

const SEED_PARAM = 'seed';
const SEED_PATTERN = /^[0-9a-f]{1,8}$/i;

function readSeed(fallback) {
  const asked = new URL(window.location.href).searchParams.get(SEED_PARAM);
  return asked && SEED_PATTERN.test(asked) ? asked.toLowerCase() : fallback;
}

function showError(error) {
  const box = document.querySelector('[data-js-error]');
  box.textContent = error.message;
  box.hidden = false;
  throw error;
}

async function boot() {
  const event = await loadEvent();
  const [logo] = await Promise.all([loadLogo(), loadGothic()]);

  const view = {
    direction: DEFAULT_DIRECTION,
    format: DEFAULT_FORMAT,
    seed: readSeed(event.seed ?? randomSeed()),
    laySeed: null,
    texSeed: null,
    bgSeed: null,
    objSeed: null,
    hot: DEFAULT_HOT,
    cold: DEFAULT_COLD,
    allow3d: false,
    objTone: 'heat',
    objAlpha: 0.92,
    objBehind: false,
    chaos: false,
    chaosPower: 1,
    chaosZone: 'all',
    madness: false,
    plaque: false,
    glow: false,
    sigils: false,
    border: 'none',
    // Пункты набора: показан ли пункт, каким кеглем относительно направления и какой
    // краской. Пустая краска оставляет пункту цвета направления.
    text: defaultText(),
    // Локальные сиды карточек: номер в серии переродился, остальные стоят как стояли.
    cardSeeds: {},
  };

  let deck = null;
  const gallery = createGallery({
    root: document.querySelector('[data-js-sheet]'),
    event,
    logo,
    note: (text) => deck.note(text),
    reroll: (index) => redraw({ cardSeeds: { ...view.cardSeeds, [index]: randomSeed() } }),
  });

  deck = createDeck({
    root: document.querySelector('[data-js-deck]'),
    event,
    view,
    actions: {
      setDirection: (direction) => redraw({ direction }),
      setFormat: (format) => redraw({ format }),
      // Общий бросок сбрасывает частные сиды: серия начинается с чистого листа.
      newSeed: () => redraw({
        seed: randomSeed(), laySeed: null, texSeed: null, bgSeed: null, objSeed: null, cardSeeds: {},
      }),
      // Перерождение одной карточки: локальный сид только ей, серия не шевелится.
      rerollCard: (index) => redraw({ cardSeeds: { ...view.cardSeeds, [index]: randomSeed() } }),
      newLay: () => redraw({ laySeed: randomSeed() }),
      newTex: () => redraw({ texSeed: randomSeed() }),
      newBg: () => redraw({ bgSeed: randomSeed() }),
      newObj: () => redraw({ objSeed: randomSeed() }),
      // Рукописный сид: пульт принимает только чистый hex, мусор отбрасывается молча.
      setSeed: (asked) => {
        const clean = String(asked).trim().toLowerCase();
        if (SEED_PATTERN.test(clean)) {
          redraw({ seed: clean, laySeed: null, texSeed: null, bgSeed: null, objSeed: null });
        } else {
          deck.note(`Сид «${asked}» не hex: нужно от 1 до 8 знаков 0-9 a-f`);
          deck.showSeed(view.seed);
        }
      },
      setInks: (hot, cold) => redraw({ hot, cold }),
      resetInks: () => redraw({ hot: DEFAULT_HOT, cold: DEFAULT_COLD }),
      setBorder: (border) => redraw({ border }),
      toggle3d: () => redraw({ allow3d: !view.allow3d }),
      setObjTone: (objTone) => redraw({ objTone }),
      setObjAlpha: (objAlpha) => redraw({ objAlpha }),
      toggleObjBehind: () => redraw({ objBehind: !view.objBehind }),
      toggleChaos: () => redraw({ chaos: !view.chaos }),
      setChaosPower: (chaosPower) => redraw({ chaosPower }),
      setChaosZone: (chaosZone) => redraw({ chaosZone }),
      toggleMadness: () => redraw({ madness: !view.madness }),
      togglePlaque: () => redraw({ plaque: !view.plaque }),
      toggleGlow: () => redraw({ glow: !view.glow }),
      toggleSigils: () => redraw({ sigils: !view.sigils }),
      toggleText: (role) => patchText(role, { on: !view.text[role].on }),
      setTextScale: (role, scale) => patchText(role, { scale }),
      setTextInk: (role, ink) => patchText(role, { ink }),
      resetText: (role) => patchText(role, { scale: PLAIN_SCALE, ink: null }),
      copySeed,
      saveAll: () => gallery.saveAll(),
    },
  });

  // Правка одного пункта набора: остальные пункты и весь остальной вид стоят на месте.
  function patchText(role, change) {
    redraw({ text: { ...view.text, [role]: { ...view.text[role], ...change } } });
  }

  function redraw(change) {
    Object.assign(view, change);
    const url = new URL(window.location.href);
    url.searchParams.set(SEED_PARAM, view.seed);
    window.history.replaceState(null, '', url);
    deck.showSeed(view.seed);
    deck.showState(view);
    // Лист рисуется асинхронно: деструкторы движка PX гоняют кадр через jpeg. Промах не
    // должен уходить в консоль молча, иначе пустой лист выглядит как зависшая страница.
    gallery.draw(view).catch((error) => deck.note(`Отрисовка: ${error.message}`));
  }

  async function copySeed() {
    try {
      await navigator.clipboard.writeText(view.seed);
      deck.note(`Сид ${view.seed} скопирован`);
    } catch (error) {
      deck.note(`Скопировать не вышло: ${error.message}`);
    }
  }

  redraw({});
}

boot().catch(showError);
