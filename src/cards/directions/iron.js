/**
 * Направление «Железо»: знак, прожжённый насквозь, и имя, прорезанное в стальной плите.
 *
 * Это тот же язык, которым говорит сама сцена: буквы там не слой поверх кадра, а предмет
 * зала: отлитый в металле заголовок и подвешенные плиты лайнапа с трафаретом. Карточка
 * повторяет его на плоскости, поэтому из направлений именно это стыкуется с кадром из зала.
 *
 * Раскладку решает `look` (верх плиты, кегли, масштаб знака), краски решает `inks`.
 */

import { halo, rgba, verticalFade } from '../ink.js';
import { logoLayer } from '../logo.js';
import { createLayer } from '../layer.js';
import {
  NARROW_FACE, capHeight, fillTracked, gothicFaceFor, justifyLine, measureLine, punchStencil,
} from '../lettering.js';
import { grain, scratches, soot, vignette } from '../wear.js';

const SOOT = { blobs: 70, radius: [0.06, 0.4], alpha: [0.05, 0.22] };
const SCRATCHES = { count: 26, length: [0.04, 0.3], thickness: [0.08, 0.4], alpha: [0.03, 0.12] };

const FIRE_CENTER_RATIO = 0.82;
const FIRE_RADIUS_RATIO = 0.9;
const FIRE_ALPHA = 0.5;

const CROSS_ALPHA = 0.5;

const LOGO_HEIGHT_RATIO = 0.44;
const LOGO_CENTER_RATIO = 0.36;
const LOGO_BLOOM_UNITS = 3;
const LOGO_BLOOM_ALPHA = 0.55;
const LOGO_SHADOW_UNITS = 0.8;

const PLATE_HEIGHT_RATIO = 0.16;
const PLATE_RIM_UNITS = 0.4;
const RIVET_RADIUS_UNITS = 0.55;
const RIVET_INSET_UNITS = 2.2;
const RIVETS = 5;

const NAME_TRACKING = 0.05;
const NAME_HEIGHT_RATIO = 0.46;

const MICRO_PIXELS_UNITS = 1.6;
const MICRO_TRACKING = 0.55;
const MICRO_LEAD_UNITS = 3.4;
const SET_PIXELS_UNITS = 4.4;
const SET_TRACKING = 0.16;
// Подпись под плитой идёт вязью заголовка: это клеймо на железе, а не служебная строка.
const CREDIT_PIXELS_UNITS = 2.8;
const CREDIT_TRACKING = 0.06;

const GRAIN = 0.045;
const VIGNETTE = 0.72;

function paintGround(ctx, frame, random, inks) {
  ctx.fillStyle = inks.iron;
  ctx.fillRect(0, 0, frame.width, frame.height);
  soot(ctx, frame, random, { hex: inks.void, ...SOOT });
  soot(ctx, frame, random, { hex: inks.rust, ...SOOT });
  scratches(ctx, frame, random, { hex: inks.bone, ...SCRATCHES });
  ctx.fillStyle = halo(ctx, {
    x: frame.width / 2,
    y: frame.height * FIRE_CENTER_RATIO,
    radius: frame.width * FIRE_RADIUS_RATIO,
    hex: inks.rust,
    alpha: FIRE_ALPHA,
  });
  ctx.fillRect(0, 0, frame.width, frame.height);
}

/** Знак горит насквозь: жар лежит отдельным слоем и обрезается формой букв. */
function burnLogo(ctx, frame, logo, inks, look) {
  const height = frame.height * LOGO_HEIGHT_RATIO * look.logoScale;
  const mark = logoLayer(logo.wordmark, {
    width: (height * logo.wordmark.width) / logo.wordmark.height,
    color: '#ffffff',
  });
  const x = (frame.width - mark.width) / 2 + frame.width * look.drift;
  const y = frame.height * LOGO_CENTER_RATIO - mark.height / 2;

  const heat = createLayer(mark.width, mark.height);
  heat.ctx.fillStyle = verticalFade(heat.ctx, 0, mark.height, [
    [0, inks.flame, 1],
    [0.45, inks.ember, 1],
    [1, inks.rust, 1],
  ]);
  heat.ctx.fillRect(0, 0, mark.width, mark.height);
  heat.ctx.globalCompositeOperation = 'destination-in';
  heat.ctx.drawImage(mark, 0, 0);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = LOGO_BLOOM_ALPHA;
  ctx.filter = `blur(${frame.unit * LOGO_BLOOM_UNITS}px)`;
  ctx.drawImage(heat.canvas, x, y);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.drawImage(
    logoLayer(logo.wordmark, { width: mark.width, color: inks.void }),
    x + frame.unit * LOGO_SHADOW_UNITS,
    y + frame.unit * LOGO_SHADOW_UNITS,
  );
  ctx.drawImage(heat.canvas, x, y);
  ctx.restore();
}

function namePlacement(ctx, frame, name, look) {
  const top = frame.height * look.plateTop;
  const height = frame.height * PLATE_HEIGHT_RATIO;
  const fit = justifyLine(ctx, name, {
    width: frame.innerWidth,
    maxPixels: height * NAME_HEIGHT_RATIO * look.nameScale,
    tracking: NAME_TRACKING,
    face: NARROW_FACE,
  });
  const cap = capHeight(ctx, name, { pixels: fit.pixels, face: NARROW_FACE });
  return { top, height, fit, baseline: top + height / 2 + cap / 2 };
}

function paintPlate(ctx, frame, name, inks, place) {
  const { top, height, fit, baseline } = place;
  const rim = frame.unit * PLATE_RIM_UNITS;

  // Свет за плитой смещён к низу: прорезь имени стоит в нижней половине, и на прежней
  // раскладке в буквы попадала ржавчина, а не пламя.
  ctx.fillStyle = verticalFade(ctx, top, top + height, [
    [0, inks.ember, 1],
    [0.7, inks.flame, 1],
    [1, inks.ember, 1],
  ]);
  ctx.fillRect(0, top, frame.width, height);

  const plate = createLayer(frame.width, frame.height);
  plate.ctx.fillStyle = verticalFade(plate.ctx, top, top + height, [
    [0, inks.concrete, 1],
    [1, inks.iron, 1],
  ]);
  plate.ctx.fillRect(0, top, frame.width, height);
  plate.ctx.fillStyle = rgba(inks.bone, 0.18);
  plate.ctx.fillRect(0, top, frame.width, rim);
  plate.ctx.fillStyle = rgba(inks.void, 0.6);
  plate.ctx.fillRect(0, top + height - rim, frame.width, rim);

  plate.ctx.fillStyle = rgba(inks.bone, 0.22);
  for (let rivet = 0; rivet < RIVETS; rivet += 1) {
    const x = frame.left + (frame.innerWidth * rivet) / (RIVETS - 1);
    for (const y of [top + frame.unit * RIVET_INSET_UNITS, top + height - frame.unit * RIVET_INSET_UNITS]) {
      plate.ctx.beginPath();
      plate.ctx.arc(x, y, frame.unit * RIVET_RADIUS_UNITS, 0, Math.PI * 2);
      plate.ctx.fill();
    }
  }

  // Спрятанное имя оставляет плиту глухой: свет за прорезью пропадает вместе с прорезью.
  if (name !== null) {
    punchStencil(plate.ctx, name, {
      x: frame.left,
      y: baseline,
      pixels: fit.pixels,
      tracking: fit.tracking,
      face: NARROW_FACE,
      bridge: inks.concrete,
    });
  }
  ctx.drawImage(plate.canvas, 0, 0);
  return top + height;
}

export default {
  id: 'iron',
  label: 'Железо',
  paint({ ctx, frame, random, event, artist, logo, inks, look, textOnly, show }) {
    if (!textOnly) {
      paintGround(ctx, frame, random, inks);

      const crosses = logoLayer(logo.crosses, { width: frame.width, color: inks.ember });
      ctx.save();
      ctx.globalAlpha = CROSS_ALPHA;
      ctx.drawImage(crosses, 0, (frame.height - crosses.height) / 2);
      ctx.restore();

      burnLogo(ctx, frame, logo, inks, look);
    }

    const setPixels = frame.unit * SET_PIXELS_UNITS;
    if (show.meta) {
      const setWidth = measureLine(ctx, artist.set, { pixels: setPixels, tracking: SET_TRACKING, face: NARROW_FACE });
      fillTracked(ctx, artist.set, {
        x: frame.right - setWidth,
        y: frame.top + setPixels,
        pixels: setPixels,
        tracking: SET_TRACKING,
        face: NARROW_FACE,
        color: inks.flame,
      });
      fillTracked(ctx, artist.number, {
        x: frame.left,
        y: frame.top + setPixels,
        pixels: setPixels,
        tracking: SET_TRACKING,
        face: NARROW_FACE,
        color: inks.bone,
      });
    }

    const place = namePlacement(ctx, frame, artist.name, look);
    let plateBottom = place.top + place.height;
    if (textOnly) {
      // В текстовом слое плиты нет: имя ложится краской там же, где стояла прорезь.
      if (show.name) {
        fillTracked(ctx, artist.name, {
          x: frame.left,
          y: place.baseline,
          pixels: place.fit.pixels,
          tracking: place.fit.tracking,
          face: NARROW_FACE,
          color: inks.flame,
        });
      }
    } else {
      plateBottom = paintPlate(ctx, frame, show.name ? artist.name : null, inks, place);
    }

    if (show.credit) {
      fillTracked(ctx, artist.credit, {
        x: frame.left,
        y: plateBottom + frame.unit * MICRO_LEAD_UNITS,
        pixels: frame.unit * CREDIT_PIXELS_UNITS,
        tracking: CREDIT_TRACKING,
        face: gothicFaceFor(artist.credit),
        color: inks.emberHalo,
      });
    }
    if (show.meta) {
      fillTracked(ctx, `${event.dateLabel} · ${event.venue}`, {
        x: frame.left,
        y: frame.bottom,
        pixels: frame.unit * MICRO_PIXELS_UNITS,
        tracking: MICRO_TRACKING,
        face: NARROW_FACE,
        color: inks.bone,
      });
    }

    if (!textOnly) {
      vignette(ctx, frame, { hex: inks.void, amount: VIGNETTE });
      grain(ctx, frame, random, GRAIN);
    }
  },
};
