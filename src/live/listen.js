/**
 * Слух: уровень, полосы и удары, из которых кормится всё живое на экране.
 *
 * Источников звука два и оба нужны. Микрофон слышит зал целиком, с бочкой из колонок и
 * криком толпы, но ловит и то, что говорят рядом с ноутбуком. Дорожка самого видео чистая,
 * но знает только то, что в клипе. Переключатель ставится на пульт, а не выбирается за
 * человека: на репетиции честнее дорожка, в зале честнее микрофон.
 *
 * Шкала громкости выставляется руками, и это осознанный отказ от автоматики. Автоматика
 * решает за человека, когда «уже громко», и когда её догадка расходится с тем, что слышно,
 * спорить с ней нечем. Поэтому здесь два числа, тишина и громко, и оба стоят там, куда их
 * поставила рука. Чтобы руке было по чему ставить, слух отдаёт наверх и сырой уровень:
 * пульт рисует его второй полоской, и видно, где лежит фон комнаты и куда доходит бочка.
 *
 * Удар это другое дело, и вот его руками не выставить в принципе. Ручная планка на прирост
 * врёт, потому что прирост от стука по столу и прирост от бочки из колонок в микрофон
 * отличаются в разы: при любом положении ползунка ловится либо только стук, либо всё
 * подряд. Поэтому планка меряется самим залом. Прирост каждой полосы копится за полторы
 * секунды, из него берётся медиана и разброс вокруг неё, и ударом считается то, что вышло
 * за разброс. Медиана это фон зала, разброс это его обычная суета, а удар это событие,
 * которого в этой суете быть не должно. Ползунок «Импульс» двигает не планку, а строгость:
 * во сколько разбросов считать ударом. В середине он работает и дома, и в клубе.
 *
 * Полос три, и они считаны в герцах, а не в долях массива бинов: бочка, тело со снейром и
 * воздух живут по своим порогам и по своему времени удержания, потому что бочка не бывает
 * чаще трети секунды, а хэт бывает.
 *
 * Темп меряется автокорреляцией по истории прироста: если в зале есть ритм, история прироста
 * похожа сама на себя со сдвигом в один удар. Считается это раз в полсекунды, потому что за
 * кадр история не меняется настолько, чтобы ответ стал другим.
 */

// Окно спектра: две тысячи с лишним отсчётов дают в низу пять-шесть бинов на полосу бочки.
// При тысяче их два, и бочка неотличима от гула сети.
const FFT = 2048;

// Сглаживание анализатора размазывает атаку по кадрам, а атака здесь и есть предмет замера.
// Ровность картинки даёт своё сглаживание уровня ниже, ему это окно не нужно.
const SMOOTHING = 0.5;
const DECIBEL_FLOOR = -85;
const DECIBEL_CEIL = -20;

// Полосы уровня для картинки: низ, середина, воздух. В герцах, поэтому на любой частоте
// дискретизации делят звук одинаково.
const LEVEL_HZ = { low: [0, 1400], mid: [1400, 7000], high: [7000, 19000] };

// Полосы удара со своим временем удержания. Бочка не приходит чаще, чем раз в треть такта
// быстрого техно, снейр приходит чаще, хэт ещё чаще, и общее удержание врёт для всех троих.
const ONSET_BANDS = {
  kick: { hz: [40, 150], hold: 180 },
  snare: { hz: [150, 2000], hold: 120 },
  hat: { hz: [2000, 8000], hold: 70 },
};

// История прироста на полосу: полторы секунды при шестидесяти кадрах. Короче история, и
// планка едет за самой музыкой, съедая удары; длиннее, и она не успевает за сменой трека.
const HISTORY = 96;

// Во что превращается ползунок «Импульс»: строгость в разбросах над медианой. Полтора
// разброса ловят живой зал вместе с половиной его шороха, четыре пропускают только явные
// удары.
const STRICT_RANGE = [1.2, 4.0];

// Абсолютный пол планки: в настоящей тишине медиана и разброс равны нулю, и без пола ударом
// становился бы любой щелчок в тишине.
const QUIET_FLOOR = 0.0015;

// Удар обязан быть местным пиком: прирост больше, чем в соседних кадрах до него. Иначе
// затянутая атака синтезатора отбивает по удару на кадр всё время, пока она растёт.
const PEAK_LOOK = 3;

// Насколько выше планки прирост должен уйти, чтобы сила удара дошла до единицы.
const FORCE_SPAN = 1;

// Затухание силы удара по кадрам: шейдеру нужен спад, а не мигание в один кадр.
const FORCE_FALL = 0.18;

// Запас шкалы полоски над самой строгой планкой: метка порога должна оставаться внутри
// полоски при любом положении ползунка, а прироста выше неё должно быть видно.
const METER_SPAN = 1.6;

// Сглаживание уровня по кадрам: картинка должна дышать вместе со звуком, а не дёргаться на
// каждом пике. Атака быстрая, отпускание медленное, как у компрессора.
const ATTACK = 0.55;
const RELEASE = 0.12;

// Между тишиной и громко всегда остаётся зазор: сдвинув ползунки в одну точку, человек
// получил бы деление на ноль и мигающую единицу вместо картинки.
const MIN_SPAN = 0.02;

// Темп: история прироста копится с постоянным шагом, а не по кадрам, иначе просадка до
// тридцати кадров растянула бы найденный такт вдвое.
const TEMPO_STEP_MS = 10;
const TEMPO_HISTORY = 768;
const TEMPO_EVERY_MS = 500;

// Границы такта: от двухсот сорока ударов в минуту до сорока. Всё, что чаще, это дребезг
// одного удара, всё, что реже, это пауза, а не темп.
const LAG_RANGE_MS = [250, 1500];

// Какую долю собственной энергии история должна вернуть на найденном сдвиге, чтобы темп
// считался известным целиком. Живой ритм возвращает половину и больше, шум комнаты десятую.
const PEAK_SHARE = 0.4;

// Насколько хорош должен быть сдвиг вдвое-втрое короче найденного, чтобы взять его вместо
// найденного. Ритму одинаково идут его такт, два такта и четыре, и без этой проверки слух
// с одинаковым правом объявляет темп втрое медленнее настоящего.
const SUBMULTIPLE_SHARE = 0.7;
const SUBMULTIPLE_MAX = 4;

// Ниже этой энергии в истории нет ничего, кроме нулей: цифровая тишина, делить не на что.
const TEMPO_QUIET = 1e-12;

const MS_PER_MINUTE = 60000;
const BYTE_FULL = 255;

// Что отдаётся, когда слуха нет вовсе: тот же набор полей, чтобы читателю не приходилось
// проверять каждое из них на существование.
const SILENT = {
  level: 0, low: 0, mid: 0, high: 0, raw: 0,
  hit: false, rise: 0, punchAt: 0,
  kick: 0, snare: 0, hat: 0,
  tempo: 0, confidence: 0,
};

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * Полоса меряется по своему пику, а не по среднему.
 *
 * Среднее делит энергию бочки на всю ширину полосы, где половина бинов молчит, и живой звук
 * из зала даёт по нему проценты вместо десятков процентов. Пик отвечает на вопрос, который
 * тут и задаётся: есть ли в этой полосе сейчас что-нибудь громкое.
 */
function bandPeak(bins, [start, end]) {
  let peak = 0;
  for (let bin = start; bin < end; bin += 1) peak = Math.max(peak, bins[bin]);
  return peak / BYTE_FULL;
}

/** Прирост сильнее, чем в последних кадрах: иначе ударом считается любая точка на подъёме. */
function isLocalPeak(history, write, raise) {
  for (let back = 1; back <= PEAK_LOOK; back += 1) {
    if (history[(write - back + HISTORY) % HISTORY] >= raise) return false;
  }
  return true;
}

/** Средний разброс вокруг медианы: мера обычной суеты этой полосы. */
function meanDeviation(history, middle) {
  let sum = 0;
  for (let step = 0; step < HISTORY; step += 1) sum += Math.abs(history[step] - middle);
  return sum / HISTORY;
}

/**
 * Полоса удара: копит свой прирост, сама выводит из него планку и отвечает, был ли удар.
 *
 * Планка это медиана истории плюс средний разброс вокруг неё. Медиана берётся, а не среднее,
 * потому что среднее сдвигают вверх сами удары: чем громче зал бьёт, тем выше поднимается
 * планка и тем меньше ударов проходит. Медиана к редким выбросам равнодушна и остаётся тем,
 * чем и должна быть, обычным состоянием этой полосы.
 */
function createOnsetBand(hold) {
  const history = new Float32Array(HISTORY);
  const sorted = new Float32Array(HISTORY);
  let write = 0;
  let seeded = false;
  let firedAt = 0;

  const band = {
    rise: 0,
    meter: 0,
    mark: 0,
    force: 0,

    /** Кадр полосы: `raise` это её прирост, `strict` это строгость с ползунка. */
    sense(raise, strict, now) {
      // Первый кадр заполняет историю собой: пустая история даёт медиану в нуле, и первые
      // полторы секунды всё подряд оказывалось бы ударом.
      if (!seeded) {
        history.fill(raise);
        seeded = true;
      }

      const peak = isLocalPeak(history, write, raise);
      sorted.set(history);
      sorted.sort();
      const middle = sorted[HISTORY >> 1];
      const spread = meanDeviation(history, middle);

      const edge = middle + spread * strict + QUIET_FLOOR;
      const full = (middle + spread * STRICT_RANGE[1] + QUIET_FLOOR) * METER_SPAN;
      band.rise = raise;
      band.meter = clamp01(raise / full);
      band.mark = clamp01(edge / full);

      const onset = peak && raise > edge && now - firedAt > hold;
      if (onset) {
        firedAt = now;
        band.force = Math.max(band.force, clamp01((raise - edge) / (edge * FORCE_SPAN)));
      } else {
        band.force += (0 - band.force) * FORCE_FALL;
      }

      history[write] = raise;
      write = (write + 1) % HISTORY;
      return onset;
    },
  };
  return band;
}

/** Лучший сдвиг рядом с предполагаемым: пик автокорреляции гуляет на отсчёт в обе стороны. */
function sharpestNear(scores, minLag, maxLag, guess) {
  let found = guess;
  for (let lag = Math.max(minLag, guess - 1); lag <= Math.min(maxLag, guess + 1); lag += 1) {
    if (scores[lag - minLag] > scores[found - minLag]) found = lag;
  }
  return found;
}

/**
 * Самый короткий сдвиг, который объясняет ритм не хуже найденного.
 *
 * Автокорреляция одинаково хорошо отвечает на такт, на два такта и на четыре, а какой из них
 * выиграет, решает шум. Инструменту нужен самый короткий: на нём зал танцует.
 */
function shortestFit(scores, minLag, maxLag, lag, best) {
  for (let part = SUBMULTIPLE_MAX; part >= 2; part -= 1) {
    const guess = Math.round(lag / part);
    if (guess < minLag) continue;
    const near = sharpestNear(scores, minLag, maxLag, guess);
    if (scores[near - minLag] >= best * SUBMULTIPLE_SHARE) return near;
  }
  return lag;
}

/**
 * Темп: история прироста, похожая сама на себя со сдвигом ровно в один удар.
 *
 * Считается по постоянному шагу времени и раз в полсекунды. Каждый кадр смысла нет: за
 * шестнадцать миллисекунд шесть секунд истории не становятся другой музыкой, а перебор
 * сдвигов стоит дороже всего остального слуха вместе взятого.
 */
function createTempo() {
  const history = new Float32Array(TEMPO_HISTORY);
  const line = new Float32Array(TEMPO_HISTORY);
  const minLag = Math.round(LAG_RANGE_MS[0] / TEMPO_STEP_MS);
  const maxLag = Math.round(LAG_RANGE_MS[1] / TEMPO_STEP_MS);
  const scores = new Float32Array(maxLag - minLag + 1);

  let write = 0;
  let sampledAt = 0;
  let solvedAt = 0;
  let tempo = 0;
  let confidence = 0;

  /**
   * История разворачивается в прямую и лишается постоянной составляющей.
   *
   * Без вычета среднего автокорреляция меряет не ритм, а средний уровень: все сдвиги выходят
   * одинаково хорошими, и пик оказывается там, где длиннее кусок совпадения.
   */
  function straighten() {
    let sum = 0;
    for (let step = 0; step < TEMPO_HISTORY; step += 1) {
      const value = history[(write + step) % TEMPO_HISTORY];
      line[step] = value;
      sum += value;
    }
    const mean = sum / TEMPO_HISTORY;
    let energy = 0;
    for (let step = 0; step < TEMPO_HISTORY; step += 1) {
      line[step] -= mean;
      energy += line[step] * line[step];
    }
    return energy / TEMPO_HISTORY;
  }

  function solve() {
    const energy = straighten();
    if (energy < TEMPO_QUIET) {
      tempo = 0;
      confidence = 0;
      return;
    }
    let best = -Infinity;
    let bestLag = 0;
    let sum = 0;
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let pair = 0;
      for (let step = 0; step + lag < TEMPO_HISTORY; step += 1) pair += line[step] * line[step + lag];
      const score = pair / TEMPO_HISTORY;
      scores[lag - minLag] = score;
      sum += score;
      if (score > best) {
        best = score;
        bestLag = lag;
      }
    }
    const mean = sum / scores.length;
    const lag = shortestFit(scores, minLag, maxLag, bestLag, best);

    // Уверенность меряется долей собственной энергии истории, которая вернулась на этом
    // сдвиге. Сравнивать пик с остальными сдвигами нельзя: в шуме комнаты пик над ними
    // поднимается ровно так же, и слух заявлял бы уверенный темп в пустой комнате.
    confidence = clamp01((best - mean) / (energy * PEAK_SHARE));
    tempo = confidence > 0 ? MS_PER_MINUTE / (lag * TEMPO_STEP_MS) : 0;
  }

  return {
    get tempo() {
      return tempo;
    },
    get confidence() {
      return confidence;
    },
    /** Кадр темпа: прирост ложится в историю по шагам времени, ответ пересчитывается изредка. */
    feed(rise, now) {
      // Долгий провал (свёрнутая вкладка, смена источника) не должен размножаться в историю
      // сотнями одинаковых отсчётов: она перестала быть записью зала, и заполнять её нечем.
      if (now - sampledAt > TEMPO_STEP_MS * TEMPO_HISTORY) sampledAt = now - TEMPO_STEP_MS;
      while (now - sampledAt >= TEMPO_STEP_MS) {
        history[write] = rise;
        write = (write + 1) % TEMPO_HISTORY;
        sampledAt += TEMPO_STEP_MS;
      }
      if (now - solvedAt < TEMPO_EVERY_MS) return;
      solvedAt = now;
      solve();
    },
    forget() {
      history.fill(0);
      tempo = 0;
      confidence = 0;
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

  // Спектр прошлого кадра: прирост считается по нему, и это вся память слуха.
  const before = new Uint8Array(analyser.frequencyBinCount);

  // Границы полос считаются один раз: ширина бина известна из частоты дискретизации зала,
  // и на сорока восьми килогерцах она не та же, что на сорока четырёх.
  const perBin = context.sampleRate / FFT;
  const binsOf = ([from, to]) => {
    const start = Math.min(bins.length - 1, Math.round(from / perBin));
    return [start, Math.max(start + 1, Math.min(bins.length, Math.round(to / perBin)))];
  };
  const levelRange = {
    low: binsOf(LEVEL_HZ.low),
    mid: binsOf(LEVEL_HZ.mid),
    high: binsOf(LEVEL_HZ.high),
  };
  const onsetRange = {
    kick: binsOf(ONSET_BANDS.kick.hz),
    snare: binsOf(ONSET_BANDS.snare.hz),
    hat: binsOf(ONSET_BANDS.hat.hz),
  };
  const kick = createOnsetBand(ONSET_BANDS.kick.hold);
  const snare = createOnsetBand(ONSET_BANDS.snare.hold);
  const hat = createOnsetBand(ONSET_BANDS.hat.hold);
  const tempo = createTempo();

  let feed = null;
  // Узел элемента заводится ровно один раз: второй `createMediaElementSource` на том же
  // теге браузер отвергает, а тег у всех источников общий.
  let elementNode = null;
  let level = 0;

  function connect(node) {
    feed?.disconnect();
    feed = node;
    node.connect(analyser);
  }

  /**
   * Прирост полосы за кадр: сумма того, что за этот кадр стало в ней громче.
   *
   * Считается только рост. Спад в звуке несёт столько же энергии, сколько атака, но ударом
   * не является ни разу: убранный фейдером синтезатор дал бы по этой сумме такой же скачок,
   * как бочка, и картинка отбивала бы такт по выключению звука.
   *
   * Полосы удара не пересекаются, поэтому память спектра обновляется здесь же: каждый бин
   * сравнивается с прошлым кадром ровно один раз.
   */
  function riseIn([start, end]) {
    let sum = 0;
    for (let bin = start; bin < end; bin += 1) {
      const step = bins[bin] - before[bin];
      if (step > 0) sum += step;
      before[bin] = bins[bin];
    }
    return sum / ((end - start) * BYTE_FULL);
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
      tempo.forget();
    },
    /**
     * Замер кадра: полосы, общий уровень, удары и темп.
     *
     * `quiet` и `loud` это концы ручной шкалы громкости, `punch` это строгость удара. Первые
     * два живут в мере сырого уровня, третий в мере прироста, и пульт рисует обе полоски
     * отдельно: сравнивать ползунок можно только с тем, что показано рядом с ним.
     */
    read({ quiet, loud, punch, now }) {
      if (!feed) return { ...SILENT };
      analyser.getByteFrequencyData(bins);
      const rawLow = bandPeak(bins, levelRange.low);
      const rawMid = bandPeak(bins, levelRange.mid);
      const rawHigh = bandPeak(bins, levelRange.high);

      const span = Math.max(MIN_SPAN, loud - quiet);
      const stretch = (value) => clamp01((value - quiet) / span);
      const low = stretch(rawLow);
      const mid = stretch(rawMid);
      const high = stretch(rawHigh);
      const target = Math.max(low, mid * 0.9, high * 0.7);
      level += (target - level) * (target > level ? ATTACK : RELEASE);

      const strict = STRICT_RANGE[0] + clamp01(punch) * (STRICT_RANGE[1] - STRICT_RANGE[0]);
      const kicked = kick.sense(riseIn(onsetRange.kick), strict, now);
      const snared = snare.sense(riseIn(onsetRange.snare), strict, now);
      hat.sense(riseIn(onsetRange.hat), strict, now);

      // Темп слушает низ вместе с телом: по одной бочке он теряется на брейке, по одному телу
      // считает за удар каждый слог вокала.
      tempo.feed(kick.rise + snare.rise, now);

      // Полоска показывает ту из двух ударных полос, которая сейчас дальше ушла над своим
      // фоном, и метку порога берёт у неё же: иначе человек сравнивает прирост одной полосы
      // с планкой другой.
      const lead = kick.meter > snare.meter ? kick : snare;

      return {
        level,
        low,
        mid,
        high,
        raw: Math.max(rawLow, rawMid, rawHigh),
        hit: kicked || snared,
        rise: lead.meter,
        punchAt: lead.mark,
        kick: kick.force,
        snare: snare.force,
        hat: hat.force,
        tempo: tempo.tempo,
        confidence: tempo.confidence,
      };
    },
  };
}
