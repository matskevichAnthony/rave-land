/**
 * Слух: уровень, полосы и импульс, из которых кормится всё живое на экране.
 *
 * Источников звука два и оба нужны. Микрофон слышит зал целиком, с бочкой из колонок и
 * криком толпы, но ловит и то, что говорят рядом с ноутбуком. Дорожка самого видео чистая,
 * но знает только то, что в клипе. Переключатель ставится на пульт, а не выбирается за
 * человека: на репетиции честнее дорожка, в зале честнее микрофон.
 *
 * Шкала выставляется руками, и это осознанный отказ от автоматики. Автоматика меряет зал
 * сама и в этом её беда: она решает за человека, когда «уже громко», и когда её догадка
 * расходится с тем, что слышно, спорить с ней нечем. Живые колонки в комнате она принимает
 * за ровный фон и перестаёт отвечать вовсе. Поэтому здесь два числа, тишина и громко, и оба
 * стоят там, куда их поставила рука.
 *
 * Чтобы руке было по чему ставить, слух отдаёт наверх и сырой уровень тоже: пульт рисует
 * его второй полоской под своей и метками порогов. Ставится это глазами за пять секунд —
 * видно, где на самом деле лежит фон комнаты и куда доходит бочка.
 *
 * Импульс это отдельная вещь, а не громкость: низ, перешедший через свою планку. Инструмент
 * умеет играть сам, и играет он именно по импульсам, поэтому планка у них своя и тоже ручная.
 */

const FFT = 1024;
const SMOOTHING = 0.72;
const DECIBEL_FLOOR = -85;
const DECIBEL_CEIL = -20;

// Границы полос в долях спектра: бочка, тело, воздух. Считаны от частоты дискретизации,
// поэтому на любом железе делят звук одинаково.
const BANDS = { low: [0, 0.06], mid: [0.06, 0.3], high: [0.3, 0.8] };

// Импульс не повторяется чаще, чем раз в такт быстрого техно: иначе один затянутый рёв
// синтезатора отбивает по импульсу на кадр и картинка захлёбывается.
const HIT_HOLD_MS = 110;

// Сглаживание уровня по кадрам: картинка должна дышать вместе со звуком, а не дёргаться на
// каждом пике. Атака быстрая, отпускание медленное, как у компрессора.
const ATTACK = 0.55;
const RELEASE = 0.12;

// Между тишиной и громко всегда остаётся зазор: сдвинув ползунки в одну точку, человек
// получил бы деление на ноль и мигающую единицу вместо картинки.
const MIN_SPAN = 0.02;

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * Полоса меряется по своему пику, а не по среднему.
 *
 * Среднее делит энергию бочки на всю ширину полосы, где половина бинов молчит, и живой звук
 * из зала даёт по нему проценты вместо десятков процентов. Пик отвечает на вопрос, который
 * тут и задаётся: есть ли в этой полосе сейчас что-нибудь громкое.
 */
function bandLevel(bins, [from, to]) {
  const start = Math.floor(bins.length * from);
  const end = Math.max(start + 1, Math.floor(bins.length * to));
  let peak = 0;
  for (let bin = start; bin < end; bin += 1) peak = Math.max(peak, bins[bin]);
  return peak / 255;
}

export function createListening() {
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = FFT;
  analyser.smoothingTimeConstant = SMOOTHING;
  analyser.minDecibels = DECIBEL_FLOOR;
  analyser.maxDecibels = DECIBEL_CEIL;
  const bins = new Uint8Array(analyser.frequencyBinCount);

  let feed = null;
  // Узел элемента заводится ровно один раз: второй `createMediaElementSource` на том же
  // теге браузер отвергает, а тег у всех источников общий.
  let elementNode = null;
  let level = 0;
  let hitAt = 0;
  let wasLoud = false;

  function connect(node) {
    feed?.disconnect();
    feed = node;
    node.connect(analyser);
  }

  return {
    /**
     * Микрофон: слышит зал, включая то, что не выходит из ноутбука.
     *
     * Обработка входа выключена вся до одной. Подавление шума и автоматическая громкость
     * браузера написаны для разговора: они давят ровный гул, а ровный гул здесь это и есть
     * музыка из колонок, и картинка от неё перестаёт отвечать.
     */
    async microphone() {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      await context.resume();
      connect(context.createMediaStreamSource(stream));
      return 'microphone';
    },
    /** Дорожка источника: у захвата вкладки берётся её звук, у файла звук самого файла. */
    async source({ stream, video }) {
      await context.resume();
      if (stream?.getAudioTracks().length) {
        connect(context.createMediaStreamSource(stream));
        return 'source';
      }
      elementNode ??= context.createMediaElementSource(video);
      connect(elementNode);
      return 'source';
    },
    /** Тишина: граф отключается, и картинка перестаёт слушать что бы то ни было. */
    off() {
      feed?.disconnect();
      feed = null;
      level = 0;
    },
    /**
     * Замер кадра: полосы, общий уровень, импульс и сырой низ для полоски пульта.
     *
     * `quiet` и `loud` это концы ручной шкалы, `punch` планка импульса. Все три живут в той
     * же мере, что и сырой уровень на полоске, поэтому ползунок ставится по тому, что видно,
     * а не по тому, что думает про зал программа.
     */
    read({ quiet, loud, punch, now }) {
      if (!feed) return { level: 0, low: 0, mid: 0, high: 0, hit: false, raw: 0 };
      analyser.getByteFrequencyData(bins);
      const rawLow = bandLevel(bins, BANDS.low);
      const rawMid = bandLevel(bins, BANDS.mid);
      const rawHigh = bandLevel(bins, BANDS.high);

      const span = Math.max(MIN_SPAN, loud - quiet);
      const stretch = (value) => clamp01((value - quiet) / span);
      const low = stretch(rawLow);
      const mid = stretch(rawMid);
      const high = stretch(rawHigh);
      const target = Math.max(low, mid * 0.9, high * 0.7);
      level += (target - level) * (target > level ? ATTACK : RELEASE);

      // Импульс это переход через планку, а не громкость сама по себе: он выстреливает один
      // раз на атаку и молчит, пока низ держится наверху.
      const loudNow = rawLow > punch;
      const hit = loudNow && !wasLoud && now - hitAt > HIT_HOLD_MS;
      wasLoud = loudNow;
      if (hit) hitAt = now;

      return { level, low, mid, high, hit, raw: Math.max(rawLow, rawMid, rawHigh) };
    },
  };
}
