/**
 * Источник живого кадра: захват вкладки или экрана, камера, файл с диска, прямая ссылка.
 *
 * Ютуб видеотекстурой не берётся, и обойти это нечем: кадры чужой вкладки браузер не отдаёт
 * ни тегу `video`, ни холсту, а `youtube.com/watch` вообще не видеофайл. Поэтому ютуб
 * приходит сюда захватом: `getDisplayMedia` спрашивает, чем поделиться, вкладка отдаёт и
 * картинку, и собственный звук, и дальше это обычный поток, к которому применимо всё
 * остальное. Тот же путь годится для плеера, «Кинопоиска», зума и чего угодно на экране.
 *
 * Элемент `video` здесь один на все источники: он живёт вне документа и служит кадром для
 * холста, а не картинкой для зрителя. Звук с него не звучит: его забирает слух.
 */

export const SOURCES = [
  { id: 'display', label: 'Вкладка' },
  { id: 'camera', label: 'Камера' },
  { id: 'file', label: 'Файл' },
  { id: 'url', label: 'Ссылка' },
];

// Разрешение у захвата просить обязательно. Без просьбы браузер отдаёт вкладку в её
// экранных пикселях и ужимает поток, как только решит, что так дешевле, а на проекторе это
// видно сразу: кадр приходит мыльным ещё до того, как его коснулся инструмент. Просьба
// пожеланием, а не требованием: точный размер в некоторых браузерах роняет выбор вкладки
// целиком, а `ideal` в худшем случае просто не исполняется.
//
// `resizeMode: 'none'` здесь важнее размера. С пересчётом браузер сам масштабирует поток до
// удобного ему числа, и это первое размытие, поверх которого холст кладёт второе.
const DISPLAY_WISH = {
  video: {
    frameRate: { ideal: 60 },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    resizeMode: 'none',
  },
  audio: true,
};

const CAMERA_WISH = {
  video: {
    frameRate: { ideal: 60 },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    resizeMode: 'none',
  },
  audio: false,
};

/**
 * Дожать дорожку после выбора источника.
 *
 * Часть браузеров пожелания к самому захвату игнорирует, а те же пожелания, поданные вторым
 * заходом уже на дорожке, исполняет. Отказ здесь не ошибка и наверх не идёт: он означает
 * ровно то, что источник больше не даёт, и захват в том качестве, какое есть, полезнее
 * оборванного захвата с сообщением об ошибке.
 */
async function sharpen(stream, wish) {
  const [track] = stream.getVideoTracks();
  await track?.applyConstraints(wish.video).catch(() => {});
}

function createElement() {
  const video = document.createElement('video');
  video.playsInline = true;
  video.loop = true;
  video.crossOrigin = 'anonymous';
  return video;
}

export function createSource() {
  const video = createElement();
  let stream = null;
  let kind = null;

  function drop() {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    if (video.src.startsWith('blob:')) URL.revokeObjectURL(video.src);
    video.removeAttribute('src');
    video.srcObject = null;
  }

  async function play(next, id) {
    drop();
    kind = id;
    if (next instanceof MediaStream) {
      stream = next;
      video.srcObject = next;
      // Поток из захвата или камеры звучать в зале не должен: слух берёт его отдельно.
      video.muted = true;
    } else {
      video.src = next;
      // Файл и ссылка отдают звук в граф слуха, поэтому глушить элемент нельзя: глухой
      // элемент отдаёт графу тишину, и порог никогда не сработает.
      video.muted = false;
    }
    await video.play();
    return { kind, stream, hasAudio: (stream?.getAudioTracks().length ?? 0) > 0 };
  }

  return {
    video,
    get kind() {
      return kind;
    },
    get stream() {
      return stream;
    },
    get ready() {
      return video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    },
    display: async () => {
      const captured = await navigator.mediaDevices.getDisplayMedia(DISPLAY_WISH);
      await sharpen(captured, DISPLAY_WISH);
      return play(captured, 'display');
    },
    camera: async () => {
      const captured = await navigator.mediaDevices.getUserMedia(CAMERA_WISH);
      await sharpen(captured, CAMERA_WISH);
      return play(captured, 'camera');
    },
    file: (blob) => play(URL.createObjectURL(blob), 'file'),
    url: (address) => play(address, 'url'),
    stop: drop,
  };
}
