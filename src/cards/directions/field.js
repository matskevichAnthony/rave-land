import { PALETTE } from '../../understav/palette.js';
import { between } from '../../procedural/random.js';
import { createFieldObject } from '../field-object.js';
import { logoLayer } from '../logo.js';
import { NARROW_FACE, fillTracked, measureLine } from '../lettering.js';
import { grain, slices, vignette } from '../wear.js';

/**
 * Направление «Поле»: одна ровная заливка и на ней одна маленькая непонятная штука.
 *
 * Самое пустое направление серии и единственное генеративное: предмет в середине не нарисован,
 * а выращен из шума по сиду карточки, поэтому у каждого артиста он свой.
 *
 * Правило снято обмером чужой ниши, а не выбрано на вкус: у разобранных там обложек медиана
 * содержимого в кадре двенадцать процентов, а поле держит остальное. Отсюда и размер предмета:
 * он занимает треть короткой стороны, и его краска садится примерно в ту же долю кадра.
 *
 * Цвет поля переключает режим целиком и выбирается сидом. Их четыре, и они не оттенки одного:
 * чёрное поле прячет, зелёное выдаёт незаконченный кадр, красное тревожит, белое обнажает.
 * Направление одно, а серия из шести карточек выходит разной, не меняя ни одного правила.
 */

// Зелень хромакея живёт здесь, а не в палитре сцены: в зале такого цвета нет и быть не может.
// Это технический цвет, фон под вырезание, и весь смысл режима в том, что его не вырезали.
const CHROMA = '#0cb40c';
const SIGNAL = '#fc0c0c';
const PAPER = '#f2efe9';

// `figure` это краска предмета, `accent` краска служебной строки. Разведены намеренно: на
// зелёном поле кровь ещё читается фигурой, но строкой мелким кеглем уже нет.
const MODES = [
  { field: PALETTE.void, ink: PALETTE.bone, accent: PALETTE.ember, figure: PALETTE.ember, mark: PALETTE.concrete },
  { field: CHROMA, ink: PALETTE.void, accent: PALETTE.void, figure: PALETTE.blood, mark: PALETTE.void },
  { field: SIGNAL, ink: PAPER, accent: PALETTE.void, figure: PALETTE.void, mark: PALETTE.void },
  { field: PAPER, ink: PALETTE.void, accent: PALETTE.blood, figure: PALETTE.blood, mark: PALETTE.concrete },
];

// Предмет в долях короткой стороны и его снос от середины: строго по центру он читается
// мишенью, а не находкой.
const OBJECT_SIZE_RATIO = 0.34;
const OBJECT_DRIFT = 0.06;
const OBJECT_CENTRE_RATIO = 0.44;

const LOGO_HEIGHT_UNITS = 7;
const CAPS_PIXELS_UNITS = 2.1;
const CAPS_TRACKING = 0.62;
const CREDIT_PIXELS_UNITS = 1.5;
const CREDIT_TRACKING = 0.34;
const CAPS_TOP_UNITS = 12;
const CAPS_BOTTOM_UNITS = 14;
const CREDIT_LEAD_UNITS = 5;

const SLICE_BANDS = 18;
const SLICE_SHIFT_UNITS = 0.9;
const GRAIN = 0.03;
const VIGNETTE = 0.3;

/** Строка вразрядку по центру кадра: единственный способ набора в этом направлении. */
function centred(ctx, frame, text, { y, pixels, tracking, color }) {
  const line = { pixels, tracking, face: NARROW_FACE, color };
  const width = measureLine(ctx, text, line);
  fillTracked(ctx, text, { ...line, x: (frame.width - width) / 2, y });
}

export default {
  id: 'field',
  label: 'Поле',
  paint({ ctx, frame, random, event, artist, logo }) {
    // Режим выбирает не бросок, а номер артиста: серию смотрят целиком, и четыре поля обязаны
    // в ней встретиться. На случайном выборе шесть карточек трижды выпадали одним цветом.
    const mode = MODES[(Number(artist.number) - 1) % MODES.length];
    ctx.fillStyle = mode.field;
    ctx.fillRect(0, 0, frame.width, frame.height);

    const size = Math.round(Math.min(frame.width, frame.height) * OBJECT_SIZE_RATIO);
    const object = createFieldObject({ size, random, ink: mode.figure });
    ctx.drawImage(
      object.canvas,
      (frame.width - size) / 2 + between(random, -1, 1) * frame.width * OBJECT_DRIFT,
      frame.height * OBJECT_CENTRE_RATIO - size / 2,
    );

    const mark = logoLayer(logo.wordmark, {
      width: (frame.unit * LOGO_HEIGHT_UNITS * logo.wordmark.width) / logo.wordmark.height,
      color: mode.mark,
    });
    ctx.drawImage(mark, (frame.width - mark.width) / 2, frame.top);

    centred(ctx, frame, artist.name, {
      y: frame.top + frame.unit * CAPS_TOP_UNITS,
      pixels: frame.unit * CAPS_PIXELS_UNITS,
      tracking: CAPS_TRACKING,
      color: mode.ink,
    });
    centred(ctx, frame, `${artist.number} / ${event.dateLabel}`, {
      y: frame.bottom - frame.unit * CAPS_BOTTOM_UNITS,
      pixels: frame.unit * CAPS_PIXELS_UNITS,
      tracking: CAPS_TRACKING,
      color: mode.accent,
    });
    if (artist.credit) {
      centred(ctx, frame, artist.credit, {
        y: frame.bottom - frame.unit * (CAPS_BOTTOM_UNITS - CREDIT_LEAD_UNITS),
        pixels: frame.unit * CREDIT_PIXELS_UNITS,
        tracking: CREDIT_TRACKING,
        color: mode.ink,
      });
    }

    slices(ctx, frame, random, { bands: SLICE_BANDS, shift: frame.unit * SLICE_SHIFT_UNITS });
    grain(ctx, frame, random, GRAIN);
    vignette(ctx, frame, { hex: mode.field, amount: VIGNETTE });
  },
};
