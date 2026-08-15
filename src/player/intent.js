import { isTyping } from './input.js';

const RELOAD_KEY = 'KeyR';

/**
 * Ввод игрока в намерение той же формы, что отдаёт мозг бота.
 *
 * Это самое ценное решение всей связки: ниже по течению никто не знает, человек там или бот.
 * Реестр бойцов, разрешения оружия, разброс и попадания одинаковы для обоих, поэтому и
 * чинится всё это в одном месте.
 *
 * Ходьбу намерение не несёт: игрока двигает физика по осям ввода, бота ведёт `pursue.js` к
 * точке от мозга, и общего в этих двух дорогах нет ничего.
 */
export function createPlayerIntent({ domElement, isEditing }) {
  let triggerHeld = false;
  let triggerPressed = false;
  let reloadPressed = false;
  let padHeld = false;

  domElement.addEventListener('pointerdown', (event) => {
    // Палец по слою обзора крутит камеру и жмёт кнопки пада, спуск на сенсоре только на паде:
    // иначе каждый доворот взгляда уходил бы в очередь.
    if (event.button !== 0 || event.pointerType === 'touch' || isEditing()) return;
    triggerHeld = true;
    triggerPressed = true;
  });
  window.addEventListener('pointerup', (event) => {
    if (event.button === 0) triggerHeld = false;
  });
  window.addEventListener('blur', () => {
    triggerHeld = false;
  });
  window.addEventListener('keydown', (event) => {
    if (event.code === RELOAD_KEY && !isEditing() && !isTyping(event)) reloadPressed = true;
  });

  /**
   * Заполнить намерение бойца.
   *
   * Нажатие живёт защёлкой до ближайшего шага боя и гасится только здесь: спуск читается
   * ровно один раз, но ни одного клика при этом не теряется.
   */
  function write(intent, { armed, automatic, aimPitch }) {
    intent.aim = armed;
    intent.fire = armed && (automatic ? triggerHeld || padHeld : triggerPressed);
    intent.reload = armed && reloadPressed;
    intent.aimPitch = aimPitch;
    triggerPressed = false;
    reloadPressed = false;
  }

  /**
   * Спуск с кнопки виртуального пада.
   *
   * Удержание живёт отдельно от мышиного: отпускание пальца где-то на слое обзора приходит
   * тем же `pointerup` и гасило бы очередь, хотя кнопку никто не отпускал.
   */
  function setPadTrigger(held) {
    if (held && !padHeld) triggerPressed = true;
    padHeld = held;
  }

  return { write, setPadTrigger };
}
