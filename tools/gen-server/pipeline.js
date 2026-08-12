import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Единственное место, где записано, чем запускается каждый шаг маршрута.
 *
 * Из браузера приходит только имя шага и параметры, команду страница не выбирает
 * и собрать не может: список закрыт, всё остальное отвергается на входе.
 */

export const ROOT = resolve(import.meta.dirname, '../..');

const at = (...parts) => resolve(ROOT, ...parts);

const BLENDER = at('_other/auto-rig/blender-4.2.9-linux-x64/blender');
const LOCAL_GEN = at('_other/local-gen');
const MESH_PYTHON = at('_other/local-gen/venv/bin/python');
const IMAGE_PYTHON = at('_other/sd-local/venv/bin/python');

const TEXT2IMAGE = at('tools/gen/text2image_local.py');
const TRIPOSR = at('tools/gen/triposr_local.py');
const MESH2PROP = at('tools/gen/mesh2prop.py');

export const FILES = {
  image: 'image.png',
  mesh: 'mesh-raw.glb',
  prop: 'prop.glb',
  preview: 'preview.png',
  stats: 'prop.json',
};

export const PRESETS = ['prop', 'character'];

const MC_RESOLUTION = 256;

/** Свой venv у каждого инструмента: у TripoSR прибит старый huggingface-hub (F-030). */
const python = (venv) => (existsSync(venv) ? venv : 'python3');

const missing = (path, hint) => (existsSync(path) ? null : `Нет ${path.replace(ROOT + '/', '')}. ${hint}`);

export const STEPS = {
  image: {
    title: 'Картинка',
    produces: 'image',
    ready: () => missing(
      TEXT2IMAGE,
      'Локальный генератор картинок ещё не готов. Пока возьми готовую картинку '
      + 'из _other/incoming кнопкой «Взять готовую картинку».',
    ),
    command: (dir, params) => ({
      command: python(IMAGE_PYTHON),
      args: [TEXT2IMAGE, params.prompt, resolve(dir, FILES.image), '--preset', params.preset],
    }),
  },

  mesh: {
    title: 'Меш',
    needs: 'image',
    produces: 'mesh',
    ready: () => missing(TRIPOSR, 'Локальный генератор мешей не найден.')
      ?? missing(MESH_PYTHON, 'Окружение TripoSR не собрано, см. docs/rules/triposr-local.md.'),
    command: (dir, _params) => ({
      command: MESH_PYTHON,
      cwd: LOCAL_GEN,
      // Без HF_HOME на веса TripoSR уходит новая закачка мимо _other/local-gen/weights.
      env: { HF_HOME: resolve(LOCAL_GEN, 'weights') },
      args: [
        TRIPOSR, resolve(dir, FILES.image), resolve(dir, FILES.mesh),
        '--mc-resolution', String(MC_RESOLUTION),
      ],
    }),
  },

  prop: {
    title: 'Проп',
    needs: 'mesh',
    produces: 'prop',
    stats: FILES.stats,
    // Blender сыплет в stdout построчный прогресс рендера, в живом логе он лишний.
    noise: /^Fra:/,
    ready: () => missing(MESH2PROP, 'Инструмент лоуполи не найден.')
      ?? missing(BLENDER, 'Портативного Blender нет, см. docs/rules/props.md.'),
    command: (dir, params) => ({
      command: BLENDER,
      args: [
        '--background', '--python', MESH2PROP, '--',
        resolve(dir, FILES.mesh), resolve(dir, FILES.prop),
        '--kind', params.preset,
        ...(params.triangles ? ['--triangles', String(params.triangles)] : []),
        ...(params.size ? ['--size', String(params.size)] : []),
        '--preview', resolve(dir, FILES.preview),
        '--stats', resolve(dir, FILES.stats),
      ],
    }),
  },
};
