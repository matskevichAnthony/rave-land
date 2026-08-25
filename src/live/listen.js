/**
 * Слух: уровень и полосы звука, из которых кормится всё живое на экране.
 *
 * Источников звука два и оба нужны. Микрофон слышит зал целиком, с бочкой из колонок и
 * криком толпы, но ловит и то, что говорят рядом с ноутбуком. Дорожка самого видео чистая,
 * но знает только то, что в клипе. Переключатель ставится на пульт, а не выбирается за
 * человека: на репетиции честнее дорожка, в зале честнее микрофон.
 *
 * Порог здесь не украшение. Без него любая тишина всё равно шевелит картинку шумом
 * усилителя, и «реакция на звук» превращается в дрожь. Ниже порога уровень честно нулевой,
 * выше он растянут обратно на всю шкалу, поэтому картинка отвечает только на то, что
 * действительно громче фона.
 */

const FFT = 1024;
const SMOOTHING = 0.72;
const DECIBEL_FLOOR = -85;
const DECIBEL_CEIL = -20;

// Границы полос в долях спектра: бочка, тело, воздух. Считаны от частоты дискретизации,
// поэтому на любом железе делят звук одинаково.
const BANDS = { low: [0, 0.06], mid: [0.06, 0.3], high: [0.3, 0.8] };

// Удар не повторяется чаще, чем раз в такт быстрого техно: иначе один затянутый рёв
// синтезатора отбивает по удару на кадр и картинка захлёбывается. Сам удар считается по
// низу, перешедшему заметно выше порога: шипение тарелок бочкой не считается.
const HIT_HOLD_MS = 110;
const HIT_LEVEL = 0.35;

// Сглаживание уровня по кадрам: картинка должна дышать вместе со звуком, а не дёргаться на
// каждом пике. Атака быстрая, отпускание медленное, как у компрессора.
const ATTACK = 0.55;
const RELEASE = 0.12;

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

/** Порог снизу, растяжка сверху: тишина не шевелит картинку, громкое отдаёт всю шкалу. */
function gate(value, threshold) {
  return threshold >= 1 ? 0 : Math.max(0, (value - threshold) / (1 - threshold));
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
    /** Микрофон: слышит зал, включая то, что не выходит из ноутбука. */
    async microphone() {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false } });
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
     * Замер кадра: полосы, общий уровень и удар.
     *
     * Удар это переход через порог, а не громкость сама по себе: он выстреливает один раз
     * на атаку и молчит, пока звук держится наверху.
     */
    read({ threshold, now }) {
      analyser.getByteFrequencyData(bins);
      const low = gate(bandLevel(bins, BANDS.low), threshold);
      const mid = gate(bandLevel(bins, BANDS.mid), threshold);
      const high = gate(bandLevel(bins, BANDS.high), threshold);
      const raw = Math.max(low, mid * 0.9, high * 0.7);
      level += (raw - level) * (raw > level ? ATTACK : RELEASE);
      const loud = low > HIT_LEVEL;
      const hit = loud && !wasLoud && now - hitAt > HIT_HOLD_MS;
      wasLoud = loud;
      if (hit) hitAt = now;
      return { level, low, mid, high, hit };
    },
  };
}
