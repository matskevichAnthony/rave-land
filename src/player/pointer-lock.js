/**
 * Pointer Lock как необязательная возможность браузера.
 *
 * В iOS Safari этого API нет вовсе, и прямой `document.exitPointerLock()` роняет там весь
 * режим прогулки. Проверка живёт в одном месте и смотрит на наличие функции, а не на
 * user-agent: набор возможностей у одного и того же браузера меняется от версии к версии.
 */

export const pointerLockSupported = () => typeof document.exitPointerLock === 'function';

export const isPointerLocked = (element) => document.pointerLockElement === element;

export function requestPointerLock(element) {
  if (typeof element.requestPointerLock !== 'function') return;
  // Пока снимается предыдущий захват, браузер отклоняет обещание нового: без перехвата отказ
  // всплывает ошибкой в консоли, хотя ничего не сломалось.
  element.requestPointerLock()?.catch(() => {});
}

export function exitPointerLock() {
  if (pointerLockSupported()) document.exitPointerLock();
}
