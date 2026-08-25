/** Сохранение карточки файлом: холст уходит в PNG без потерь, афишу потом правят руками. */

const MIME = 'image/png';

function save(blob, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function downloadCanvas(canvas, name) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      save(blob, `${name}.png`);
      resolve(blob.size);
    }, MIME);
  });
}
