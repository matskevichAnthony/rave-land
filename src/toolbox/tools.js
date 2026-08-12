import { frontmatter } from '../docs/markdown.js';

const SOURCES = import.meta.glob('../../tools/**/*.{py,mjs,sh}', {
  eager: true,
  query: '?raw',
  import: 'default',
});

const RULES = import.meta.glob('../../docs/rules/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
});

const SECTION_TITLES = {
  'tools/gen': 'Генерация 3D-моделей',
  'tools/anim': 'Скелет и анимации',
  'tools/gta': 'Импорт из GTA San Andreas',
  tools: 'Сборка и прочее',
};

const PYTHON_DOCSTRING = /^(?:#![^\n]*\n)?"""([\s\S]*?)"""/;
const LEADING_COMMENT = /^(?:\/\/[^\n]*\n)+/;
const REPO_PREFIX = '../../';

/**
 * Утилиты проекта, собранные из самого дерева файлов.
 *
 * Список берётся из tools/, поэтому новый скрипт появляется на странице сам, а
 * описание для него пишется там же, где он живёт: в его docstring. Правила
 * работы лежат отдельными файлами в docs/rules и цепляются к утилите полем
 * tool, так что новый файл правил тоже подхватывается без правки кода.
 */
export function collectTools() {
  const rules = new Map(Object.values(RULES).map((text) => {
    const { data, body } = frontmatter(text);
    return [data.tool, { ...data, body }];
  }));

  const paths = new Set([...Object.keys(SOURCES).map(toRepoPath), ...rules.keys()]);
  const tools = [...paths].map((path) => describe(path, rules.get(path)));
  return groupBySection(tools.sort((one, other) => one.path.localeCompare(other.path)));
}

function describe(path, rule) {
  const doc = documentation(path, SOURCES[REPO_PREFIX + path] ?? '');
  return {
    path,
    title: rule?.title ?? doc.title ?? path.split('/').at(-1),
    summary: rule?.summary ?? doc.summary,
    input: rule?.input ?? null,
    output: rule?.output ?? null,
    command: rule?.command ?? null,
    rules: rule?.body?.trim() || null,
  };
}

/** Первая строка docstring работает заголовком утилиты, следующий абзац описанием. */
function documentation(path, source) {
  const text = path.endsWith('.mjs')
    ? (source.match(LEADING_COMMENT)?.[0] ?? '').replaceAll('//', '')
    : (source.match(PYTHON_DOCSTRING)?.[1] ?? '');
  const paragraphs = text.trim().split(/\n\s*\n/);
  return {
    title: paragraphs[0]?.replaceAll('\n', ' ').trim() || null,
    summary: paragraphs[1]?.trim() ?? '',
  };
}

function groupBySection(tools) {
  const sections = new Map();
  for (const tool of tools) {
    const directory = tool.path.split('/').slice(0, -1).join('/');
    const section = sections.get(directory)
      ?? { title: SECTION_TITLES[directory] ?? directory, directory, tools: [] };
    section.tools.push(tool);
    sections.set(directory, section);
  }
  return [...sections.values()].sort((one, other) => one.directory.localeCompare(other.directory));
}

function toRepoPath(globPath) {
  return globPath.slice(REPO_PREFIX.length);
}
