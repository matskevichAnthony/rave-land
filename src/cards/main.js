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
    hot: DEFAULT_HOT,
    cold: DEFAULT_COLD,
    allow3d: false,
    chaos: false,
    madness: false,
    plaque: false,
    showName: true,
    showMeta: true,
    showCredit: true,
  };

  let deck = null;
  const gallery = createGallery({
    root: document.querySelector('[data-js-sheet]'),
    event,
    logo,
    note: (text) => deck.note(text),
  });

  deck = createDeck({
    root: document.querySelector('[data-js-deck]'),
    event,
    view,
    actions: {
      setDirection: (direction) => redraw({ direction }),
      setFormat: (format) => redraw({ format }),
      // Общий бросок сбрасывает частные сиды: серия начинается с чистого листа.
      newSeed: () => redraw({ seed: randomSeed(), laySeed: null, texSeed: null, bgSeed: null }),
      newLay: () => redraw({ laySeed: randomSeed() }),
      newTex: () => redraw({ texSeed: randomSeed() }),
      newBg: () => redraw({ bgSeed: randomSeed() }),
      setInks: (hot, cold) => redraw({ hot, cold }),
      resetInks: () => redraw({ hot: DEFAULT_HOT, cold: DEFAULT_COLD }),
      toggle3d: () => redraw({ allow3d: !view.allow3d }),
      toggleChaos: () => redraw({ chaos: !view.chaos }),
      toggleMadness: () => redraw({ madness: !view.madness }),
      togglePlaque: () => redraw({ plaque: !view.plaque }),
      toggleName: () => redraw({ showName: !view.showName }),
      toggleMeta: () => redraw({ showMeta: !view.showMeta }),
      toggleCredit: () => redraw({ showCredit: !view.showCredit }),
      copySeed,
      saveAll: () => gallery.saveAll(),
    },
  });

  function redraw(change) {
    Object.assign(view, change);
    const url = new URL(window.location.href);
    url.searchParams.set(SEED_PARAM, view.seed);
    window.history.replaceState(null, '', url);
    deck.showSeed(view.seed);
    deck.showState(view);
    gallery.draw(view);
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
