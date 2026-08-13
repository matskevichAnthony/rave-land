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

  domElement.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || isEditing()) return;
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
    intent.fire = armed && (automatic ? triggerHeld : triggerPressed);
    intent.reload = armed && reloadPressed;
    intent.aimPitch = aimPitch;
    triggerPressed = false;
    reloadPressed = false;
  }

  return { write };
}
