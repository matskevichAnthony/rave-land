/** Живой лог прогона: без него длинный шаг неотличим от зависшей кнопки. */

const TIME_WIDTH = 6;

export function createLog(root) {
  function put(text, tone) {
    const line = document.createElement('div');
    line.className = tone ? `gen-log__line gen-log__line--${tone}` : 'gen-log__line';
    line.textContent = text;
    root.append(line);
    root.scrollTop = root.scrollHeight;
    return line;
  }

  return {
    clear: () => root.replaceChildren(),
    title: (text) => put(text, 'title'),
    error: (text) => put(text, 'error'),
    done: (text) => put(text, 'done'),
    /** Время шага пишет сервер: оно считается от запуска процесса, а не от прихода строки. */
    line: (text, at) => put(`${`${at.toFixed(1)}s`.padStart(TIME_WIDTH)}  ${text}`),
  };
}
