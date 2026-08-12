/**
 * Картинки к замерам: огибающая и спектр в децибелах.
 *
 * Обе шкалы логарифмические, потому что ухо тоже логарифмическое: в линейных единицах
 * хвост выстрела прижимается к нулю и по картинке не читается вовсе.
 */

const FLOOR_DB = -70;
const SPECTRUM_FLOOR_DB = -90;
const SHOWN_SECONDS = 1.6;
const GRID_DB = 20;
const GRID_SECONDS = 0.4;
const INK = '#7fb7d8';
const GRID = '#3a3a48';
const TEXT = '#6d6d80';
const FONT = '10px system-ui, sans-serif';

function prepare(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = GRID;
  ctx.fillStyle = TEXT;
  ctx.font = FONT;
  ctx.lineWidth = 1;
  return ctx;
}

const level = (db, floor, height) =>
  height - (Math.max(db, floor) - floor) / -floor * height;

export function drawEnvelope(canvas, result) {
  const ctx = prepare(canvas);
  const { width, height } = canvas;
  for (let db = FLOOR_DB + GRID_DB; db < 0; db += GRID_DB) {
    const y = Math.round(level(db, FLOOR_DB, height)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.fillText(`${db}`, 2, y - 2);
  }
  for (let time = GRID_SECONDS; time < SHOWN_SECONDS; time += GRID_SECONDS) {
    const x = Math.round((time / SHOWN_SECONDS) * width) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.fillText(`${time.toFixed(1)}с`, x + 2, height - 3);
  }

  ctx.strokeStyle = INK;
  ctx.beginPath();
  const shown = Math.min(result.peaks.length, Math.round(SHOWN_SECONDS / result.step));
  for (let i = 0; i < shown; i += 1) {
    const db = result.peaks[i] > 0 ? 20 * Math.log10(result.peaks[i]) : FLOOR_DB;
    const x = (i / shown) * width;
    const y = level(db, FLOOR_DB, height);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

export function drawSpectrum(canvas, result) {
  const ctx = prepare(canvas);
  const { width, height } = canvas;
  const step = width / result.spectrum.length;
  for (let db = SPECTRUM_FLOOR_DB + GRID_DB; db < 0; db += GRID_DB) {
    const y = Math.round(level(db, SPECTRUM_FLOOR_DB, height)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.fillText(`${db}`, 2, y - 2);
  }

  ctx.fillStyle = INK;
  result.spectrum.forEach((band, index) => {
    const y = level(band.db, SPECTRUM_FLOOR_DB, height);
    ctx.fillRect(index * step + 1, y, step - 2, height - y);
  });

  ctx.fillStyle = TEXT;
  result.spectrum.forEach((band, index) => {
    if (index % 7) return;
    const kilohertz = `${(band.freq / 1000).toFixed(1)}к`;
    const label = band.freq >= 1000 ? kilohertz : `${Math.round(band.freq)}`;
    ctx.fillText(label, index * step + 1, height - 3);
  });
}
