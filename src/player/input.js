const pressed = new Set();
const axis = { x: 0, z: 0 };

/** Набирают текст, а не играют: горячие клавиши в поле ввода не срабатывают. */
export const isTyping = (event) => ['INPUT', 'TEXTAREA'].includes(event.target.tagName);

window.addEventListener('keydown', (event) => {
  if (!isTyping(event)) pressed.add(event.code);
});
window.addEventListener('keyup', (event) => pressed.delete(event.code));
window.addEventListener('blur', () => pressed.clear());

export const input = {
  isDown: (code) => pressed.has(code),
  /** Присед это удержание, а не переключатель: отпустил клавишу, встал. */
  crouching: () => pressed.has('KeyC'),
  /** Походка: шагом на Alt, бегом на Shift, обычная ходьба по умолчанию. */
  gait() {
    if (pressed.has('AltLeft') || pressed.has('AltRight')) return 'strollSpeed';
    if (pressed.has('ShiftLeft') || pressed.has('ShiftRight')) return 'runSpeed';
    return 'walkSpeed';
  },
  // Объект оси живёт один на всю игру: его спрашивают каждый кадр, а мусорщик на этой машине
  // даёт заметные провалы кадра.
  axis() {
    axis.x = (pressed.has('KeyD') || pressed.has('ArrowRight') ? 1 : 0)
      - (pressed.has('KeyA') || pressed.has('ArrowLeft') ? 1 : 0);
    axis.z = (pressed.has('KeyW') || pressed.has('ArrowUp') ? 1 : 0)
      - (pressed.has('KeyS') || pressed.has('ArrowDown') ? 1 : 0);
    return axis;
  },
};
