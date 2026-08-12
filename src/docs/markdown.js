const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^\d+\.\s+(.*)$/;
const FENCE = '```';
const HEADING_TAGS = ['h2', 'h3', 'h4', 'h5', 'h6', 'h6'];
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/\S+)/g;

/** Разбирает шапку `---` с парами ключ-значение и отдаёт её вместе с оставшимся текстом. */
export function frontmatter(text) {
  const match = text.match(FRONTMATTER);
  if (!match) return { data: {}, body: text };
  const data = Object.fromEntries(match[1].split('\n')
    .map((line) => line.split(/:\s(.+)/))
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key.trim(), value.trim()]));
  return { data, body: text.slice(match[0].length) };
}

/**
 * Markdown в узлы страницы: заголовки, списки, блоки кода и строчная разметка.
 *
 * Своего рендерера хватает ровно потому, что тексты пишем мы сами и в них живёт
 * только эта разметка. Библиотека ради пяти правил в служебную страницу не тянется.
 */
export function renderMarkdown(text) {
  const fragment = document.createDocumentFragment();
  const lines = text.split('\n');
  let list = null;
  let paragraph = null;

  const closeBlocks = () => {
    list = null;
    paragraph = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.startsWith(FENCE)) {
      closeBlocks();
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith(FENCE)) {
        code.push(lines[index]);
        index += 1;
      }
      const block = document.createElement('pre');
      block.textContent = code.join('\n');
      fragment.append(block);
      continue;
    }

    if (!line.trim()) {
      closeBlocks();
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      closeBlocks();
      const node = document.createElement(HEADING_TAGS[heading[1].length - 1]);
      node.append(...renderInline(heading[2]));
      fragment.append(node);
      continue;
    }

    const item = line.match(BULLET) ?? line.match(NUMBERED);
    if (item) {
      paragraph = null;
      if (!list) {
        list = document.createElement(line.match(BULLET) ? 'ul' : 'ol');
        fragment.append(list);
      }
      const point = document.createElement('li');
      point.append(...renderInline(item[1]));
      list.append(point);
      continue;
    }

    list = null;
    if (!paragraph) {
      paragraph = document.createElement('p');
      fragment.append(paragraph);
    } else {
      paragraph.append(' ');
    }
    paragraph.append(...renderInline(line));
  }

  return fragment;
}

/** Строчная разметка: жирное, код и голые ссылки. */
export function renderInline(text) {
  return text.split(INLINE).filter(Boolean).map((token) => {
    if (token.startsWith('**')) return wrap('b', token.slice(2, -2));
    if (token.startsWith('`')) return wrap('code', token.slice(1, -1));
    if (token.startsWith('http')) {
      const link = wrap('a', token);
      link.href = token;
      link.target = '_blank';
      link.rel = 'noreferrer';
      return link;
    }
    return document.createTextNode(token);
  });
}

function wrap(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
