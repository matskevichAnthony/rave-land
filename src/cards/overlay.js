/**
 * Слой своей картинки на карточке: знак, лого, скан, что угодно принесённое файлом.
 *
 * Место в стопке решает всё, поэтому оно вынесено на пульт двумя словами. «Под эффектом»
 * кладёт картинку сразу на фон, до фактуры, объёма, эффектора и рамки: дальше её жуют все
 * приёмы наравне с кадром, и она перестаёт быть наклейкой. «Поверх» кладёт её после всего
 * разгрома, но под набор: знак остаётся целым, а имя всё равно читается поверх него.
 *
 * Картинка вписывается по ширине и не растягивается: чужое лого, растянутое под формат, это
 * первое, что видно на афише, и видно плохо.
 */


export const OVERLAY_PLACES = [
  { id: 'under', label: 'Под эффектом' },
  { id: 'over', label: 'Поверх' },
];

export const DEFAULT_OVERLAY = {
  image: null,
  place: 'under',
  scale: 0.6,
  alpha: 1,
  blend: 'source-over',
  tint: false,
};

/**
 * Перекрашивание в жар: картинку берут чёрно-белую, а серия держит два цвета, поэтому у
 * слоя есть тумблер, который выжигает исходные оттенки и оставляет форму.
 */
function tinted(image, width, height, hex) {
  const layer = document.createElement('canvas');
  layer.width = width;
  layer.height = height;
  const paint = layer.getContext('2d');
  paint.drawImage(image, 0, 0, width, height);
  paint.globalCompositeOperation = 'source-in';
  paint.fillStyle = hex;
  paint.fillRect(0, 0, width, height);
  return layer;
}

export function drawOverlay(ctx, frame, overlay, inks) {
  if (!overlay?.image) return;
  const width = frame.innerWidth * overlay.scale;
  const height = (width * overlay.image.height) / overlay.image.width;
  const x = (frame.width - width) / 2;
  const y = (frame.height - height) / 2;
  const art = overlay.tint ? tinted(overlay.image, width, height, inks.ember) : overlay.image;

  ctx.save();
  ctx.globalAlpha = overlay.alpha;
  ctx.globalCompositeOperation = overlay.blend;
  ctx.drawImage(art, x, y, width, height);
  ctx.restore();
}

/** Файл с диска в картинку, готовую к отрисовке. */
export function loadOverlay(file) {
  return new Promise((done, fail) => {
    const image = new Image();
    const address = URL.createObjectURL(file);
    image.addEventListener('load', () => {
      URL.revokeObjectURL(address);
      done(image);
    });
    image.addEventListener('error', () => {
      URL.revokeObjectURL(address);
      fail(new Error(`Картинка «${file.name}» не открылась`));
    });
    image.src = address;
  });
}
