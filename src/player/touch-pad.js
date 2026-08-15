import { create } from '../ui/dom.js';

/**
 * Экранное управление прогулкой: плавающий стик слева, обзор справа, кнопки действий.
 *
 * Монтируется только на сенсорных устройствах: на десктопе ведут клавиатура и мышь, а лишний
 * слой поверх кадра отобрал бы у них указатель. Весь ввод пада замыкается на себе и не
 * доходит до слоя захвата: захват указателя на телефоне не работает вовсе, а стрельба и
 * прыжок приходят с кнопок, а не со случайного касания сцены.
 */

const PAD_HOOK = '[data-js-touch-pad]';
const STICK_RADIUS = 56;
const STICK_DEAD_ZONE = 0.15;
const STICK_ZONE_SHARE = 0.5;
const PRESSED_CLASS = 'touch-pad__button--pressed';

// Прицел защёлкой: держать его пальцем и одновременно стрелять и вести взгляд нечем.
const BUTTONS = [
  { name: 'aim', label: 'Прицел', latching: true },
  { name: 'fire', label: 'Огонь' },
  { name: 'jump', label: 'Прыжок' },
];

/** Сенсор определяется возможностями указателя, а не строкой user-agent: её легко подменить. */
export const isTouchDevice = () =>
  navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches;

export function createTouchPad({ root }) {
  const pad = root?.querySelector(PAD_HOOK);
  if (!pad || !isTouchDevice()) {
    pad?.remove();
    return idlePad();
  }

  const axes = { x: 0, y: 0 };
  const buttons = { jump: false, fire: false, aim: false };
  // Сдвиг взгляда копится между кадрами, а забирают его каждый кадр: оба объекта живут по
  // одному на пад, иначе мусорщик собирает их в горячем месте.
  const look = { dx: 0, dy: 0 };
  const taken = { dx: 0, dy: 0 };

  const stick = create('div', 'touch-pad__stick');
  stick.hidden = true;
  // Радиус круга задан здесь, а стиль выводит из него размеры: иначе математика осей и
  // нарисованное кольцо разъезжаются при первой же правке.
  stick.style.setProperty('--stick-radius', `${STICK_RADIUS}px`);
  const knob = create('i', 'touch-pad__knob');
  stick.append(knob);

  const keys = BUTTONS.map(buildButton);
  const bank = create('div', 'touch-pad__bank');
  bank.append(...keys);
  pad.append(stick, bank);

  let stickId = null;
  let lookId = null;
  let baseX = 0;
  let baseY = 0;
  let lastX = 0;
  let lastY = 0;

  pad.addEventListener('pointerdown', (event) => {
    const box = pad.getBoundingClientRect();
    if (event.clientX - box.left < box.width * STICK_ZONE_SHARE) grabStick(event, box);
    else grabLook(event);
    pad.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  });

  pad.addEventListener('pointermove', (event) => {
    if (event.pointerId === stickId) dragStick(event);
    else if (event.pointerId === lookId) dragLook(event);
  });

  const release = (event) => {
    if (event.pointerId === stickId) dropStick();
    else if (event.pointerId === lookId) lookId = null;
  };
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);
  // Касание пада не должно оборачиваться кликом по слою захвата: тот просит захват указателя.
  pad.addEventListener('click', (event) => event.stopPropagation());
  window.addEventListener('blur', reset);

  function grabStick(event, box) {
    if (stickId !== null) return;
    stickId = event.pointerId;
    baseX = event.clientX;
    baseY = event.clientY;
    stick.style.setProperty('--stick-x', `${event.clientX - box.left}px`);
    stick.style.setProperty('--stick-y', `${event.clientY - box.top}px`);
    moveKnob(0, 0);
    stick.hidden = false;
  }

  function dragStick(event) {
    const dx = event.clientX - baseX;
    const dy = event.clientY - baseY;
    const reach = Math.hypot(dx, dy);
    const pull = Math.min(reach / STICK_RADIUS, 1);
    const unitX = reach > 0 ? dx / reach : 0;
    const unitY = reach > 0 ? dy / reach : 0;
    moveKnob(unitX * pull * STICK_RADIUS, unitY * pull * STICK_RADIUS);
    const push = pull < STICK_DEAD_ZONE ? 0 : pull;
    axes.x = unitX * push;
    axes.y = -unitY * push;
  }

  function dropStick() {
    stickId = null;
    stick.hidden = true;
    axes.x = 0;
    axes.y = 0;
  }

  function moveKnob(x, y) {
    knob.style.setProperty('--knob-x', `${x}px`);
    knob.style.setProperty('--knob-y', `${y}px`);
  }

  function grabLook(event) {
    if (lookId !== null) return;
    lookId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
  }

  function dragLook(event) {
    look.dx += event.clientX - lastX;
    look.dy += event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
  }

  function buildButton({ name, label, latching }) {
    const node = create('button', `touch-pad__button touch-pad__button--${name}`, label);
    node.type = 'button';
    node.dataset.jsTouchButton = name;
    node.setAttribute('aria-pressed', 'false');
    node.addEventListener('pointerdown', (event) => {
      node.setPointerCapture(event.pointerId);
      press(node, latching ? !buttons[name] : true);
      event.preventDefault();
      // Кнопка это действие, а не обзор: её касание не должно уехать в накопитель взгляда.
      event.stopPropagation();
    });
    const drop = () => {
      if (!latching) press(node, false);
    };
    node.addEventListener('pointerup', drop);
    node.addEventListener('pointercancel', drop);
    return node;
  }

  function press(node, on) {
    buttons[node.dataset.jsTouchButton] = on;
    node.classList.toggle(PRESSED_CLASS, on);
    node.setAttribute('aria-pressed', String(on));
  }

  function reset() {
    dropStick();
    lookId = null;
    look.dx = 0;
    look.dy = 0;
    for (const node of keys) press(node, false);
  }

  return {
    available: true,
    axes,
    buttons,
    takeLook() {
      taken.dx = look.dx;
      taken.dy = look.dy;
      look.dx = 0;
      look.dy = 0;
      return taken;
    },
    setActive(on) {
      pad.hidden = !on;
      if (!on) reset();
    },
  };
}

const IDLE_LOOK = { dx: 0, dy: 0 };

/** Заглушка для мыши и клавиатуры: та же форма, но ничего не смонтировано и не слушается. */
function idlePad() {
  return {
    available: false,
    axes: { x: 0, y: 0 },
    buttons: { jump: false, fire: false, aim: false },
    takeLook: () => IDLE_LOOK,
    setActive() {},
  };
}
