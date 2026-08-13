/**
 * Записанные звуки San Andreas: выстрелы, щелчки, попадания.
 *
 * Синтез из соседних модулей остаётся живым и звучит, пока файлы не доехали: декодирование
 * идёт в фоне, а первый выстрел может случиться раньше. Поэтому здесь нет ожидания, есть
 * только вопрос «готово ли», и звонящий сам решает, чем закрыть тишину.
 *
 * Ствол выбирает семейство по группе из weapon.dat, а не по нашему идентификатору: группа
 * это то самое поле, которым сама игра различала звук кольта и звук помпы.
 */

const ROOT = 'assets/audio/';
const FAMILIES = {
  pistol: ['weapons/pistol-1.wav', 'weapons/pistol-2.wav', 'weapons/pistol-3.wav'],
  rifle: ['weapons/rifle-1.wav', 'weapons/rifle-2.wav', 'weapons/rifle-3.wav'],
  shotgun: ['weapons/shotgun-1.wav', 'weapons/shotgun-2.wav', 'weapons/shotgun-3.wav'],
  dry: ['weapons/dry-1.wav', 'weapons/dry-2.wav'],
  reload: ['weapons/reload-1.wav', 'weapons/reload-2.wav', 'weapons/reload-3.wav'],
  casing: ['weapons/casing-1.wav', 'weapons/casing-2.wav'],
  body: ['weapons/body-1.wav', 'weapons/body-2.wav'],
  ground: ['weapons/ground-1.wav', 'weapons/ground-2.wav', 'weapons/ground-3.wav'],
  hurt: ['pain/hurt-1.wav', 'pain/hurt-2.wav', 'pain/hurt-3.wav', 'pain/hurt-4.wav'],
  death: ['pain/death-1.wav', 'pain/death-2.wav', 'pain/death-3.wav'],
};
// Группы оружия из weapon.dat, у которых нет своей записи: пистолетные звучат кольтом,
// снайперские винтовочным.
const FAMILY_BY_GROUP = { colt45: 'pistol', python: 'pistol', sniper: 'rifle' };
// Записи лежат в исходной громкости San Andreas, а шина рассчитана на синтез.
const LEVEL = 0.7;

export function createSamples(ctx) {
  const buffers = new Map();

  async function load(file) {
    const response = await fetch(ROOT + file);
    const decoded = await ctx.decodeAudioData(await response.arrayBuffer());
    buffers.set(file, decoded);
  }

  // Файлы тянутся сразу и молча: неудача одного не должна ронять остальные, а без звука
  // игра остаётся играбельной, потому что синтез никуда не делся.
  Promise.allSettled(Object.values(FAMILIES).flat().map(load));

  return {
    familyOf: (weapon) => FAMILY_BY_GROUP[weapon.group] ?? weapon.group,

    /**
     * Голос из записи. Возвращает конец звучания, как и синтез, либо null, если файла ещё нет.
     *
     * Вариант выбирается случайно: три записи на ствол это разница между перестрелкой и
     * метрономом, и слышно её с первой же очереди.
     */
    voice(family) {
      const files = FAMILIES[family];
      const buffer = buffers.get(files[Math.floor(Math.random() * files.length)]);
      if (!buffer) return null;
      return (renderCtx, out, t0) => {
        const source = renderCtx.createBufferSource();
        const level = renderCtx.createGain();
        source.buffer = buffer;
        level.gain.value = LEVEL;
        source.connect(level).connect(out);
        source.start(t0);
        return t0 + buffer.duration;
      };
    },
  };
}
