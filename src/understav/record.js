// Холст в видеофайл. При fps 0 поток ведут вручную: `captureStream(0)` плюс
// `requestFrame` на каждый отрисованный кадр, поэтому цикл, который тратит на кадр
// непредсказуемую долю процессора, всё равно даёт ровное видео: рекордер получает
// кадр ровно тогда, когда кадр готов, а не когда так решил таймер по часам.

// H.264 в mp4 идёт первым, чтобы файл открывался везде (Фото на iOS, QuickTime,
// Windows, Telegram); свежие Chrome и Edge и все Safari его пишут. Несколько
// написаний avc1/h264 расширяют совпадение. webm остаётся последним запасным
// вариантом для браузеров, которые mp4 писать до сих пор не умеют.
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/mp4;codecs=h264',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];
// Без интервала Chrome копит весь дубль одним куском, и длинная запись умирает
// вместе с ним; периодический сброс держит потерю маленькой
const FLUSH_MS = 250;

// В Safari у дорожек холста нет requestFrame; поток по часам это ближайшее,
// что там есть к ручной подаче кадров
const CLOCKED_FPS = 30;

const pickMimeType = () => MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));

export const videoExtension = (blob) => (blob.type.includes('mp4') ? 'mp4' : 'webm');

export function createCanvasRecorder(canvas) {
  let recorder = null;
  let track = null;
  let chunks = [];
  let pushFrame = null;

  function start({ fps = 0 } = {}) {
    if (recorder) throw new Error('запись: дубль уже идёт');
    const mimeType = pickMimeType();
    if (!mimeType) throw new Error('запись: этот браузер не пишет ни webm, ни mp4');
    let stream = canvas.captureStream(fps);
    [track] = stream.getVideoTracks();
    // Chrome держит requestFrame на дорожке холста, Firefox до сих пор отдаёт его
    // у самого потока; в Safari нет ни того, ни другого, и он получает поток по часам
    pushFrame = fps === 0
      ? (track.requestFrame?.bind(track) ?? stream.requestFrame?.bind(stream) ?? null)
      : null;
    if (fps === 0 && !pushFrame) {
      track.stop();
      stream = canvas.captureStream(CLOCKED_FPS);
      [track] = stream.getVideoTracks();
    }
    chunks = [];
    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.start(FLUSH_MS);
    // Поток с нулевым fps ещё ничего не выдал; отдаём рекордеру первый кадр руками,
    // чтобы файл никогда не открывался с дырой
    if (pushFrame) pushFrame();
  }

  function frame() {
    if (recorder && pushFrame) pushFrame();
  }

  function stop() {
    if (!recorder) return Promise.reject(new Error('запись: дубль не идёт'));
    const stopped = recorder;
    const stoppedTrack = track;
    const taken = chunks;
    recorder = null;
    track = null;
    pushFrame = null;
    return new Promise((resolve, reject) => {
      // stop() успевает выдать последний dataavailable до onstop, поэтому к сборке
      // файла `taken` уже полон
      stopped.onstop = () => {
        stoppedTrack.stop();
        resolve(new Blob(taken, { type: stopped.mimeType }));
      };
      stopped.onerror = (event) => {
        stoppedTrack.stop();
        reject(event.error ?? new Error('запись: дубль не записался'));
      };
      stopped.stop();
    });
  }

  return {
    start,
    frame,
    stop,
    get recording() {
      return recorder !== null;
    },
  };
}
