import * as THREE from 'three';

/**
 * Звуковая шина боя: контекст, разблокировка по жесту, мастер-цепь и голоса в мире.
 *
 * Синтез сюда не заглядывает, он только пишет в вход голоса. Голос это точка в мире плюс
 * отправка в общее эхо; кто его завёл, тот сообщает время конца хвоста, и ветка снимает
 * себя с шины сама.
 */

const MASTER_LEVEL = 1.3;
// Лимитер держит пик стрельбы ниже нуля: одиночный выстрел громкий, а очередь из трёх
// стволов складывается и без него уходит в клиппинг.
const LIMITER = { threshold: -6, knee: 0, ratio: 20, attack: 0.001, release: 0.15 };
const ECHO_SECONDS = 0.7;
const ECHO_PREDELAY = 0.05;
const ECHO_DECAY = 10;
const ECHO_DAMPING = 0.25;
const ECHO_SLAPS = [{ at: 0.11, level: 0.5 }, { at: 0.19, level: 0.3 }];
const ECHO_SLAP_SPREAD = 0.013;
const REF_DISTANCE = 8;
const ROLLOFF = 0.9;
const MAX_DISTANCE = 250;
const TEARDOWN_SLACK = 0.05;
const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchstart'];

/**
 * Импульсный отклик открытого поля: короткое дыхание с парой отражений.
 *
 * В поле звуку не от чего копиться, поэтому вместо гулкого хвоста комнаты тут почти сухая
 * экспонента, а характер даёт пара отдельных отражений от земли и дальней стены. Высокие в
 * отражениях гаснут первыми, за это отвечает однополюсный фильтр прямо в шуме.
 */
function fieldImpulse(ctx) {
  const { sampleRate } = ctx;
  const length = Math.round(sampleRate * ECHO_SECONDS);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    const predelay = Math.round(sampleRate * ECHO_PREDELAY);
    let low = 0;
    for (let i = predelay; i < length; i += 1) {
      const time = (i - predelay) / sampleRate;
      low += (Math.random() * 2 - 1 - low) * ECHO_DAMPING;
      data[i] = low * Math.exp(-time * ECHO_DECAY);
    }
    // Отражения разведены по каналам на единицы миллисекунд: так эхо звучит шире выстрела.
    const shift = channel === 0 ? 0 : ECHO_SLAP_SPREAD;
    for (const slap of ECHO_SLAPS) {
      data[Math.round((slap.at + shift) * sampleRate)] += slap.level;
    }
  }
  return buffer;
}

/** Браузер молчит до первого жеста; в игре это тот же клик, что запирает мышь. */
function unlockOnGesture(ctx) {
  const detach = () => UNLOCK_EVENTS.forEach((type) => window.removeEventListener(type, resume));
  function resume() {
    ctx.resume().then(
      () => { if (ctx.state === 'running') detach(); },
      // Отказ не ошибка приложения: жест не засчитан, звук включит следующий клик.
      () => {},
    );
  }
  UNLOCK_EVENTS.forEach((type) => window.addEventListener(type, resume));
}

export function createAudioBus({ camera, context = null }) {
  const ctx = context ?? new AudioContext();
  const master = ctx.createGain();
  master.gain.value = MASTER_LEVEL;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = LIMITER.threshold;
  limiter.knee.value = LIMITER.knee;
  limiter.ratio.value = LIMITER.ratio;
  limiter.attack.value = LIMITER.attack;
  limiter.release.value = LIMITER.release;
  master.connect(limiter).connect(ctx.destination);

  const echo = ctx.createConvolver();
  echo.buffer = fieldImpulse(ctx);
  echo.connect(master);

  // Свой контекст пришёл с замеров, он ждёт не жеста, а startRendering.
  const gated = !context;
  if (gated) unlockOnGesture(ctx);

  const at = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const up = new THREE.Vector3();
  const spin = new THREE.Quaternion();

  /**
   * Слушатель едет за камерой.
   *
   * Обновляется в момент запуска звука, а не каждый кадр: панорама важна на атаке, а за
   * время хвоста камера всё равно не успевает уехать настолько, чтобы это было слышно.
   */
  function syncListener() {
    camera.getWorldPosition(at);
    camera.getWorldDirection(forward);
    up.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(spin));
    const { listener } = ctx;
    listener.positionX.value = at.x;
    listener.positionY.value = at.y;
    listener.positionZ.value = at.z;
    listener.forwardX.value = forward.x;
    listener.forwardY.value = forward.y;
    listener.forwardZ.value = forward.z;
    listener.upX.value = up.x;
    listener.upY.value = up.y;
    listener.upZ.value = up.z;
  }

  function voice(position, send) {
    const input = ctx.createGain();
    const panner = ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = REF_DISTANCE;
    panner.rolloffFactor = ROLLOFF;
    panner.maxDistance = MAX_DISTANCE;
    panner.positionX.value = position.x;
    panner.positionY.value = position.y;
    panner.positionZ.value = position.z;
    const echoSend = ctx.createGain();
    echoSend.gain.value = send;
    input.connect(panner);
    panner.connect(master);
    panner.connect(echoSend).connect(echo);
    syncListener();

    return {
      input,
      /** Голос снимает себя с шины сам: сторож живёт ровно до конца хвоста. */
      release(end) {
        const guard = ctx.createConstantSource();
        guard.offset.value = 0;
        guard.connect(input);
        guard.start(ctx.currentTime);
        guard.stop(end + TEARDOWN_SLACK);
        guard.onended = () => {
          guard.disconnect();
          input.disconnect();
          panner.disconnect();
          echoSend.disconnect();
        };
      },
    };
  }

  return {
    ctx,
    voice,
    now: () => ctx.currentTime,
    // Пока контекст спит, играть нельзя: всё запланированное хлопнет разом на resume.
    ready: () => !gated || ctx.state === 'running',
  };
}
