/** Карточки шагов: у каждого свой вход, своя кнопка и своё состояние.
 *
 * Что шаг ест и чем считается, знает сервер (pipeline.js), поэтому цепочка сюда
 * приходит готовой, а не переписана вторым списком.
 */

const ACTIONS = {
  image: ['Сгенерировать картинку', 'Сгенерировать заново'],
  mesh: ['Собрать меш', 'Пересобрать меш'],
  prop: ['Собрать проп', 'Пересобрать проп'],
};

const STATES = {
  running: ['идёт', 'running'],
  done: ['готово', 'done'],
  blocked: ['нет входа', 'blocked'],
  ready: ['можно считать', 'ready'],
};

const has = (asset, step) => Boolean(asset?.files?.[step]);

/** Почему кнопка не нажимается: либо инструмента нет, либо нечего есть. */
function blocker(step, steps, asset) {
  if (step.problem) return step.problem;
  if (!step.needs || has(asset, step.needs)) return null;
  const source = steps.find((other) => other.name === step.needs);
  return `Не хватает входа: сначала шаг «${source.title}»`;
}

function stateOf(step, blocked, done, running) {
  if (running === step.name) return STATES.running;
  if (done) return STATES.done;
  return blocked ? STATES.blocked : STATES.ready;
}

export function createSteps(root, onRun) {
  const cards = new Map([...root.querySelectorAll('[data-js-step]')].map((card) => {
    const name = card.dataset.jsStep;
    const button = card.querySelector('[data-js-go]');
    button.addEventListener('click', () => onRun(name));
    return [name, {
      button,
      state: card.querySelector('[data-js-state]'),
      why: card.querySelector('[data-js-why]'),
    }];
  }));

  return {
    show({ steps, asset, busy, running }) {
      for (const step of steps) {
        const card = cards.get(step.name);
        if (!card) continue;
        const done = has(asset, step.name);
        const blocked = blocker(step, steps, asset);
        const [word, tone] = stateOf(step, blocked, done, running);

        card.state.textContent = word;
        card.state.className = `gen-step__state gen-step__state--${tone}`;
        card.button.textContent = ACTIONS[step.name][done ? 1 : 0];
        card.button.disabled = busy || Boolean(blocked);
        card.why.textContent = blocked ?? '';
        card.why.hidden = !blocked;
      }
    },
  };
}
