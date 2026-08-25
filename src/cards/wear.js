/**
 * Износ карточки: копоть, царапины, зерно, виньетка и разъезд каналов.
 *
 * Всё это уже есть у сцены — в цветокоррекции `render/grade.js` и в датамоше
 * `understav/effects.js`, — но там оно живёт шейдером на кадре WebGL. Карточка рисуется на
 * плоском холсте, поэтому те же приёмы повторены арифметикой по пикселям. Числа взяты из
 * тех же мест: зерно сильнее в тенях, виньетка собирает кадр к середине.
 */

import { between } from '../procedural/random.js';
import { halo, rgba } from './ink.js';
import { createLayer } from './layer.js';

const CHANNEL_MAX = 255;
const PIXEL_STRIDE = 4;
const LUMA = [0.2126, 0.7152, 0.0722];
// Из `grade.js`: зерно на свету почти не видно, а в тенях держит всю фактуру.
const GRAIN_SHADOW_BIAS = 0.45;
const GRAIN_FLOOR = 0.55;

const VIGNETTE_INNER = 0.32;
const VIGNETTE_OUTER = 0.85;

export function soot(ctx, frame, random, { hex, blobs, radius, alpha }) {
  for (let index = 0; index < blobs; index += 1) {
    const spot = {
      x: between(random, 0, frame.width),
      y: between(random, 0, frame.height),
      radius: between(random, radius[0], radius[1]) * frame.width,
      hex,
      alpha: between(random, alpha[0], alpha[1]),
    };
    ctx.fillStyle = halo(ctx, spot);
    ctx.fillRect(spot.x - spot.radius, spot.y - spot.radius, spot.radius * 2, spot.radius * 2);
  }
}

export function scratches(ctx, frame, random, { hex, count, length, thickness, alpha }) {
  ctx.lineCap = 'round';
  for (let index = 0; index < count; index += 1) {
    const x = between(random, 0, frame.width);
    const y = between(random, 0, frame.height);
    const span = between(random, length[0], length[1]) * frame.height;
    const tilt = between(random, -Math.PI, Math.PI);
    ctx.strokeStyle = rgba(hex, between(random, alpha[0], alpha[1]));
    ctx.lineWidth = between(random, thickness[0], thickness[1]) * frame.unit;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(tilt) * span, y + Math.sin(tilt) * span);
    ctx.stroke();
  }
}

export function vignette(ctx, frame, { hex, amount }) {
  const reach = Math.hypot(frame.width, frame.height) / 2;
  const spot = ctx.createRadialGradient(
    frame.width / 2, frame.height / 2, reach * VIGNETTE_INNER,
    frame.width / 2, frame.height / 2, reach * VIGNETTE_OUTER,
  );
  spot.addColorStop(0, rgba(hex, 0));
  spot.addColorStop(1, rgba(hex, amount));
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, frame.width, frame.height);
}

export function grain(ctx, frame, random, amount) {
  const image = ctx.getImageData(0, 0, frame.width, frame.height);
  const { data } = image;
  for (let at = 0; at < data.length; at += PIXEL_STRIDE) {
    const luma = (data[at] * LUMA[0] + data[at + 1] * LUMA[1] + data[at + 2] * LUMA[2]) / CHANNEL_MAX;
    const kick = (random() * 2 - 1) * amount * CHANNEL_MAX
      * (GRAIN_FLOOR + GRAIN_SHADOW_BIAS * (1 - luma));
    data[at] += kick;
    data[at + 1] += kick;
    data[at + 2] += kick;
  }
  ctx.putImageData(image, 0, 0);
}

function channelLayer(source, color) {
  const layer = createLayer(source.width, source.height);
  layer.ctx.drawImage(source, 0, 0);
  layer.ctx.globalCompositeOperation = 'multiply';
  layer.ctx.fillStyle = color;
  layer.ctx.fillRect(0, 0, source.width, source.height);
  return layer.canvas;
}

/**
 * Разъезд красного и синего поверх готовой карточки.
 *
 * Кадр разбирается на каналы и собирается заново со сдвигом, как в датамоше сцены. Сложением
 * поверх оригинала это не делается: красный и синий тогда только прибавляются, зелёный стоит
 * на месте, и вся карточка уезжает в розовый неон, которого в палитре зала нет.
 *
 * Каналы кладутся с запасом по краю: без него сдвиг оставил бы по бокам чёрные полосы в свою
 * ширину, а карточка уходит текстурой на стену коридора, где такая полоса читается щелью.
 */
export function chromatic(ctx, frame, { offset, strength }) {
  const source = createLayer(frame.width, frame.height);
  source.ctx.drawImage(ctx.canvas, 0, 0);

  const grow = 1 + (2 * offset) / frame.width;
  const width = frame.width * grow;
  const height = frame.height * grow;
  const left = (frame.width - width) / 2;
  const top = (frame.height - height) / 2;

  const split = createLayer(frame.width, frame.height);
  split.ctx.fillStyle = '#000000';
  split.ctx.fillRect(0, 0, frame.width, frame.height);
  split.ctx.globalCompositeOperation = 'lighter';
  for (const [color, shift] of [['#ff0000', offset], ['#00ff00', 0], ['#0000ff', -offset]]) {
    split.ctx.drawImage(channelLayer(source.canvas, color), left + shift, top, width, height);
  }

  ctx.save();
  ctx.globalAlpha = strength;
  ctx.drawImage(split.canvas, 0, 0);
  ctx.restore();
}
