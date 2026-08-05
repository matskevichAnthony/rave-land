const element = document.querySelector('[data-toast]');
let hideTimer = null;

export function toast(message, durationMs = 3500) {
  element.textContent = message;
  element.hidden = false;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    element.hidden = true;
  }, durationMs);
}
