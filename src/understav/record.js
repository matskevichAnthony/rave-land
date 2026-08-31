// Холст в видеофайл. Дубль ведёт одна из двух реализаций: своим кодировщиком через
// WebCodecs, если браузер его даёт, и потоком в `MediaRecorder`, если нет. Контракт у них
// один: `info` о том, чем пишем, `frame()` на каждый отрисованный кадр и `stop()` с файлом.

// Поток холста при fps 0 ведут вручную: `captureStream(0)` плюс `requestFrame` на каждый
// отрисованный кадр, поэтому цикл, который тратит на кадр непредсказуемую долю процессора,
// всё равно даёт ровное видео: рекордер получает кадр ровно тогда, когда кадр готов, а не
// когда так решил таймер по часам.

// H.264 в mp4 идёт первым, чтобы файл открывался везде (Фото на iOS, QuickTime,
// Windows, Telegram); свежие Chrome и Edge и все Safari его пишут. Несколько
// написаний avc1/h264 расширяют совпадение. webm остаётся последним запасным
// вариантом для браузеров, которые mp4 писать до сих пор не умеют.
//
// Внутри mp4 профиль идёт по убыванию: High (640028) держит CABAC и восемь на восемь,
// Main (4D401F) только CABAC, Baseline (42E01E) не держит ни того, ни другого и на том
// же битрейте разваливает тёмный градиент на блоки. Зал тут почти весь из тёмных
// градиентов, поэтому порядок именно такой, а не «лишь бы avc1».
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1.4D401F',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/mp4;codecs=h264',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/**
 * Битрейт задаётся руками, иначе браузер пишет холст на своих двух с половиной мегабитах.
 *
 * Съёмка идёт по чёрному залу, а в нём зерно, дымка, искры и датамош: межкадровое сжатие на
 * таком кадре не экономит почти ничего, и дефолтного битрейта хватает ровно на то, чтобы
 * превратить тени в шевелящиеся квадраты. Считается битрейт от площади кадра, а не числом:
 * кадрирование меняет холст в разы, и одна цифра либо душит 16:9, либо раздувает 1:1.
 *
 * Своему кодировщику это потолок при постоянном качестве, `MediaRecorder` получает его как
 * цель: другого способа попросить у него картинку нет.
 */
const BITS_PER_PIXEL = 0.2;
// Кадры подаются рекордеру по мере отрисовки, и их столько, сколько дала видеокарта.
// Битрейт считается по потолку в шестьдесят: недобрать кадров дешевле, чем недобрать бит.
const REFERENCE_FPS = 60;
const MAX_BITRATE = 60_000_000;

// Без интервала Chrome копит весь дубль одним куском, и длинная запись умирает
// вместе с ним; периодический сброс держит потерю маленькой
const FLUSH_MS = 250;

// В Safari у дорожек холста нет requestFrame; поток по часам это ближайшее,
// что там есть к ручной подаче кадров
const CLOCKED_FPS = 30;

/**
 * Выше этого кадра дубль ведёт `MediaRecorder`, а не свой кодировщик.
 *
 * Свой кодировщик пишет качественнее: постоянный квантизатор вместо битрейта. Но просит он
 * его покадрово, а покадровый квантизатор в браузере умеет только программный кодировщик, и
 * на 4K кадр жмётся секундами. За дубль очередь не разгребается, и всё, что не успело,
 * дожимается уже после него: на пятисекундном дубле файл приходит через полминуты.
 *
 * `MediaRecorder` пишет поток кусками по ходу записи, платформенным кодировщиком, и после
 * дубля собирать нечего: файл готов вместе с последним кадром. Ниже порога остаётся свой
 * кодировщик: там он успевает за съёмкой, и качество лучше отдать ему.
 */
const STREAMED_PIXELS = 2_500_000;

const bitrateFor = (canvas) => Math.min(
  Math.round(canvas.width * canvas.height * REFERENCE_FPS * BITS_PER_PIXEL),
  MAX_BITRATE,
);

const pickMimeType = () => MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));

export const videoExtension = (blob) => (blob.type.includes('mp4') ? 'mp4' : 'webm');

export function createCanvasRecorder(canvas) {
  let take = null;
  let opening = false;

  /**
   * Начало дубля. Возвращает то, чем пишем: размер, кодек и битрейт.
   *
   * Свой кодировщик грузится по требованию: страница, с которой ничего не снимают, не
   * обязана тянуть мультиплексор mp4.
   */
  async function start({ fps = 0 } = {}) {
    if (take || opening) throw new Error('запись: дубль уже идёт');
    opening = true;
    try {
      take = await openTake(canvas, fps);
      return take.info;
    } finally {
      opening = false;
    }
  }

  function frame() {
    take?.frame();
  }

  function stop() {
    if (!take) return Promise.reject(new Error('запись: дубль не идёт'));
    const running = take;
    take = null;
    return running.stop();
  }

  return {
    start,
    frame,
    stop,
    get recording() {
      return take !== null || opening;
    },
  };
}

async function openTake(canvas, fps) {
  const bitrate = bitrateFor(canvas);
  if (canvas.width * canvas.height <= STREAMED_PIXELS) {
    const { canEncodeMp4, startMp4Take } = await import('../render/canvas-mp4.js');
    if (await canEncodeMp4(canvas, bitrate)) return startMp4Take(canvas, { bitrate });
  }
  return startStreamedTake(canvas, fps, bitrate);
}

/** Запасной дубль потоком холста: что запишет браузер, то и получится. */
function startStreamedTake(canvas, fps, bitrate) {
  const mimeType = pickMimeType();
  if (!mimeType) throw new Error('запись: этот браузер не пишет ни webm, ни mp4');
  let stream = canvas.captureStream(fps);
  let [track] = stream.getVideoTracks();
  // Chrome держит requestFrame на дорожке холста, Firefox до сих пор отдаёт его
  // у самого потока; в Safari нет ни того, ни другого, и он получает поток по часам
  let pushFrame = fps === 0
    ? (track.requestFrame?.bind(track) ?? stream.requestFrame?.bind(stream) ?? null)
    : null;
  if (fps === 0 && !pushFrame) {
    track.stop();
    stream = canvas.captureStream(CLOCKED_FPS);
    [track] = stream.getVideoTracks();
  }

  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  recorder.start(FLUSH_MS);
  // Поток с нулевым fps ещё ничего не выдал; отдаём рекордеру первый кадр руками,
  // чтобы файл никогда не открывался с дырой
  if (pushFrame) pushFrame();

  return {
    info: {
      width: canvas.width,
      height: canvas.height,
      mimeType,
      videoBitsPerSecond: bitrate,
    },

    frame() {
      if (pushFrame) pushFrame();
    },

    stop() {
      pushFrame = null;
      return new Promise((resolve, reject) => {
        // stop() успевает выдать последний dataavailable до onstop, поэтому к сборке
        // файла `chunks` уже полон
        recorder.onstop = () => {
          track.stop();
          resolve({ blob: new Blob(chunks, { type: recorder.mimeType }), dropped: 0 });
        };
        recorder.onerror = (event) => {
          track.stop();
          reject(event.error ?? new Error('запись: дубль не записался'));
        };
        recorder.stop();
      });
    },
  };
}
