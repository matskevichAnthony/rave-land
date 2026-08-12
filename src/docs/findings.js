import source from '../../docs/FINDINGS.md?raw';

// Строка записи журнала: "### F-001", затем статус и название. Разделителем в разное
// время писали то точку, то U+00B7, поэтому шаблон принимает оба.
const ENTRY = new RegExp('^###\\s+F-(\\d+)\\s*[\\u00b7.]\\s*(OPEN|CLOSED|INFO)\\s*[\\u00b7.]\\s*(.+)$');
const SECTION = /^##\s+(?:\d+\.\s*)?(.+)$/;

export const STATUS_LABELS = { OPEN: 'в работе', CLOSED: 'закрыто', INFO: 'факт' };

export const FINDINGS = parseFindings(source);

/** Записи журнала, где упомянут файл: так страницы узнают статус утилиты, не храня свою копию. */
export function findingsMentioning(path) {
  const filename = path.split('/').at(-1);
  return FINDINGS.filter((entry) => `${entry.title}\n${entry.body.join('\n')}`.includes(filename));
}

function parseFindings(text) {
  const parsed = [];
  let section = '';
  let current = null;
  for (const line of text.split('\n')) {
    const sectionMatch = line.match(SECTION);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }
    const entryMatch = line.match(ENTRY);
    if (entryMatch) {
      const [, number, status, title] = entryMatch;
      current = { number, status, title: title.trim(), section, body: [] };
      parsed.push(current);
      continue;
    }
    if (current) current.body.push(line);
  }
  return parsed;
}
