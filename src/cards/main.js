/**
 * Страница генератора афиш UNDERSTAV: данные, знак, шрифты, витрина и пульт.
 *
 * Сид живёт в адресе тем же параметром, что у сцены: удачную серию пересылают ссылкой, а не
 * пересказом настроек. Порядок загрузки жёсткий: шрифты приезжают файлами, и карточка,
 * нарисованная до них, молча встаёт системным гротеском вместо готики.
 */

import { loadGothic } from '../understav/gothic.js';
import { randomSeed } from '../understav/random.js';
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
      newSeed: () => redraw({ seed: randomSeed() }),
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
