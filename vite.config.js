import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        characters: resolve(import.meta.dirname, 'characters.html'),
        props: resolve(import.meta.dirname, 'props.html'),
        status: resolve(import.meta.dirname, 'status.html'),
      },
    },
  },
});
