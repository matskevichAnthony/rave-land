import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { measureGlb } from './glb.js';

/** Единая опись всего, что в проекте лежит моделями.
 *
 * Опись нигде не хранится, она собирается заново: список файлов берётся с
 * диска, полигонаж и габариты из самих GLB, а происхождение из того, что
 * записали производители: опись `props.py`, опись генератора, `world.json` и
 * `public/assets/provenance.json` для файлов, чей инструмент следа не оставил.
 * Второго рукописного списка ассетов нет ни у кого, поэтому и переписать опись
 * своим списком, как это делал props.py, стало некому.
 *
 * Одна запись это один ассет: файл, чем сделан и с какими параметрами,
 * полигонаж, габариты, размер, дата и сколько раз он стоит в мире.
 */

const ROOT = resolve(import.meta.dirname, '../..');
const PUBLIC = join(ROOT, 'public');
const MODELS = 'assets/models';
const PROPS = `${MODELS}/props`;
const GENERATED = 'assets/generated';
const PROVENANCE = 'assets/provenance.json';
const PROPS_MANIFEST = `${PROPS}/manifest.json`;
const GENERATED_MANIFEST = `${GENERATED}/manifest.json`;
const MODEL_SUFFIX = '.glb';

// Чем сделан файл прогона: последний доехавший шаг маршрута и есть его инструмент.
const STEP_TOOLS = {
  prop: 'tools/gen/mesh2prop.py',
  mesh: 'tools/gen/triposr_local.py',
  image: 'tools/gen/text2image_local.py',
};

const propOrigin = (src) => ({
  tool: 'tools/gen/props.py',
  params: `--prop ${src.split('/').at(-1).replace(MODEL_SUFFIX, '')}`,
  model: 'собран из примитивов в Blender, детерминированно по сиду, без ИИ и без облака',
});

export function scanInventory() {
  const origins = readJson(PROVENANCE)?.origins ?? {};
  const world = worldKnowledge();
  const assets = [...modelAssets(origins, world), ...runAssets()]
    .sort((one, other) => other.date.localeCompare(one.date));
  return { scanned: new Date().toISOString(), assets };
}

function modelAssets(origins, world) {
  const titles = propTitles();
  return findModels(MODELS).map((src) => {
    const procedural = src.startsWith(`${PROPS}/`);
    const { title, source, ...provenance } = { ...matchOrigin(origins, src), ...world.provenance[src] };
    return {
      src,
      title: title ?? titles[src] ?? world.names[src] ?? src.split('/').at(-1),
      source: source ?? (procedural ? 'props' : 'unknown'),
      provenance: procedural ? { ...propOrigin(src), ...provenance } : provenance,
      inWorld: world.used[src] ?? 0,
      ...facts(src),
    };
  });
}

/** Прогоны генератора: запись на прогон, а не на файл, и указывает она на его лучший результат. */
function runAssets() {
  const runs = readJson(GENERATED_MANIFEST)?.assets ?? [];
  return runs.map((run) => {
    const step = Object.keys(STEP_TOOLS).find((name) => exists(runFile(run, name)));
    if (!step) return null;
    const budget = run.stats ? `, бюджет ${run.stats.budget} тр из ${run.stats.triangles_source}` : '';
    return {
      src: step === 'image' ? null : runFile(run, step),
      title: run.title || run.id,
      source: 'generated',
      preview: exists(runFile(run, 'preview')) ? runFile(run, 'preview') : runFile(run, 'image'),
      provenance: {
        tool: STEP_TOOLS[step],
        params: `промпт «${run.prompt || 'без промпта'}», пресет ${run.preset}${budget}`,
        model: `прогон генератора «${run.id}», доехал до шага «${step}»`,
      },
      inWorld: 0,
      ...facts(runFile(run, step)),
    };
  }).filter(Boolean);
}

function runFile(run, step) {
  return run.files[step] ? `${GENERATED}/${run.files[step]}` : null;
}

/** Цифры ассета меряются по самому файлу: опись их не помнит и разойтись с ним не может. */
function facts(src) {
  const { size, mtime } = statSync(join(PUBLIC, src));
  const base = { kilobytes: Math.round(size / 1024), date: mtime.toISOString() };
  if (!src.endsWith(MODEL_SUFFIX)) return { ...base, triangles: null, size: null };
  try {
    return { ...base, ...measureGlb(join(PUBLIC, src)) };
  } catch (error) {
    return { ...base, triangles: null, size: null, problem: error.message };
  }
}

function findModels(directory) {
  return readdirSync(join(PUBLIC, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return findModels(path);
    return entry.name.endsWith(MODEL_SUFFIX) ? [path] : [];
  }).sort();
}

/** Ключом происхождения работает и целый путь, и его начало: у папки оружия он один на всех. */
function matchOrigin(origins, src) {
  const key = Object.keys(origins)
    .filter((candidate) => src.startsWith(candidate))
    .sort((one, other) => other.length - one.length)[0];
  return origins[key] ?? {};
}

/** Русские имена пропов знает только props.py, остальное о них видно по файлу. */
function propTitles() {
  const props = readJson(PROPS_MANIFEST)?.props ?? [];
  return Object.fromEntries(props.map((prop) => [`${PROPS}/${prop.file}`, prop.title]));
}

/** Мир тоже источник знания: имена, происхождение игровых моделей и то, сколько их стоит. */
function worldKnowledge() {
  const world = readJson('world.json') ?? {};
  const placed = [...(world.npcs ?? []), ...(world.objects ?? [])].filter((entry) => entry.src);
  const used = {};
  for (const entry of placed) used[entry.src] = (used[entry.src] ?? 0) + 1;
  return {
    used,
    names: Object.fromEntries(placed.filter((entry) => entry.name).map((entry) => [entry.src, entry.name])),
    provenance: Object.fromEntries(
      placed.filter((entry) => entry.provenance).map((entry) => [entry.src, entry.provenance]),
    ),
  };
}

function exists(src) {
  return Boolean(src) && existsSync(join(PUBLIC, src));
}

function readJson(src) {
  return exists(src) ? JSON.parse(readFileSync(join(PUBLIC, src), 'utf8')) : null;
}
