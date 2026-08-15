/**
 * Хук со страницы, а если его там нет, разметка заводится сама.
 *
 * Так модуль движка перестаёт требовать конкретную страницу: игра держит свои элементы в
 * `index.html`, а любая новая сцена получает их даром и не копирует разметку к себе.
 */
export function ensure(selector, markup) {
  const found = document.querySelector(selector);
  if (found) return found;
  const holder = document.createElement('div');
  holder.innerHTML = markup.trim();
  const node = holder.firstElementChild;
  document.body.append(node);
  return node;
}

/** Готовый узел одной строкой: тег, класс и текст. */
export function create(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
