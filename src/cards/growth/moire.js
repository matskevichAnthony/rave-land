/**
 * Муар: два-три семейства линий с чуть разным шагом и поворотом.
 *
 * Узор, который здесь виден, не нарисован: он интерференция. Сами линии скучные и ровные,
 * а тёмные и светлые волны рождаются из разницы шага в доли процента, поэтому предугадать
 * их можно только просчитав кадр целиком.
 */

import { rgba } from '../ink.js';

const FAMILIES = [2, 3];
const STEP_UNITS = [0.6, 2.2];
// Разбег шага между семействами крошечный намеренно: чем ближе шаги, тем крупнее волны.
const STEP_DRIFT = [0.02, 0.14];
const TILT = [-0.5, 0.5];
// Угол между семействами решает, что получится: почти ноль даёт длинные волны во весь кадр,
// заметный угол даёт сетку ромбов. Слишком малый угол даёт ровные полосы и никакого муара.
const TILT_DRIFT = [0.03, 0.32];
// Толщина линии считается долей шага, а не юнитами макета: волокно тоньше десятой доли шага
// не перекрывается с соседним семейством, и интерференции просто не возникает.
const WIDTH_RATIO = [0.28, 0.62];
const ALPHA = [0.4, 0.85];
const RADIAL_ODDS = 0.35;
const RAYS = [90, 260];

function stripes(ctx, frame, { step, tilt, width, colour }) {
  const reach = Math.hypot(frame.width, frame.height);
  ctx.save();
  ctx.translate(frame.width / 2, frame.height / 2);
  ctx.rotate(tilt);
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let offset = -reach; offset < reach; offset += step) {
    ctx.moveTo(-reach, offset);
    ctx.lineTo(reach, offset);
  }
  ctx.stroke();
  ctx.restore();
}

function rays(ctx, frame, { count, tilt, width, colour, centre }) {
  const reach = Math.hypot(frame.width, frame.height);
  ctx.save();
  ctx.translate(frame.width * centre, frame.height * centre);
  ctx.rotate(tilt);
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let ray = 0; ray < count; ray += 1) {
    const angle = (Math.PI * 2 * ray) / count;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(angle) * reach, Math.sin(angle) * reach);
  }
  ctx.stroke();
  ctx.restore();
}

export default {
  id: 'moire',
  label: 'Муар',
  grow(ctx, frame, random, palette) {
    const families = random.int(FAMILIES[0], FAMILIES[1]);
    const step = frame.unit * random.range(STEP_UNITS[0], STEP_UNITS[1]);
    const tilt = random.range(TILT[0], TILT[1]);
    const width = step * random.range(WIDTH_RATIO[0], WIDTH_RATIO[1]);
    const radial = random() < RADIAL_ODDS;
    const count = random.int(RAYS[0], RAYS[1]);

    for (let family = 0; family < families; family += 1) {
      const drift = 1 + family * random.range(STEP_DRIFT[0], STEP_DRIFT[1]);
      const colour = rgba(palette[family % palette.length], random.range(ALPHA[0], ALPHA[1]));
      const turn = tilt + family * random.range(TILT_DRIFT[0], TILT_DRIFT[1]);
      if (radial) rays(ctx, frame, { count: Math.round(count * drift), tilt: turn, width, colour, centre: 0.5 });
      else stripes(ctx, frame, { step: step * drift, tilt: turn, width, colour });
    }
  },
};
