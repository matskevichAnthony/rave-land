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
 * Сид компоновки качает этот размер и центр через `look`, не выходя из духа правила.
 *
 * Цвет поля переключает режим целиком и выбирается номером артиста. Их четыре, и они не
 * оттенки одного: чёрное поле прячет, зелёное выдаёт незаконченный кадр, красное тревожит,
 * белое обнажает. Жар и кровь режимов приходят из `inks`: глобальные цвета пульта
 * докрашивают и это направление.
 */

// Зелень хромакея живёт здесь, а не в палитре сцены: в зале такого цвета нет и быть не может.
// Это технический цвет, фон под вырезание, и весь смысл режима в том, что его не вырезали.
const CHROMA = '#0cb40c';
const SIGNAL = '#fc0c0c';
const PAPER = '#f2efe9';

// `figure` это краска предмета, `accent` краска служебной строки. Разведены намеренно: на
// зелёном поле кровь ещё читается фигурой, но строкой мелким кеглем уже нет.
function modesOf(inks) {
  return [
    { field: inks.void, ink: inks.bone, accent: inks.ember, figure: inks.ember, mark: inks.concrete },
    { field: CHROMA, ink: inks.void, accent: inks.void, figure: inks.blood, mark: inks.void },
    { field: SIGNAL, ink: PAPER, accent: inks.void, figure: inks.void, mark: inks.void },
    { field: PAPER, ink: inks.void, accent: inks.blood, figure: inks.blood, mark: inks.concrete },
  ];
}

// Предмет в долях короткой стороны и его снос от середины: строго по центру он читается
// мишенью, а не находкой.
const OBJECT_SIZE_RATIO = 0.34;
const OBJECT_DRIFT = 0.06;

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
  paint({ ctx, frame, random, event, artist, logo, inks, look, type, textOnly, show }) {
    // Режим выбирает не бросок, а номер артиста: серию смотрят целиком, и четыре поля обязаны
    // в ней встретиться. На случайном выборе шесть карточек трижды выпадали одним цветом.
    const mode = modesOf(inks)[(Number(artist.number) - 1) % 4];

    if (!textOnly) {
      ctx.fillStyle = mode.field;
      ctx.fillRect(0, 0, frame.width, frame.height);

      const size = Math.round(
        Math.min(frame.width, frame.height) * OBJECT_SIZE_RATIO * look.objectScale,
      );
      const object = createFieldObject({ size, random, ink: mode.figure });
      ctx.drawImage(
        object.canvas,
        (frame.width - size) / 2 + between(random, -1, 1) * frame.width * OBJECT_DRIFT,
        frame.height * look.objectCentre - size / 2,
      );

      const mark = logoLayer(logo.wordmark, {
        width: (frame.unit * LOGO_HEIGHT_UNITS * look.logoScale * logo.wordmark.width)
          / logo.wordmark.height,
        color: mode.mark,
      });
      ctx.drawImage(mark, (frame.width - mark.width) / 2, frame.top);
    }

    // На прозрачном текстовом слое чернила режима остаются: кто соберёт слой на своём поле,
    // тот и решит, годится ли ему этот цвет.
    if (show.name) {
      centred(ctx, frame, artist.name, {
        y: frame.top + frame.unit * CAPS_TOP_UNITS,
        pixels: frame.unit * CAPS_PIXELS_UNITS * type.scale('name'),
        tracking: CAPS_TRACKING,
        color: type.ink('name', mode.ink),
      });
    }
    if (show.meta) {
      centred(ctx, frame, `${artist.number} / ${event.dateLabel}`, {
        y: frame.bottom - frame.unit * CAPS_BOTTOM_UNITS,
        pixels: frame.unit * CAPS_PIXELS_UNITS * type.scale('meta'),
        tracking: CAPS_TRACKING,
        color: type.ink('meta', mode.accent),
      });
    }
    if (show.credit && artist.credit) {
      centred(ctx, frame, artist.credit, {
        y: frame.bottom - frame.unit * (CAPS_BOTTOM_UNITS - CREDIT_LEAD_UNITS),
        pixels: frame.unit * CREDIT_PIXELS_UNITS * type.scale('credit'),
        tracking: CREDIT_TRACKING,
        color: type.ink('credit', mode.ink),
      });
    }

    if (!textOnly) {
      slices(ctx, frame, random, { bands: SLICE_BANDS, shift: frame.unit * SLICE_SHIFT_UNITS });
      grain(ctx, frame, random, GRAIN);
      vignette(ctx, frame, { hex: mode.field, amount: VIGNETTE });
    }
  },
};
