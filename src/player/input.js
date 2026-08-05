const pressed = new Set();

const isTyping = (event) => ['INPUT', 'TEXTAREA'].includes(event.target.tagName);

window.addEventListener('keydown', (event) => {
  if (!isTyping(event)) pressed.add(event.code);
});
window.addEventListener('keyup', (event) => pressed.delete(event.code));
window.addEventListener('blur', () => pressed.clear());

export const input = {
  isDown: (code) => pressed.has(code),
  axis() {
    const x = (pressed.has('KeyD') || pressed.has('ArrowRight') ? 1 : 0)
      - (pressed.has('KeyA') || pressed.has('ArrowLeft') ? 1 : 0);
    const z = (pressed.has('KeyW') || pressed.has('ArrowUp') ? 1 : 0)
      - (pressed.has('KeyS') || pressed.has('ArrowDown') ? 1 : 0);
    return { x, z };
  },
};
