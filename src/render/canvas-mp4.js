import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  canEncodeVideo,
} from 'mediabunny';

/**
 * Холст прямо в mp4: кадры кодирует H.264 из WebCodecs, файл собирает mp4-мультиплексор.
 *
 * `MediaRecorder` пишет то, что решит браузер, и просить его о качестве нечем: битрейт он
 * принимает как пожелание, режим держит реального времени и на тяжёлом кадре сам роняет
 * кадры. Здесь кодировщик свой: постоянное качество вместо битрейта, ключевой кадр по
 * расписанию, и mp4 получается сразу, а не webm, который потом некому пережать.
 *
 * Кадры подаются теми же вызовами, что и раньше: снимок холста делается синхронно в момент
 * вызова, поэтому картинка в файле та, что была на экране, а не следующая.
 */

const MIME = 'video/mp4';
const CODEC = 'avc';

// Квантизатор это постоянное качество, как crf у x264: тихий кадр стоит дёшево, а кадр с
// зерном, дымом и датамошем получает столько бит, сколько ему нужно. Двадцать это «глазом
// не отличить» для тёмной сцены; битрейт остаётся запасным, если квантизатор не дадут.
const QUANTIZER = 20;
const KEY_FRAME_SECONDS = 2;

/**
 * Сколько кадров держать в полёте: очередь меряется пикселями, а не кадрами.
 *
 * Кодировщик отстаёт на тяжёлых кадрах, и каждый кадр в очереди это целый холст в памяти:
 * на 4K это тридцать три мегабайта на копию, и восемь копий дают четверть гигабайта сверх
 * мишеней постобработки, которые на 4K и сами уже под гигабайт. Хуже того, всё, что осталось
 * в очереди к концу дубля, дожимается уже после него: файл в этот момент ещё не готов, а
 * запись на экране кончилась, и ожидание выглядит зависанием.
 *
 * Поэтому потолок считается от площади кадра: на 1080p в очереди по-прежнему восемь кадров,
 * на 4K два. Лучше уронить кадр (соседний просто станет длиннее), чем дубль целиком.
 */
const PENDING_PIXELS = 16_000_000;
const PENDING_FRAMES = { least: 2, most: 8 };

const pendingLimitFor = (canvas) => Math.min(
  PENDING_FRAMES.most,
  Math.max(PENDING_FRAMES.least, Math.round(PENDING_PIXELS / (canvas.width * canvas.height))),
);

const qualityFor = (bitrate) => new Quality({ quantizer: QUANTIZER, bitrate });

/** Умеет ли браузер закодировать этот холст в H.264: без него остаётся путь `MediaRecorder`. */
export function canEncodeMp4(canvas, bitrate) {
  if (typeof VideoEncoder !== 'function') return Promise.resolve(false);
  return canEncodeVideo(CODEC, {
    width: canvas.width,
    height: canvas.height,
    quality: qualityFor(bitrate),
  });
}

export async function startMp4Take(canvas, { bitrate }) {
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const source = new CanvasSource(canvas, {
    codec: CODEC,
    quality: qualityFor(bitrate),
    keyFrameInterval: KEY_FRAME_SECONDS,
    latencyMode: 'quality',
  });
  output.addVideoTrack(source);
  await output.start();

  const startedAt = performance.now();
  const pendingLimit = pendingLimitFor(canvas);
  let pending = 0;
  let dropped = 0;
  let failure = null;

  return {
    info: {
      width: canvas.width,
      height: canvas.height,
      mimeType: MIME,
      videoBitsPerSecond: bitrate,
    },

    frame() {
      if (failure || pending >= pendingLimit) {
        dropped += 1;
        return;
      }
      pending += 1;
      // Метка времени настоящая, а не по счётчику кадров: просевший кадр обязан оказаться
      // в файле длиннее, иначе дубль поедет мимо своей секунды.
      source.add((performance.now() - startedAt) / 1000)
        .catch((error) => {
          failure = error;
        })
        .finally(() => {
          pending -= 1;
        });
    },

    async stop() {
      await output.finalize();
      if (failure) throw failure;
      return { blob: new Blob([output.target.buffer], { type: MIME }), dropped };
    },
  };
}
