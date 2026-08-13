/** Своя картинка на вход маршрута: выбором файла или перетаскиванием в окно.
 *
 * Перекодировка в PNG идёт на странице холстом: на диск маршрута ложится ровно то,
 * что читают инструменты, а не JPEG под именем image.png. Заодно снимается предел
 * размера, потому что фотография с телефона для TripoSR всё равно ужимается.
 */

const KINDS = /^image\/(png|jpeg)$/;
const SIZE_LIMIT_MB = 8;
const MAX_SIDE = 1024;

const megabytes = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10;

export async function toPng(file) {
  if (!KINDS.test(file.type)) {
    throw new Error(`Жду PNG или JPEG, а ${file.name} это «${file.type || 'непонятно что'}»`);
  }
  if (file.size > SIZE_LIMIT_MB * 1024 * 1024) {
    throw new Error(`Картинка на ${megabytes(file.size)} МБ, предел ${SIZE_LIMIT_MB} МБ`);
  }

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    .catch((error) => { throw new Error(`Не прочитал ${file.name}: ${error.message}`); });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => (blob ? resolve(blob) : reject(new Error('Браузер не смог перекодировать картинку'))),
    'image/png',
  ));
}

export function createOwnImage(root, onFile) {
  const input = root.querySelector('[data-js-file]');
  let busy = false;

  const take = (file) => file && !busy && onFile(file);

  input.addEventListener('change', () => {
    take(input.files[0]);
    // Иначе тот же файл вторым выбором не считается изменением и события не будет.
    input.value = '';
  });

  // Бросают куда попало, а не точно в рамку, поэтому окно целиком принимает файл,
  // а рамка только подсвечивается: иначе браузер откроет картинку вместо страницы.
  window.addEventListener('dragover', (event) => {
    event.preventDefault();
    root.classList.toggle('is-dragged', !busy);
  });
  window.addEventListener('dragleave', (event) => {
    if (!event.relatedTarget) root.classList.remove('is-dragged');
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    root.classList.remove('is-dragged');
    take(event.dataTransfer.files[0]);
  });

  return {
    setBusy(value) {
      busy = value;
      input.disabled = value;
      root.classList.toggle('is-busy', value);
    },
  };
}
