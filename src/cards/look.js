/**
 * Компоновка карточки: куда встанет имя, каким кеглем и где лягут знак и номер.
 *
 * Раскладка считается из двух потоков, и это ответ на главный упрёк серии: раньше каждая
 * карточка бросала свою компоновку, и шесть афиш одного события не имели ни одного общего
 * решения. Теперь серийный поток, один на все карточки, решает макет: высоту имени, кегль,
 * сторону знака, наклон. Карточный поток добавляет только дыхание вокруг этой основы:
 * миллиметровые сдвиги, лёгкую разницу кегля. Серия читается серией, а не шестью чужими
 * афишами, при этом ни одна карточка не повторяет соседнюю точь-в-точь.
 *
 * Диапазоны узкие и выбраны руками: имя не заезжает на подвал, знак не выпадает из полей.
 */

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function createLook(series, card) {
  // Серийная основа: один бросок на все шесть карточек.
  const base = {
    nameCenter: series.range(0.32, 0.68),
    nameScale: series.range(0.72, 1.35),
    tilt: series.range(-0.035, 0.035),
    numberScale: series.range(0.5, 1.2),
    numberDrift: series.range(-0.12, 0.05),
    logoScale: series.range(0.65, 1.5),
    logoRight: series() < 0.35,
    drift: series.range(-0.05, 0.05),
    plateTop: series.range(0.56, 0.76),
    objectScale: series.range(0.7, 1.45),
    objectCentre: series.range(0.3, 0.58),
  };
  // Карточное дыхание: вариация вокруг основы, а не второй макет.
  return {
    ...base,
    nameCenter: clamp(base.nameCenter + card.range(-0.04, 0.04), 0.3, 0.7),
    nameScale: base.nameScale * card.range(0.94, 1.06),
    tilt: base.tilt + card.range(-0.008, 0.008),
    numberScale: base.numberScale * card.range(0.92, 1.08),
    numberDrift: base.numberDrift + card.range(-0.02, 0.02),
    logoScale: base.logoScale * card.range(0.94, 1.06),
    drift: base.drift + card.range(-0.015, 0.015),
    objectScale: base.objectScale * card.range(0.92, 1.08),
    objectCentre: clamp(base.objectCentre + card.range(-0.03, 0.03), 0.28, 0.6),
  };
}
