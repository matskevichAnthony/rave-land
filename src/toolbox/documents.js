const DOCUMENTS = import.meta.glob('../../docs/**/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
});

const RULES_DIRECTORY = '/docs/rules/';
const HEADING = /^#\s+(.+)$/m;
const REPO_PREFIX = '../../';

/**
 * Все документы проекта, какие лежат в docs.
 *
 * Правила работы отсюда исключены: они показаны в карточках своих утилит, а
 * дважды одно и то же на странице не нужно. Новый документ появляется здесь
 * сам, потому что список берётся из дерева файлов, а не из перечня в коде.
 */
export function collectDocuments() {
  return Object.entries(DOCUMENTS)
    .filter(([path]) => !path.includes(RULES_DIRECTORY))
    .map(([path, text]) => ({
      path: path.slice(REPO_PREFIX.length),
      title: text.match(HEADING)?.[1] ?? path.split('/').at(-1),
      body: text.replace(HEADING, '').trim(),
    }))
    .sort((one, other) => one.path.localeCompare(other.path));
}
