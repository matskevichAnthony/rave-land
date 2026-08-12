import * as THREE from 'three';
import { createBattleAudio } from '../audio/battle.js';

/**
 * Числовая проверка звука: на слух её не заменишь, а глазами всё видно.
 *
 * Каждый звук отрисовывается в оффлайновый контекст через ту же шину, что и в игре, вместе
 * с лимитером и эхом. Дальше считаются пик, длительность до тишины и уровень на первых
 * миллисекундах: щелчок на старте и обрыв хвоста слышны именно там.
 */

const SAMPLE_RATE = 44100;
const RENDER_SECONDS = 2.5;
const WINDOW_SECONDS = 0.005;
const SILENCE = 10 ** (-60 / 20);
const ONSET_SECONDS = 0.0005;
const SPECTRUM_BANDS = 28;
const SPECTRUM_FROM = 60;
const SPECTRUM_TO = 16000;
const SPECTRUM_WINDOW = 4096;
const LISTENER_AT = [0, 1.6, 0];

const decibels = (value) => (value > 0 ? 20 * Math.log10(value) : -Infinity);

async function render(sound) {
  const ctx = new OfflineAudioContext(2, Math.round(SAMPLE_RATE * RENDER_SECONDS), SAMPLE_RATE);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(...LISTENER_AT);
  camera.updateMatrixWorld(true);
  sound.play(createBattleAudio({ camera, context: ctx }));
  return ctx.startRendering();
}

/** Моно-срез из отрисованного стерео: для замеров важен уровень, а не панорама. */
function toMono(buffer) {
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const mono = new Float32Array(left.length);
  for (let i = 0; i < mono.length; i += 1) mono[i] = (left[i] + right[i]) / 2;
  return mono;
}

function windowPeaks(samples, size) {
  const peaks = new Float32Array(Math.ceil(samples.length / size));
  for (let i = 0; i < samples.length; i += 1) {
    const slot = Math.floor(i / size);
    peaks[slot] = Math.max(peaks[slot], Math.abs(samples[i]));
  }
  return peaks;
}

/** Один шаг Гёрцеля: дешевле полного БПФ, а для двух десятков полос этого хватает. */
function bandLevel(samples, from, freq, rate) {
  const step = 2 * Math.cos((2 * Math.PI * freq) / rate);
  let previous = 0;
  let current = 0;
  for (let i = 0; i < SPECTRUM_WINDOW && from + i < samples.length; i += 1) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SPECTRUM_WINDOW);
    const next = samples[from + i] * hann + step * current - previous;
    previous = current;
    current = next;
  }
  const power = current * current + previous * previous - step * current * previous;
  return Math.sqrt(Math.max(power, 0)) / (SPECTRUM_WINDOW / 4);
}

function spectrum(samples, from) {
  const ratio = (SPECTRUM_TO / SPECTRUM_FROM) ** (1 / (SPECTRUM_BANDS - 1));
  return Array.from({ length: SPECTRUM_BANDS }, (unused, index) => {
    const freq = SPECTRUM_FROM * ratio ** index;
    return { freq, db: decibels(bandLevel(samples, from, freq, SAMPLE_RATE)) };
  });
}

function analyse(buffer) {
  const mono = toMono(buffer);
  const size = Math.round(SAMPLE_RATE * WINDOW_SECONDS);
  const peaks = windowPeaks(mono, size);
  let peak = 0;
  let peakAt = 0;
  let sumOfSquares = 0;
  for (let i = 0; i < mono.length; i += 1) {
    sumOfSquares += mono[i] * mono[i];
    if (Math.abs(mono[i]) <= peak) continue;
    peak = Math.abs(mono[i]);
    peakAt = i;
  }
  let last = 0;
  for (let i = 0; i < peaks.length; i += 1) if (peaks[i] > SILENCE) last = i;
  const head = mono.subarray(0, Math.round(SAMPLE_RATE * ONSET_SECONDS));
  const onset = windowPeaks(head, size)[0] ?? 0;

  return {
    peakDb: decibels(peak),
    rmsDb: decibels(Math.sqrt(sumOfSquares / mono.length)),
    duration: (last + 1) * WINDOW_SECONDS,
    // Уровень на первой полумиллисекунде: щелчок на старте выдаёт себя именно здесь.
    onsetDb: decibels(onset),
    // Последнее окно перед тишиной: если оно громкое, хвост не затух, а оборвался.
    tailDb: decibels(peaks[last] ?? 0),
    peaks,
    step: WINDOW_SECONDS,
    spectrum: spectrum(mono, peakAt),
  };
}

export async function measure(sound) {
  return { ...analyse(await render(sound)), id: sound.id, title: sound.title };
}
