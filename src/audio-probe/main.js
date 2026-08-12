import * as THREE from 'three';
import { createBattleAudio } from '../audio/battle.js';
import { SOUNDS, SOURCE_AT } from './sounds.js';
import { measure } from './measure.js';
import { drawEnvelope, drawSpectrum } from './plot.js';

/**
 * Стенд боевого звука: слева слушать, справа мерить.
 *
 * Кнопки и замер идут по одной описи звуков, поэтому новый звук появляется в обоих
 * списках сам. Замер запускается и ссылкой `?measure=1`, так его снимает headless.
 */

const ENVELOPE_SIZE = { width: 430, height: 120 };
const SPECTRUM_SIZE = { width: 300, height: 120 };
const DONE_MARK = 'done';

const buttonsRoot = document.querySelector('[data-js-buttons]');
const plotsRoot = document.querySelector('[data-js-plots]');
const report = document.querySelector('[data-js-report]');

const camera = new THREE.PerspectiveCamera();
camera.position.set(SOURCE_AT.x, SOURCE_AT.y, SOURCE_AT.z + 3);
camera.updateMatrixWorld(true);
const audio = createBattleAudio({ camera });

buttonsRoot.replaceChildren(...SOUNDS.map((sound) => {
  const button = document.createElement('button');
  button.className = 'probe__button';
  button.textContent = sound.title;
  button.addEventListener('click', () => sound.play(audio));
  return button;
}));

document.querySelector('[data-js-measure]').addEventListener('click', runMeasurement);
if (new URLSearchParams(location.search).has('measure')) runMeasurement();

function canvasFor(size) {
  const canvas = document.createElement('canvas');
  canvas.className = 'probe__canvas';
  canvas.width = size.width;
  canvas.height = size.height;
  return canvas;
}

function plotCard(result) {
  const card = document.createElement('figure');
  card.className = 'probe__plot';
  const caption = document.createElement('figcaption');
  caption.textContent = result.title;
  const envelope = canvasFor(ENVELOPE_SIZE);
  const spectrum = canvasFor(SPECTRUM_SIZE);
  drawEnvelope(envelope, result);
  drawSpectrum(spectrum, result);
  card.append(caption, envelope, spectrum);
  return card;
}

const decibels = (value) => (Number.isFinite(value) ? value.toFixed(1) : '-inf');

function line(result) {
  return `${result.title.padEnd(26)} длительность ${result.duration.toFixed(3)} c`
    + ` | пик ${decibels(result.peakDb)} dBFS`
    + ` | RMS ${decibels(result.rmsDb)}`
    + ` | старт ${decibels(result.onsetDb)}`
    + ` | хвост ${decibels(result.tailDb)}`;
}

async function runMeasurement() {
  report.textContent = 'Считаю...';
  plotsRoot.replaceChildren();
  const lines = [];
  for (const sound of SOUNDS) {
    const result = await measure(sound);
    lines.push(line(result));
    plotsRoot.append(plotCard(result));
  }
  report.textContent = lines.join('\n');
  // Метка для headless: пока её нет, замер ещё считается.
  document.body.dataset.jsMeasured = DONE_MARK;
}
