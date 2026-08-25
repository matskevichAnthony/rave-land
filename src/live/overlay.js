/**
 * Своя картинка на живом выходе: лого, знак, скан, что угодно принесённое файлом.
 *
 * Место в стопке решает всё, поэтому оно вынесено на пульт тремя словами, и слова эти
 * означают три разные судьбы картинки, а не три высоты.
 *
 * «Под машиной» кладёт её на видео до того, как сверху ляжет машина: лого светит из-под
 * разложения и остаётся целым. «В машину» вжигает её прямо в кадр PX перед разложением, и
 * дальше приём жуёт лого наравне с картинкой: буквы растекаются, двоятся каналами и
 * осыпаются вместе с фоном, потому что для машины это уже её собственные пиксели. «Поверх»
 * кладёт её последней, после всего разгрома: знак читается всегда, чего бы ни творилось под
 * ним, и это единственное место, годное для чужого лого, которое нельзя рвать.
 *
 * Удар качает картинку: на бочке она подрастает и тут же садится обратно. Это единственная
 * реакция слоя на звук, и её хватает: лого, дышащее в такт, читается частью сета, а не
 * вотермаркой поверх него.
 */

export const OVERLAY_PLACES = [
  { id: 'under', label: 'Под машиной' },
  { id: 'burn', label: 'В машину' },
  { id: 'over', label: 'Поверх' },
];

export const DEFAULT_PLACE = 'over';

// Насколько удар раздувает картинку и как быстро она садится обратно.
const PUNCH_GROWTH = 0.18;
const PUNCH_FALL = 0.12;

/**
 * Перекрашивание в краску серии: картинку приносят чёрно-белой, а выход держит два цвета,
 * поэтому у слоя есть тумблер, который выжигает исходные оттенки и оставляет форму.
 */
function tinted(image, width, height, hex) {
  const layer = document.createElement('canvas');
  layer.width = Math.max(1, Math.round(width));
  layer.height = Math.max(1, Math.round(height));
  const paint = layer.getContext('2d');
  paint.drawImage(image, 0, 0, layer.width, layer.height);
  paint.globalCompositeOperation = 'source-in';
  paint.fillStyle = hex;
  paint.fillRect(0, 0, layer.width, layer.height);
  return layer;
}

export function createOverlay() {
  let art = null;
  let tint = null;
  let tintedFor = null;
  let punch = 0;

  return {
    get image() {
      return art;
    },
    /** Файл с диска в картинку, готовую к отрисовке. Битый файл честно роняет обещание. */
    async open(file) {
      art = await createImageBitmap(file);
      tint = null;
      tintedFor = null;
      return art;
    },
    drop() {
      art?.close?.();
      art = null;
      tint = null;
      tintedFor = null;
    },
    /** Удар подкидывает картинку, дальше она садится сама, кадр за кадром. */
    pulse(hit) {
      if (hit) punch = 1;
      else punch += (0 - punch) * PUNCH_FALL;
    },
    /**
     * Отрисовка в любой холст: размер считается от ширины холста, а не от экрана, поэтому
     * одна и та же картинка одинаково садится и в буфер машины, и на полный кадр.
     */
    draw(ctx, { width, height }, { scale, alpha, blend, hex }) {
      if (!art) return;
      const grown = scale * (1 + PUNCH_GROWTH * punch);
      const span = width * grown;
      const tall = (span * art.height) / art.width;
      if (hex && tintedFor !== `${hex}:${Math.round(span)}`) {
        tint = tinted(art, span, tall, hex);
        tintedFor = `${hex}:${Math.round(span)}`;
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = blend;
      ctx.drawImage(hex ? tint : art, (width - span) / 2, (height - tall) / 2, span, tall);
      ctx.restore();
    },
  };
}
