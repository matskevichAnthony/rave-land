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

// Захват просим шире экрана лишь по частоте кадров: разрешение решает сам источник, и
// требование точного размера в некоторых браузерах роняет выбор вкладки целиком.
const DISPLAY_WISH = { video: { frameRate: 60 }, audio: true };
const CAMERA_WISH = { video: { width: 1280, height: 720 }, audio: false };

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
    display: () => navigator.mediaDevices.getDisplayMedia(DISPLAY_WISH).then((s) => play(s, 'display')),
    camera: () => navigator.mediaDevices.getUserMedia(CAMERA_WISH).then((s) => play(s, 'camera')),
    file: (blob) => play(URL.createObjectURL(blob), 'file'),
    url: (address) => play(address, 'url'),
    stop: drop,
  };
}
