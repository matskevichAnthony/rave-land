/**
 * Слух: уровень, полосы и удар, из которых кормится всё живое на экране.
 *
 * Источников звука два и оба нужны. Микрофон слышит зал целиком, с бочкой из колонок и
 * криком толпы, но ловит и то, что говорят рядом с ноутбуком. Дорожка самого видео чистая,
 * но знает только то, что в клипе. Переключатель ставится на пульт, а не выбирается за
 * человека: на репетиции честнее дорожка, в зале честнее микрофон.
 *
 * Порог здесь не ползунок, а калибровка, и это главное решение файла. Фиксированный порог
 * врёт всегда: в клубе микрофон упирается в потолок и любое число ниже единицы означает
 * «всё громкое», дома тот же микрофон не доползает и до трети, и та же цифра означает
 * «тишина». Одна настройка не может обслужить оба зала, потому что мерить надо не
 * громкость, а то, насколько сейчас громче, чем было только что.
 *
 * Поэтому слух ведёт две линии, пол и потолок, и растягивает уровень между ними. Пол
 * падает быстро и поднимается медленно, потолок наоборот: так шум усилителя уезжает в ноль
 * за секунды, а редкий пик держит шкалу и не даёт ей схлопнуться на затихшем месте.
 * Расстояние между линиями это и есть ответ на вопрос, звучит ли что-нибудь вообще: пока
 * оно уже мёртвой зоны, в комнате тихо, и картинка честно стоит, сколько бы ни шипел вход.
 *
 * Ползунок остаётся, но означает другое: это подрез снизу поверх калибровки. Ноль значит
 * «верю калибровке целиком», и это рабочее положение в обоих залах.
 */

const FFT = 1024;
const SMOOTHING = 0.72;
const DECIBEL_FLOOR = -85;
const DECIBEL_CEIL = -20;

// Границы полос в долях спектра: бочка, тело, воздух. Считаны от частоты дискретизации,
// поэтому на любом железе делят звук одинаково.
const BANDS = { low: [0, 0.06], mid: [0.06, 0.3], high: [0.3, 0.8] };

// Ход калибровки за кадр. Пол падает за десятые доли секунды и всплывает за минуту: зал,
// который стал тише, слух заметит сразу, а паузу между треками не примет за новый зал.
// Потолок берёт пик мгновенно и сдаёт его за те же полминуты, иначе один хлопок дверью
// оставил бы шкалу задранной до конца сета.
const FLOOR_FALL = 0.08;
const FLOOR_RISE = 0.0004;
const CEIL_RISE = 0.5;
const CEIL_FALL = 0.0009;

// Мёртвая зона: пока пол и потолок ближе этого, в комнате нет звука, а есть вход. Число
// подобрано по шуму встроенного микрофона ноутбука в тихой комнате: он даёт около трёх
// сотых шкалы и не даёт разброса вовсе, потому что шум ровный.
const DEAD_SPAN = 0.07;

// Разгон калибровки: первые секунды линии ещё сходятся, и растягивать по ним нечего.
const WARMUP_MS = 1200;

// Удар не повторяется чаще, чем раз в такт быстрого техно: иначе один затянутый рёв
// синтезатора отбивает по удару на кадр и картинка захлёбывается.
const HIT_HOLD_MS = 110;

// Удар это низ, вышедший над собственным средним, а не над абсолютной цифрой. Средний низ
// в клубе и дома отличается в разы, отношение к нему не отличается вовсе: бочка всегда
// заметно громче того, что было в полосе секунду назад.
const BEAT_RATIO = 1.35;
const BEAT_FLOOR = 0.12;
const BEAT_MEMORY = 0.06;

// Сглаживание уровня по кадрам: картинка должна дышать вместе со звуком, а не дёргаться на
// каждом пике. Атака быстрая, отпускание медленное, как у компрессора.
const ATTACK = 0.55;
const RELEASE = 0.12;

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

/**
 * Калибровка одной полосы: пол, потолок и растянутое между ними значение.
 *
 * Каждая полоса ведёт свои линии. Общие линии на все три означали бы, что тарелки меряются
 * потолком бочки и никогда до него не доходят, то есть верх шкалы у них не наступает вовсе.
 */
function createRange() {
  let floor = 1;
  let ceil = 0;

  return {
    get span() {
      return ceil - floor;
    },
    /** Возвращает долю от 0 до 1 или ноль, пока в полосе нет разброса. */
    stretch(raw, ready) {
      floor += (raw - floor) * (raw < floor ? FLOOR_FALL : FLOOR_RISE);
      ceil += (raw - ceil) * (raw > ceil ? CEIL_RISE : CEIL_FALL);
      const span = ceil - floor;
      if (!ready || span < DEAD_SPAN) return 0;
      return clamp01((raw - floor) / span);
    },
  };
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
  const ranges = { low: createRange(), mid: createRange(), high: createRange() };
  let level = 0;
  let beatMean = 0;
  let hitAt = 0;
  let listenAt = 0;

  function connect(node) {
    feed?.disconnect();
    feed = node;
    node.connect(analyser);
  }

  /** Новый источник это новый зал: линии калибровки начинаются заново. */
  function recalibrate(now) {
    ranges.low = createRange();
    ranges.mid = createRange();
    ranges.high = createRange();
    beatMean = 0;
    level = 0;
    listenAt = now;
  }

  return {
    /** Микрофон: слышит зал, включая то, что не выходит из ноутбука. */
    async microphone() {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      await context.resume();
      connect(context.createMediaStreamSource(stream));
      recalibrate(performance.now());
      return 'microphone';
    },
    /** Дорожка источника: у захвата вкладки берётся её звук, у файла звук самого файла. */
    async source({ stream, video }) {
      await context.resume();
      recalibrate(performance.now());
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
     * Замер кадра: полосы, общий уровень, удар и состояние калибровки.
     *
     * `trim` это ползунок пульта, подрез снизу поверх калибровки, а не абсолютный порог.
     * `ready` говорит пульту, слышит слух зал или ещё меряет его: без этого тихая комната и
     * неразогретая калибровка выглядят одинаково, и человек за пультом крутит громкость
     * вместо того, чтобы подождать секунду.
     */
    read({ trim, now }) {
      if (!feed) return { level: 0, low: 0, mid: 0, high: 0, hit: false, ready: false, span: 0 };
      analyser.getByteFrequencyData(bins);
      const ready = now - listenAt > WARMUP_MS;
      const cut = (value) => (trim >= 1 ? 0 : clamp01((value - trim) / (1 - trim)));
      const low = cut(ranges.low.stretch(bandLevel(bins, BANDS.low), ready));
      const mid = cut(ranges.mid.stretch(bandLevel(bins, BANDS.mid), ready));
      const high = cut(ranges.high.stretch(bandLevel(bins, BANDS.high), ready));
      const raw = Math.max(low, mid * 0.9, high * 0.7);
      level += (raw - level) * (raw > level ? ATTACK : RELEASE);

      // Удар: низ обогнал собственное среднее и не повторяется чаще такта. Среднее ведётся
      // по калиброванному низу, поэтому отношение одинаково работает в зале и в комнате.
      const hit = ready && low > BEAT_FLOOR && low > beatMean * BEAT_RATIO && now - hitAt > HIT_HOLD_MS;
      beatMean += (low - beatMean) * BEAT_MEMORY;
      if (hit) hitAt = now;

      return { level, low, mid, high, hit, ready, span: ranges.low.span };
    },
  };
}
