/**
 * Порча имени комбинирующими знаками: тот же приём, что в глитч-движке matzkaim.ru.
 *
 * Оттуда взяты пулы: только блок U+0300..U+036F, единственный, который покрыт всеми
 * системными шрифтами. Экзотика из полного набора движка на афише не годится: там, где
 * шрифта нет, знак выпадает в пустой квадрат, и вместо порчи выходит дыра.
 *
 * Отличие от движка одно и намеренное: поток случайности приходит параметром. Афиша обязана
 * повториться по сиду, а движок берёт случайность у браузера и даёт новую порчу на каждый вызов.
 */

const MARKS = {
  above: [
    '̀', '́', '̂', '̃', '̄', '̅', '̆', '̇',
    '̈', '̉', '̊', '̋', '̌', '̍', '̎', '̏',
    '̐', '̑', '̒', '̓', '̔', '̕', '̚', '̛',
    '̽', '̾', '̿', '͂', '͆', '͊', '͋', '͌',
    '͐', '͑', '͒', '͗', '͘', '͛',
  ],
  below: [
    '̖', '̗', '̘', '̙', '̜', '̝', '̞', '̟',
    '̠', '̡', '̢', '̣', '̤', '̥', '̦', '̧',
    '̨', '̩', '̪', '̫', '̬', '̭', '̮', '̯',
    '̰', '̱', '̲', '̳', '̹', '̺', '̻', '̼',
    'ͅ', '͇', '͈', '͉', '͍', '͎', '͓', '͔',
    '͕', '͖', '͙', '͚',
  ],
  overlay: [
    '̴', '̵', '̶', '̷', '̸', '͜', '͝', '͞',
    '͟', '͠', '͡', '͢',
  ],
};

const BLOCK_RAMP = ['░', '▒', '▓', '█'];

// Порча идёт волной к середине строки: начало и конец имени остаются чистыми. Афишу
// смотрят с ногтя, и равномерно съеденное имя перестаёт читаться первым же знаком.
const ABOVE_AT_PEAK = 7;
const BELOW_AT_PEAK = 5;
const OVERLAY_AT_PEAK = 2;
const OVERLAY_ODDS = 0.45;

const midEnvelope = (position) => Math.sin(Math.PI * position);

function stack(random, pool, count) {
  let marks = '';
  for (let index = 0; index < count; index += 1) marks += random.pick(pool);
  return marks;
}

/**
 * Имя, разъеденное знаками. `amount` от нуля (чисто) до единицы (месиво).
 */
export function corrupt(text, random, amount) {
  const glyphs = [...text];
  return glyphs.map((glyph, index) => {
    if (glyph === ' ') return glyph;
    const wave = midEnvelope(glyphs.length > 1 ? index / (glyphs.length - 1) : 0) * amount;
    return glyph
      + stack(random, MARKS.above, Math.round(wave * ABOVE_AT_PEAK))
      + stack(random, MARKS.below, Math.round(wave * BELOW_AT_PEAK))
      + stack(random, MARKS.overlay, random() < wave * OVERLAY_ODDS ? OVERLAY_AT_PEAK : 0);
  }).join('');
}

/** Полоса растровой ряби: тот же приём брутального пресета движка, шкала плотности блоками. */
export function blockRail(random, length) {
  return stack(random, BLOCK_RAMP, length);
}
