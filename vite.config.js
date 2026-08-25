import { resolve } from 'node:path';

import { defineConfig } from 'vite';

import { generatorApi } from './tools/gen-server/plugin.js';
import { assetInventory } from './tools/inventory/plugin.js';

// Тяжёлые каталоги вне наблюдения: в `_other` лежат венвы, веса моделей и Blender,
// в корне ассеты GTA, и на всё это у системы не хватает inotify-watch'ей
// (`ENOSPC: System limit for number of file watchers reached`). Свежие файлы
// генератора дев-сервер отдаёт и без слежки, зато страница не перезагружается
// посреди прогона.
const UNWATCHED = [
  '**/_other/**',
  '**/dist/**',
  '**/Стандарт*/**',
  '**/public/assets/generated/**',
];

export default defineConfig({
  base: './',
  plugins: [generatorApi(), assetInventory()],
  server: {
    watch: { ignored: UNWATCHED },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        akhet: resolve(import.meta.dirname, 'akhet.html'),
        audio: resolve(import.meta.dirname, 'audio-probe.html'),
        cards: resolve(import.meta.dirname, 'cards.html'),
        generator: resolve(import.meta.dirname, 'generator.html'),
        status: resolve(import.meta.dirname, 'status.html'),
        toolbox: resolve(import.meta.dirname, 'toolbox.html'),
        understav: resolve(import.meta.dirname, 'understav.html'),
      },
    },
  },
});
