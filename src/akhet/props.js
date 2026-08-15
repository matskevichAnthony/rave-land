/**
 * Библиотека пропсов Древнего Египта для сцены AKHET.
 *
 * Узнаваемость держится на силуэте, а не на росписи: пирамидион на игле, батер пилона,
 * немес на плечах, вытянутое тело сфинкса. Поэтому здесь нет ни иероглифов обоями, ни
 * золота, зато у каждого камня есть уступы, фаски, сколотые углы и своя сохранность.
 *
 * Высота всегда приходит снаружи в метрах, пропорции считаются от неё. Одна и та же
 * вещь на разных сидах отличается сохранностью, числом рядов кладки, тем, что у неё
 * отбито и насколько её занесло песком, но остаётся собой.
 *
 * Весь набор живёт на одном материале: цвет камня уходит в вершины, поэтому песок у
 * подножия и известняк стены различаются, а `InstancedMesh` остаётся одним вызовом.
 *
 * `height` это полная высота пропса стоя, кроме плиты, где это её сторона в плане.
 * Разрушенное сидом ниже целого намеренно: обломанный обелиск, срезанная пирамида и
 * занесённый колосс не дотягивают до заказанной высоты, и это не промах, а разрушение.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from './palette.js';
import { between } from '../procedural/random.js';
import { createSurfaceGrunge } from '../procedural/grunge.js';
import { drum, hewnBlock, paint, projectUv, pyramidBlock, roundCap } from './masonry.js';

const TAU = Math.PI * 2;
const QUARTER_TURN = Math.PI / 2;
const HALF = 0.5;

/** Камень светлый весь: солнце в зените, и тёмный гранит съел бы полдень. */
const TONE = {
  fresh: PALETTE.limestone,
  worn: PALETTE.limestoneWorn,
  sand: PALETTE.sand,
  buried: PALETTE.sandDeep,
};

/** Зерно поверхности меряется метрами, а не долями грани. */
const GRAIN_TILE = 1.4;
const GRAIN = { size: 256, spots: 90, streaks: 30, bump: 0.05, roughness: 0.95 };

const HEADS = ['jackal', 'falcon', 'lioness', 'ram', 'human'];

const count = (rng, min, max) => Math.round(between(rng, min, max));
const pick = (rng, items) => items[Math.floor(rng() * items.length)];
const courseTone = (rng) => (rng() < HALF ? TONE.fresh : TONE.worn);

function settle(geometry) {
  geometry.computeBoundingBox();
  geometry.translate(0, -geometry.boundingBox.min.y, 0);
  return geometry;
}

/**
 * Подгонка набора кусков под заказанную высоту.
 *
 * Нужна там, где верхнюю точку задаёт не корпус, а то, что сид на него надел: корона,
 * ухо шакала, бортик стола. Разрушенные вещи через неё не проходят: обломанный обелиск
 * обязан быть ниже целого, а не такой же высоты и толще.
 */
function fitHeight(parts, height) {
  let top = 0;
  for (const part of parts) {
    part.computeBoundingBox();
    top = Math.max(top, part.boundingBox.max.y);
  }
  const factor = height / top;
  for (const part of parts) part.scale(factor, factor, factor);
  return parts;
}

/** Песчаный намёт кольцом: он и прячет стык с землёй, и говорит, что вещь стоит давно. */
function sandDrift({ rng, span, height, lumps }) {
  const parts = [];
  for (let index = 0; index < lumps; index += 1) {
    const angle = (index / lumps) * TAU + between(rng, -0.5, 0.5);
    const reach = span * between(rng, 0.45, 0.95);
    const lump = hewnBlock({
      width: span * between(rng, 0.7, 1.2),
      depth: span * between(rng, 0.5, 0.9),
      height: height * between(rng, 0.5, 1),
      topWidth: span * between(rng, 0.2, 0.5),
      topDepth: span * between(rng, 0.15, 0.4),
      lean: span * between(rng, -0.2, 0.2),
      jitter: height * 0.2,
      crown: height * 0.25,
      rng,
    }).rotateY(angle);
    lump.translate(Math.cos(angle) * reach, 0, Math.sin(angle) * reach);
    parts.push(paint(lump, index % 2 === 0 ? TONE.sand : TONE.buried));
  }
  return parts;
}

/** Обломки: то, что откололось, лежит рядом, иначе скол выглядит вымытым. */
function stoneChunks({ rng, span, size, amount, tone = TONE.worn }) {
  const parts = [];
  for (let index = 0; index < amount; index += 1) {
    const angle = rng() * TAU;
    const reach = span * between(rng, 0.35, 1);
    const edge = size * between(rng, 0.5, 1.3);
    const chunk = rng() < 0.25
      ? pyramidBlock({
        width: edge,
        depth: edge * between(rng, 0.6, 1.2),
        height: edge * between(rng, 0.5, 1.1),
        apexX: edge * between(rng, -0.4, 0.4),
        apexZ: edge * between(rng, -0.4, 0.4),
        jitter: edge * 0.12,
        rng,
      })
      : hewnBlock({
        width: edge,
        depth: edge * between(rng, 0.5, 1.2),
        height: edge * between(rng, 0.35, 0.9),
        topWidth: edge * between(rng, 0.4, 0.9),
        topDepth: edge * between(rng, 0.4, 0.9),
        lean: edge * between(rng, -0.25, 0.25),
        jitter: edge * 0.14,
        crown: edge * 0.2,
        rng,
      });
    chunk.rotateY(rng() * TAU).rotateZ(between(rng, -0.3, 0.3));
    settle(chunk).translate(Math.cos(angle) * reach, 0, Math.sin(angle) * reach);
    parts.push(paint(chunk, tone));
  }
  return parts;
}

/**
 * Голова бога: череп, немес и звериная морда.
 *
 * Немес важнее самой головы: две пряди по плечам и лопасть на затылке читаются с той
 * дистанции, на которой морда уже слилась в пятно.
 */
function headParts({ rng, unit, baseY, kind, damage }) {
  const parts = [];
  const add = (geometry, tone = TONE.fresh) => parts.push(paint(geometry, tone));
  const skull = unit * 0.1;
  const chip = unit * 0.005 + damage * unit * 0.018;

  add(hewnBlock({
    width: skull,
    depth: skull * 1.2,
    height: skull,
    topWidth: skull * 0.9,
    topDepth: skull * 1.05,
    jitter: chip,
    rng,
  }).translate(0, baseY, 0), damage > HALF ? TONE.worn : TONE.fresh);

  for (const side of [-1, 1]) {
    add(hewnBlock({
      width: unit * 0.044,
      depth: unit * 0.082,
      height: unit * 0.15,
      topWidth: unit * 0.028,
      topDepth: unit * 0.062,
      jitter: chip,
      crown: damage * unit * 0.02,
      rng,
    }).translate(side * unit * 0.066, baseY - unit * 0.052, unit * 0.015));
  }

  add(hewnBlock({
    width: unit * 0.118,
    depth: unit * 0.05,
    height: unit * 0.11,
    topWidth: unit * 0.088,
    jitter: chip,
    rng,
  }).translate(0, baseY - unit * 0.03, -unit * 0.066));

  const browY = baseY + skull * 0.45;
  if (kind === 'jackal') {
    add(hewnBlock({
      width: unit * 0.045,
      depth: unit * 0.13,
      height: unit * 0.045,
      topWidth: unit * 0.032,
      topDepth: unit * 0.11,
      leanZ: unit * 0.01,
      jitter: chip,
      rng,
    }).translate(0, baseY + unit * 0.02, unit * 0.11));
    for (const side of [-1, 1]) {
      add(hewnBlock({
        width: unit * 0.026,
        depth: unit * 0.022,
        height: unit * 0.1,
        topWidth: unit * 0.012,
        topDepth: unit * 0.01,
        lean: side * unit * 0.012,
        jitter: chip * HALF,
        crown: damage * unit * 0.04,
        rng,
      }).translate(side * unit * 0.042, baseY + skull * 0.95, -unit * 0.01));
    }
  }

  if (kind === 'falcon') {
    add(hewnBlock({
      width: unit * 0.05,
      depth: unit * 0.03,
      height: unit * 0.022,
      topWidth: unit * 0.055,
      jitter: chip * HALF,
      rng,
    }).translate(0, browY, unit * 0.055));
    add(hewnBlock({
      width: unit * 0.026,
      depth: unit * 0.075,
      height: unit * 0.05,
      topWidth: unit * 0.02,
      topDepth: unit * 0.045,
      leanZ: -unit * 0.012,
      jitter: chip * HALF,
      rng,
    }).rotateX(-0.5).translate(0, baseY + unit * 0.03, unit * 0.085));
  }

  if (kind === 'lioness') {
    add(hewnBlock({
      width: unit * 0.06,
      depth: unit * 0.055,
      height: unit * 0.045,
      topWidth: unit * 0.05,
      jitter: chip,
      rng,
    }).translate(0, baseY + unit * 0.015, unit * 0.075));
    for (const side of [-1, 1]) {
      add(drum({
        radius: unit * 0.022,
        topRadius: unit * 0.014,
        height: unit * 0.03,
        segments: 5,
        open: true,
      }).rotateZ(side * 0.5).translate(side * unit * 0.05, baseY + skull * 0.8, -unit * 0.005));
    }
  }

  if (kind === 'ram') {
    add(hewnBlock({
      width: unit * 0.05,
      depth: unit * 0.07,
      height: unit * 0.05,
      topWidth: unit * 0.04,
      jitter: chip,
      rng,
    }).translate(0, baseY + unit * 0.01, unit * 0.08));
    for (const side of [-1, 1]) {
      add(hewnBlock({
        width: unit * 0.055,
        depth: unit * 0.03,
        height: unit * 0.028,
        topWidth: unit * 0.04,
        lean: side * unit * 0.01,
        jitter: chip * HALF,
        rng,
      }).translate(side * unit * 0.08, baseY + skull * 0.55, -unit * 0.005), TONE.worn);
      add(hewnBlock({
        width: unit * 0.03,
        depth: unit * 0.028,
        height: unit * 0.06,
        topWidth: unit * 0.02,
        lean: -side * unit * 0.015,
        jitter: chip * HALF,
        crown: damage * unit * 0.03,
        rng,
      }).translate(side * unit * 0.1, baseY + skull * 0.1, unit * 0.005), TONE.worn);
    }
  }

  if (kind === 'human') {
    add(hewnBlock({
      width: unit * 0.032,
      depth: unit * 0.03,
      height: unit * 0.085,
      topWidth: unit * 0.024,
      topDepth: unit * 0.022,
      leanZ: -unit * 0.012,
      jitter: chip * HALF,
      crown: damage * unit * 0.03,
      rng,
    }).rotateX(0.32).translate(0, baseY - unit * 0.075, unit * 0.055), TONE.worn);
  }

  const crownTop = baseY + skull;
  const crown = rng();
  if (damage < 0.6 && crown < 0.3) {
    add(hewnBlock({
      width: unit * 0.09,
      depth: unit * 0.09,
      height: unit * 0.15,
      topWidth: unit * 0.06,
      topDepth: unit * 0.06,
      jitter: chip,
      rng,
    }).translate(0, crownTop, -unit * 0.005));
    add(pyramidBlock({
      width: unit * 0.06,
      height: unit * 0.045,
      jitter: chip * HALF,
      rng,
    }).translate(0, crownTop + unit * 0.15, -unit * 0.005));
  } else if (damage < 0.6 && crown < 0.55) {
    add(drum({
      radius: unit * 0.062,
      height: unit * 0.018,
      segments: 8,
    }).rotateX(QUARTER_TURN).translate(0, crownTop + unit * 0.055, 0));
  }

  return parts;
}

/**
 * Фигура бога: сидящая на троне или стоящая с выставленной ногой.
 *
 * Задний столб есть у обеих: без него египетская статуя выглядит греческой, и это первое,
 * что выдаёт силуэт с любой дистанции.
 */
function figureParts({ rng, height, seated, damage = 0 }) {
  const parts = [];
  const add = (geometry, tone = TONE.fresh) => parts.push(paint(geometry, tone));
  const kind = pick(rng, HEADS);
  const chip = height * 0.003 + damage * height * 0.012;
  const plinth = height * 0.05;
  const shoulderY = height * 0.7;
  const chinY = height * 0.745;
  const shoulders = height * 0.25;

  if (seated) {
    const seatY = height * 0.34;
    const kneeY = height * 0.45;
    const kneeZ = height * 0.3;
    const seatDepth = height * 0.36;
    const backZ = -seatDepth * HALF;

    add(hewnBlock({
      width: height * 0.46,
      depth: kneeZ + height * 0.14 - backZ,
      height: plinth,
      jitter: chip,
      rng,
    }).translate(0, 0, (kneeZ + height * 0.14 + backZ) * HALF), TONE.worn);

    add(hewnBlock({
      width: height * 0.4,
      depth: seatDepth,
      height: seatY - plinth,
      topWidth: height * 0.38,
      jitter: chip,
      rng,
    }).translate(0, plinth, backZ + seatDepth * HALF), courseTone(rng));

    add(hewnBlock({
      width: height * 0.4,
      depth: height * 0.1,
      height: height * 0.4,
      topWidth: height * 0.38,
      jitter: chip,
      crown: damage * height * 0.03,
      rng,
    }).translate(0, seatY, backZ + height * 0.05), courseTone(rng));

    add(hewnBlock({
      width: height * 0.14,
      depth: height * 0.08,
      height: chinY - seatY - height * 0.4,
      jitter: chip,
      rng,
    }).translate(0, seatY + height * 0.4, backZ + height * 0.04));

    add(hewnBlock({
      width: height * 0.3,
      depth: kneeZ,
      height: kneeY - seatY,
      topDepth: kneeZ * 0.95,
      jitter: chip,
      rng,
    }).translate(0, seatY, kneeZ * HALF));

    for (const side of [-1, 1]) {
      add(hewnBlock({
        width: height * 0.12,
        depth: height * 0.12,
        height: kneeY - plinth,
        topDepth: height * 0.14,
        leanZ: height * 0.015,
        jitter: chip,
        rng,
      }).translate(side * height * 0.085, plinth, kneeZ - height * 0.03));
      add(hewnBlock({
        width: height * 0.11,
        depth: height * 0.13,
        height: height * 0.045,
        topDepth: height * 0.1,
        jitter: chip,
        rng,
      }).translate(side * height * 0.085, plinth, kneeZ + height * 0.055), TONE.worn);
    }

    add(hewnBlock({
      width: height * 0.25,
      depth: height * 0.2,
      height: height * 0.14,
      topWidth: height * 0.24,
      topDepth: height * 0.18,
      jitter: chip,
      rng,
    }).translate(0, kneeY - height * 0.01, -height * 0.02));

    add(hewnBlock({
      width: height * 0.24,
      depth: height * 0.18,
      height: shoulderY - height * 0.58,
      topWidth: shoulders,
      topDepth: height * 0.16,
      jitter: chip,
      crown: damage * height * 0.05,
      rng,
    }).translate(0, height * 0.58, -height * 0.02));

    for (const side of [-1, 1]) {
      const lost = damage > 0.55 && side < 0;
      if (lost) continue;
      add(hewnBlock({
        width: height * 0.075,
        depth: height * 0.085,
        height: shoulderY - kneeY - height * 0.01,
        topWidth: height * 0.085,
        lean: side * height * 0.008,
        jitter: chip,
        rng,
      }).translate(side * shoulders * 0.52, kneeY + height * 0.01, -height * 0.03));
      add(hewnBlock({
        width: height * 0.075,
        depth: kneeZ - height * 0.02,
        height: height * 0.055,
        topDepth: kneeZ - height * 0.06,
        jitter: chip,
        rng,
      }).translate(side * shoulders * 0.42, kneeY - height * 0.005, kneeZ * HALF));
    }
  } else {
    const kiltY = height * 0.44;

    add(hewnBlock({
      width: height * 0.34,
      depth: height * 0.34,
      height: plinth,
      jitter: chip,
      rng,
    }).translate(0, 0, height * 0.02), TONE.worn);

    add(hewnBlock({
      width: height * 0.16,
      depth: height * 0.09,
      height: chinY - plinth,
      topWidth: height * 0.14,
      jitter: chip,
      rng,
    }).translate(0, plinth, -height * 0.11), courseTone(rng));

    for (const side of [-1, 1]) {
      add(hewnBlock({
        width: height * 0.095,
        depth: height * 0.15,
        height: height * 0.5 - plinth,
        topWidth: height * 0.105,
        topDepth: height * 0.13,
        leanZ: -side * height * 0.03,
        jitter: chip,
        rng,
      }).translate(side * height * 0.058, plinth, side < 0 ? height * 0.035 : -height * 0.01));
    }

    add(hewnBlock({
      width: height * 0.25,
      depth: height * 0.22,
      height: height * 0.14,
      topWidth: height * 0.2,
      topDepth: height * 0.17,
      jitter: chip,
      rng,
    }).translate(0, kiltY, height * 0.01));

    add(hewnBlock({
      width: height * 0.21,
      depth: height * 0.16,
      height: shoulderY - height * 0.56,
      topWidth: shoulders,
      topDepth: height * 0.15,
      jitter: chip,
      crown: damage * height * 0.05,
      rng,
    }).translate(0, height * 0.56, -height * 0.01));

    for (const side of [-1, 1]) {
      const lost = damage > 0.55 && side > 0;
      if (lost) continue;
      add(hewnBlock({
        width: height * 0.075,
        depth: height * 0.085,
        height: height * 0.26,
        topWidth: height * 0.085,
        lean: side * height * 0.01,
        jitter: chip,
        rng,
      }).translate(side * shoulders * 0.52, shoulderY - height * 0.26, -height * 0.015));
      add(hewnBlock({
        width: height * 0.07,
        depth: height * 0.09,
        height: height * 0.07,
        topWidth: height * 0.06,
        jitter: chip,
        rng,
      }).translate(side * shoulders * 0.53, shoulderY - height * 0.32, -height * 0.005), TONE.worn);
    }
  }

  add(hewnBlock({
    width: height * 0.08,
    depth: height * 0.08,
    height: chinY - shoulderY,
    jitter: chip * HALF,
    rng,
  }).translate(0, shoulderY, 0));

  parts.push(...headParts({ rng, unit: height, baseY: chinY, kind, damage }));
  return parts;
}

function pyramid({ rng, height }) {
  const base = height * between(rng, 1.35, 1.75);
  const courses = count(rng, 7, 11);
  const stub = rng() < 0.35;
  const built = courses - (stub ? count(rng, 1, 3) : 1);
  const spread = (level) => base * (1 - level / courses);
  const parts = [];

  for (let level = 0; level < built; level += 1) {
    const foot = spread(level);
    const head = foot * 0.97;
    const course = hewnBlock({
      width: foot,
      depth: foot,
      topWidth: head,
      topDepth: head,
      height: height / courses,
      jitter: base * 0.007,
      crown: base * 0.004,
      rng,
    }).translate(0, (level * height) / courses, 0);
    parts.push(paint(course, courseTone(rng)));
  }

  const crestY = (built * height) / courses;
  const crest = spread(built);
  if (stub) {
    parts.push(paint(hewnBlock({
      width: crest,
      depth: crest,
      height: height * 0.02,
      topWidth: crest * 0.92,
      topDepth: crest * 0.92,
      jitter: crest * 0.07,
      crown: crest * 0.12,
      rng,
    }).translate(0, crestY, 0), TONE.worn));
    for (const chunk of stoneChunks({ rng, span: crest * 0.4, size: crest * 0.16, amount: 3 })) {
      parts.push(chunk.translate(0, crestY + height * 0.012, 0));
    }
  } else {
    parts.push(paint(pyramidBlock({
      width: crest,
      height: height / courses,
      apexX: crest * between(rng, -0.06, 0.06),
      apexZ: crest * between(rng, -0.06, 0.06),
      jitter: crest * 0.03,
      rng,
    }).translate(0, crestY, 0), TONE.fresh));
  }

  const cased = count(rng, 1, 2.4);
  const strips = 3;
  const thickness = base * 0.022;
  const first = Math.floor(rng() * 4);
  for (let face = 0; face < cased; face += 1) {
    const turn = ((first + face) % 4) * QUARTER_TURN;
    for (let strip = 0; strip < strips; strip += 1) {
      const rise = height * between(rng, 0.1, 0.5);
      const shrink = 1 - rise / height;
      const centre = (strip - 1) * (base / strips);
      const panel = hewnBlock({
        width: (base / strips) * 0.99,
        depth: thickness,
        height: rise,
        topWidth: (base / strips) * shrink,
        topDepth: thickness * 0.7,
        lean: centre * (shrink - 1),
        leanZ: (base * shrink - base) * HALF,
        jitter: base * 0.004,
        crown: base * 0.02,
        rng,
      }).translate(centre, 0, base * HALF + thickness * 0.35);
      parts.push(paint(panel.rotateY(turn), TONE.fresh));
    }
  }

  parts.push(...stoneChunks({ rng, span: base * 0.62, size: base * 0.05, amount: 4 }));
  parts.push(...sandDrift({ rng, span: base * 0.55, height: height * 0.06, lumps: 3 }));
  return parts;
}

function obelisk({ rng, height }) {
  const shaftWidth = height * between(rng, 0.07, 0.095);
  const tip = shaftWidth * between(rng, 1, 1.35);
  const plinth = height * 0.045;
  const socle = height * 0.03;
  const broken = rng() < 0.3;
  const parts = [];

  parts.push(paint(hewnBlock({
    width: shaftWidth * 2.5,
    depth: shaftWidth * 2.5,
    height: plinth,
    topWidth: shaftWidth * 2.3,
    topDepth: shaftWidth * 2.3,
    jitter: shaftWidth * 0.05,
    rng,
  }), TONE.worn));
  parts.push(paint(hewnBlock({
    width: shaftWidth * 1.7,
    depth: shaftWidth * 1.7,
    height: socle,
    topWidth: shaftWidth * 1.5,
    topDepth: shaftWidth * 1.5,
    jitter: shaftWidth * 0.03,
    rng,
  }).translate(0, plinth, 0), courseTone(rng)));

  const full = height - plinth - socle - tip;
  const shaft = broken ? full * between(rng, 0.45, 0.8) : full;
  const crestWidth = shaftWidth * (1 - 0.28 * (shaft / full));
  parts.push(paint(hewnBlock({
    width: shaftWidth,
    depth: shaftWidth,
    height: shaft,
    topWidth: crestWidth,
    topDepth: crestWidth,
    jitter: shaftWidth * 0.012,
    crown: broken ? shaftWidth * 0.5 : shaftWidth * 0.02,
    rng,
  }).translate(0, plinth + socle, 0), TONE.fresh));

  if (broken) {
    const fallen = hewnBlock({
      width: shaftWidth * 0.75,
      depth: shaftWidth * 0.75,
      height: full - shaft,
      topWidth: shaftWidth * 0.6,
      topDepth: shaftWidth * 0.6,
      jitter: shaftWidth * 0.04,
      crown: shaftWidth * 0.3,
      rng,
    }).rotateZ(QUARTER_TURN + between(rng, -0.15, 0.15)).rotateY(rng() * TAU);
    parts.push(paint(settle(fallen).translate(shaftWidth * between(rng, 1.6, 2.6), 0, shaftWidth * between(rng, -1.5, 1.5)), TONE.worn));
    parts.push(...stoneChunks({ rng, span: shaftWidth * 3, size: shaftWidth * 0.3, amount: 3 }));
  } else {
    parts.push(paint(pyramidBlock({
      width: crestWidth,
      height: tip,
      jitter: shaftWidth * 0.01,
      rng,
    }).translate(0, plinth + socle + shaft, 0), TONE.fresh));
  }

  parts.push(...sandDrift({ rng, span: shaftWidth * 1.8, height: height * 0.02, lumps: 3 }));
  return parts;
}

function pylon({ rng, height }) {
  const gate = height * between(rng, 0.22, 0.3);
  const tower = height * between(rng, 0.5, 0.62);
  const depth = height * between(rng, 0.26, 0.34);
  const batter = between(rng, 0.76, 0.86);
  const bodyTop = height * 0.92;
  const wrecked = rng() < 0.4;
  const parts = [];

  for (const side of [-1, 1]) {
    const centre = (side * (gate + tower)) * HALF;
    const crestWidth = tower * batter;
    const crestDepth = depth * (batter + (1 - batter) * HALF);
    const ruin = wrecked && side < 0;
    const stand = ruin ? bodyTop * between(rng, 0.5, 0.8) : bodyTop;
    const share = stand / bodyTop;
    const lean = (side * (crestWidth - tower)) * HALF * share;

    parts.push(paint(hewnBlock({
      width: tower,
      depth,
      height: stand,
      topWidth: tower + (crestWidth - tower) * share,
      topDepth: depth + (crestDepth - depth) * share,
      lean,
      jitter: height * 0.005,
      crown: ruin ? height * 0.05 : height * 0.004,
      rng,
    }).translate(centre, 0, 0), courseTone(rng)));

    const tilt = Math.atan(((tower - crestWidth) * HALF) / bodyTop);
    for (const face of [-1, 1]) {
      parts.push(paint(drum({
        radius: depth * 0.075,
        topRadius: depth * 0.06,
        height: stand,
        segments: 6,
        open: true,
      }).rotateZ(side * tilt).translate(
        centre + side * (tower * HALF - depth * 0.05),
        0,
        face * (depth * HALF - depth * 0.06),
      ), TONE.fresh));
    }

    if (ruin) {
      parts.push(...stoneChunks({
        rng,
        span: tower * 0.45,
        size: tower * 0.14,
        amount: 4,
      }).map((chunk) => chunk.translate(centre + side * tower * 0.3, 0, 0)));
      continue;
    }

    const cornice = height * 0.055;
    parts.push(paint(hewnBlock({
      width: crestWidth,
      depth: crestDepth,
      height: cornice,
      topWidth: crestWidth * 1.13,
      topDepth: crestDepth * 1.13,
      jitter: height * 0.004,
      rng,
    }).translate(centre + lean, stand, 0), TONE.fresh));
    parts.push(paint(hewnBlock({
      width: crestWidth * 1.17,
      depth: crestDepth * 1.17,
      height: height * 0.025,
      jitter: height * 0.003,
      crown: height * 0.006,
      rng,
    }).translate(centre + lean, stand + cornice, 0), TONE.worn));
  }

  const lintelY = height * 0.5;
  parts.push(paint(hewnBlock({
    width: gate + tower * 0.6,
    depth: depth * 0.82,
    height: height * 0.12,
    jitter: height * 0.004,
    rng,
  }).translate(0, lintelY, 0), courseTone(rng)));
  parts.push(paint(hewnBlock({
    width: gate + tower * 0.66,
    depth: depth * 0.9,
    height: height * 0.04,
    topWidth: gate + tower * 0.76,
    topDepth: depth,
    jitter: height * 0.003,
    rng,
  }).translate(0, lintelY + height * 0.12, 0), TONE.fresh));
  parts.push(paint(hewnBlock({
    width: gate * 1.02,
    depth: depth * 1.15,
    height: height * 0.022,
    jitter: height * 0.004,
    crown: height * 0.006,
    rng,
  }), TONE.worn));

  parts.push(...sandDrift({ rng, span: (gate + tower * 2) * 0.42, height: height * 0.035, lumps: 3 }));
  return parts;
}

function godSeated({ rng, height }) {
  return fitHeight(figureParts({ rng, height, seated: true, damage: between(rng, 0, 0.45) }), height);
}

function godStanding({ rng, height }) {
  return fitHeight(figureParts({ rng, height, seated: false, damage: between(rng, 0, 0.45) }), height);
}

/**
 * Колосс: сидящая фигура, которую занесло по колени и выше.
 *
 * Всё, что ушло под песок, из геометрии выбрасывается: платить треугольниками за
 * похороненные ступни незачем, а сид всё равно каждый раз хоронит другое.
 */
function colossus({ rng, height }) {
  const burial = height * between(rng, 0.28, 0.5);
  const seated = rng() < 0.6;
  const figure = figureParts({ rng, height, seated, damage: between(rng, 0.55, 0.9) });
  const parts = figure.filter((geometry) => {
    geometry.computeBoundingBox();
    return geometry.boundingBox.max.y > burial;
  });
  parts.push(...sandDrift({ rng, span: height * 0.34, height: burial, lumps: 6 }));
  parts.push(...stoneChunks({
    rng,
    span: height * 0.5,
    size: height * 0.07,
    amount: 3,
  }).map((chunk) => chunk.translate(0, burial * 0.55, 0)));
  return parts;
}

function sphinx({ rng, height }) {
  const length = height * between(rng, 2.3, 2.8);
  const width = height * 0.34;
  const plinth = height * 0.07;
  const bodyTop = height * 0.46;
  const rumpZ = -length * HALF;
  const chestZ = length * 0.16;
  const chip = height * 0.006;
  const parts = [];
  const add = (geometry, tone = TONE.fresh) => parts.push(paint(geometry, tone));

  add(hewnBlock({
    width: width * 1.35,
    depth: length,
    height: plinth,
    jitter: chip,
    rng,
  }), TONE.worn);

  add(hewnBlock({
    width,
    depth: chestZ - rumpZ,
    height: bodyTop - plinth,
    topWidth: width * 0.86,
    topDepth: (chestZ - rumpZ) * 0.96,
    jitter: chip,
    rng,
  }).translate(0, plinth, (chestZ + rumpZ) * HALF), courseTone(rng));

  add(hewnBlock({
    width: width * 1.02,
    depth: length * 0.24,
    height: height * 0.13,
    topWidth: width * 0.8,
    topDepth: length * 0.18,
    jitter: chip,
    crown: chip * 2,
    rng,
  }).translate(0, bodyTop - height * 0.02, rumpZ + length * 0.14), courseTone(rng));

  for (const side of [-1, 1]) {
    add(hewnBlock({
      width: width * 0.26,
      depth: length * 0.42,
      height: height * 0.14,
      topDepth: length * 0.38,
      jitter: chip,
      rng,
    }).translate(side * width * 0.3, plinth, length * 0.26));
    add(hewnBlock({
      width: width * 0.28,
      depth: length * 0.1,
      height: height * 0.1,
      topWidth: width * 0.24,
      topDepth: length * 0.07,
      jitter: chip,
      crown: chip * 2,
      rng,
    }).translate(side * width * 0.3, plinth, length * 0.45), TONE.worn);
  }

  add(hewnBlock({
    width: width * 0.62,
    depth: height * 0.26,
    height: height * 0.36,
    topWidth: width * 0.5,
    topDepth: height * 0.2,
    leanZ: -height * 0.02,
    jitter: chip,
    rng,
  }).translate(0, bodyTop - height * 0.06, chestZ - height * 0.02));

  const chinY = bodyTop + height * 0.22;
  add(hewnBlock({
    width: height * 0.15,
    depth: height * 0.15,
    height: height * 0.06,
    jitter: chip,
    rng,
  }).translate(0, chinY - height * 0.06, chestZ - height * 0.02));

  const headSet = headParts({
    rng,
    unit: height * 1.8,
    baseY: chinY,
    kind: 'human',
    damage: between(rng, 0.5, 0.85),
  });
  for (const piece of headSet) parts.push(piece.translate(0, 0, chestZ - height * 0.02));

  add(hewnBlock({
    width: width * 0.1,
    depth: length * 0.3,
    height: height * 0.05,
    topDepth: length * 0.24,
    jitter: chip,
    rng,
  }).rotateY(0.35).translate(width * 0.52, bodyTop - height * 0.1, rumpZ + length * 0.18), TONE.worn);

  parts.push(...sandDrift({ rng, span: width * 1.1, height: height * 0.05, lumps: 4 }));
  return fitHeight(parts, height);
}

function stela({ rng, height }) {
  const width = height * between(rng, 0.36, 0.46);
  const thickness = width * between(rng, 0.22, 0.3);
  const plinth = height * 0.07;
  const rounded = rng() < 0.6;
  const bodyTop = height * (rounded ? 1 - 0.5 * (width / height) : 0.9);
  const tilt = between(rng, -0.06, 0.06);
  const chip = width * 0.02;
  const parts = [];
  const add = (geometry, tone = TONE.fresh) => parts.push(paint(geometry, tone));

  add(hewnBlock({
    width: width * 1.5,
    depth: thickness * 2.4,
    height: plinth,
    topWidth: width * 1.35,
    topDepth: thickness * 2.1,
    jitter: chip,
    rng,
  }), TONE.worn);

  add(hewnBlock({
    width,
    depth: thickness,
    height: bodyTop - plinth,
    topWidth: width * 0.97,
    topDepth: thickness * 0.94,
    jitter: chip * 0.5,
    crown: rounded ? 0 : chip,
    rng,
  }).translate(0, plinth, 0));

  if (rounded) {
    add(roundCap({ radius: width * 0.485, depth: thickness * 0.94, segments: 7 })
      .translate(0, bodyTop, 0));
  } else {
    add(hewnBlock({
      width: width * 0.97,
      depth: thickness * 0.94,
      height: height * 0.05,
      topWidth: width * 1.12,
      topDepth: thickness * 1.1,
      jitter: chip * 0.4,
      crown: chip,
      rng,
    }).translate(0, bodyTop, 0));
    add(hewnBlock({
      width: width * 1.16,
      depth: thickness * 1.14,
      height: height * 0.025,
      jitter: chip * 0.3,
      crown: chip * 0.8,
      rng,
    }).translate(0, bodyTop + height * 0.05, 0), TONE.worn);
  }

  for (const part of parts) part.rotateZ(tilt);
  parts.push(...stoneChunks({ rng, span: width * 1.3, size: width * 0.12, amount: 2 }));
  parts.push(...sandDrift({ rng, span: width * 0.9, height: plinth * 0.9, lumps: 3 }));
  return parts;
}

function offeringTable({ rng, height }) {
  const width = height * between(rng, 1.1, 1.4);
  const depth = width * between(rng, 0.8, 0.95);
  const slab = height * 0.16;
  const pedestal = height - slab;
  const rim = width * 0.07;
  const chip = width * 0.012;
  const parts = [];
  const add = (geometry, tone = TONE.fresh) => parts.push(paint(geometry, tone));

  add(hewnBlock({
    width: width * 0.68,
    depth: depth * 0.68,
    height: pedestal,
    topWidth: width * 0.62,
    topDepth: depth * 0.62,
    jitter: chip,
    rng,
  }), courseTone(rng));

  add(hewnBlock({
    width,
    depth,
    height: slab,
    topWidth: width * 0.97,
    topDepth: depth * 0.97,
    jitter: chip,
    crown: chip,
    rng,
  }).translate(0, pedestal, 0));

  add(hewnBlock({
    width: width * 0.3,
    depth: depth * 0.34,
    height: slab * 0.8,
    topWidth: width * 0.22,
    topDepth: depth * 0.3,
    jitter: chip,
    rng,
  }).translate(0, pedestal, depth * 0.62), TONE.worn);

  const rimY = pedestal + slab;
  for (const [x, z, along] of [[0, -1, true], [-1, 0, false], [1, 0, false]]) {
    add(hewnBlock({
      width: along ? width * 0.9 : rim,
      depth: along ? rim : depth * 0.9,
      height: height * 0.09,
      topWidth: along ? width * 0.86 : rim * 0.7,
      topDepth: along ? rim * 0.7 : depth * 0.86,
      jitter: chip,
      crown: chip * 2,
      rng,
    }).translate(x * (width * HALF - rim * HALF), rimY, z * (depth * HALF - rim * HALF)));
  }

  for (const side of [-1, 1]) {
    add(roundCap({ radius: width * 0.11, depth: width * 0.3, segments: 5 })
      .rotateY(QUARTER_TURN)
      .translate(side * width * 0.19, rimY, depth * 0.06), TONE.worn);
  }

  return fitHeight(parts, height);
}

function canopicJar({ rng, height }) {
  const belly = height * between(rng, 0.19, 0.23);
  const kind = pick(rng, HEADS);
  const body = height * 0.46;
  const shoulder = height * 0.2;
  const parts = [];
  const add = (geometry, tone = TONE.fresh) => parts.push(paint(geometry, tone));

  add(hewnBlock({
    width: belly * 2.2,
    depth: belly * 2.2,
    height: height * 0.04,
    topWidth: belly * 2,
    topDepth: belly * 2,
    jitter: belly * 0.05,
    rng,
  }), TONE.worn);
  add(drum({
    radius: belly * 0.82,
    topRadius: belly,
    height: body,
    segments: 9,
    open: true,
  }).translate(0, height * 0.04, 0));
  add(drum({
    radius: belly,
    topRadius: belly * 0.78,
    height: shoulder,
    segments: 9,
    open: true,
  }).translate(0, height * 0.04 + body, 0));
  add(drum({
    radius: belly * 0.84,
    topRadius: belly * 0.8,
    height: height * 0.06,
    segments: 9,
  }).translate(0, height * 0.04 + body + shoulder, 0), TONE.worn);

  const lidY = height * 0.04 + body + shoulder + height * 0.06;
  parts.push(...headParts({
    rng,
    unit: height * 1.9,
    baseY: lidY,
    kind,
    damage: between(rng, 0, 0.4),
  }));
  return fitHeight(parts, height);
}

/**
 * Солнечная ладья: каменная модель на подставке.
 *
 * Оба конца задраны и кончаются папирусным зонтиком, и это единственное, по чему ладья
 * узнаётся силуэтом. Корпус набран из четырёх звеньев, потому что три дают ломаную,
 * а пять уже не видно.
 */
function solarBarque({ rng, height }) {
  const length = height * between(rng, 2.8, 3.4);
  const beam = height * between(rng, 0.5, 0.62);
  const cradle = height * 0.18;
  const hull = height * 0.36;
  const links = 4;
  const chip = height * 0.02;
  const parts = [];
  const add = (geometry, tone = TONE.fresh) => parts.push(paint(geometry, tone));

  for (const side of [-1, 1]) {
    add(hewnBlock({
      width: length * 0.14,
      depth: beam * 1.2,
      height: cradle,
      topWidth: length * 0.1,
      jitter: chip,
      rng,
    }).translate(side * length * 0.26, 0, 0), TONE.worn);
  }

  for (let link = 0; link < links; link += 1) {
    const spot = (link + HALF) / links - HALF;
    const taper = 1 - Math.abs(spot) * 1.1;
    add(hewnBlock({
      width: (length * 0.62) / links,
      depth: beam * taper,
      height: hull * (0.75 + taper * 0.25),
      topWidth: (length * 0.62) / links,
      topDepth: beam * taper * 1.08,
      jitter: chip * 0.6,
      rng,
    }).translate(spot * length * 0.62, cradle, 0));
  }

  for (const side of [-1, 1]) {
    const stem = hewnBlock({
      width: length * 0.2,
      depth: beam * 0.42,
      height: height * 0.36,
      topWidth: length * 0.11,
      topDepth: beam * 0.22,
      lean: side * length * 0.06,
      jitter: chip * 0.6,
      rng,
    }).rotateZ(-side * 0.75);
    add(settle(stem).translate(side * length * 0.4, cradle + hull * 0.5, 0));
    add(hewnBlock({
      width: length * 0.06,
      depth: beam * 0.3,
      height: height * 0.2,
      topWidth: length * 0.11,
      topDepth: beam * 0.4,
      jitter: chip * 0.5,
      crown: chip,
      rng,
    }).translate(side * length * 0.47, cradle + hull * 0.5 + height * 0.36, 0), TONE.worn);
  }

  const deck = cradle + hull;
  add(hewnBlock({
    width: length * 0.22,
    depth: beam * 0.72,
    height: height * 0.36,
    topWidth: length * 0.2,
    topDepth: beam * 0.66,
    jitter: chip * 0.5,
    rng,
  }).translate(-length * 0.02, deck, 0), courseTone(rng));
  add(hewnBlock({
    width: length * 0.2,
    depth: beam * 0.66,
    height: height * 0.075,
    topWidth: length * 0.26,
    topDepth: beam * 0.8,
    jitter: chip * 0.4,
    crown: chip * 0.6,
    rng,
  }).translate(-length * 0.02, deck + height * 0.36, 0));
  return parts;
}

function stairs({ rng, height }) {
  const steps = count(rng, 4, 9);
  const width = height * between(rng, 1.4, 2.2);
  const rise = height / steps;
  const tread = rise * between(rng, 1.5, 2.1);
  const cheek = width * 0.09;
  const chip = rise * 0.09;
  const parts = [];

  for (let step = 0; step < steps; step += 1) {
    const run = (steps - step) * tread;
    parts.push(paint(hewnBlock({
      width,
      depth: run,
      height: rise,
      topDepth: run - tread * 0.06,
      jitter: chip * (step === steps - 1 ? 2 : 1),
      crown: chip * between(rng, 0.3, 1.4),
      rng,
    }).translate(0, step * rise, -run * HALF), courseTone(rng)));
  }

  for (const side of [-1, 1]) {
    parts.push(paint(hewnBlock({
      width: cheek,
      depth: steps * tread,
      height: rise * 1.2,
      topWidth: cheek * 0.85,
      slopeZ: -height,
      jitter: chip,
      crown: chip * 1.5,
      rng,
    }).translate(side * (width * HALF + cheek * HALF), height - rise * 1.1, -steps * tread * HALF),
    TONE.worn));
  }

  parts.push(...stoneChunks({
    rng,
    span: width * 0.5,
    size: rise * 0.35,
    amount: 3,
  }).map((chunk) => chunk.translate(0, 0, tread * 0.6)));
  return parts;
}

function slab({ rng, height }) {
  const side = height;
  const thick = height * between(rng, 0.14, 0.24);
  const parts = [];
  const stone = hewnBlock({
    width: side,
    depth: side * between(rng, 0.7, 1.1),
    height: thick,
    topWidth: side * 0.96,
    topDepth: side * 0.94,
    jitter: thick * 0.18,
    crown: thick * 0.15,
    rng,
  }).rotateY(rng() * TAU).rotateZ(between(rng, -0.09, 0.09));
  parts.push(paint(settle(stone), courseTone(rng)));
  parts.push(...stoneChunks({ rng, span: side * 0.75, size: side * 0.14, amount: 2 }));
  return parts;
}

function rubble({ rng, height }) {
  return stoneChunks({
    rng,
    span: height * 1.6,
    size: height * 0.75,
    amount: count(rng, 5, 8),
    tone: TONE.worn,
  }).concat(sandDrift({ rng, span: height * 1.2, height: height * 0.3, lumps: 3 }));
}

/**
 * Засыпанное основание: два ряда кладки и обломок того, что на них стояло.
 *
 * Такие пятна расставляются десятками и держат ощущение, что город больше того, что
 * стоит: развалины читаются даже там, где строить уже нечего.
 */
function buriedBase({ rng, height }) {
  const width = height * between(rng, 2.2, 3.4);
  const depth = width * between(rng, 0.6, 1);
  const courses = count(rng, 2, 3);
  const podium = height * 0.55;
  const parts = [];

  for (let level = 0; level < courses; level += 1) {
    const shrink = 1 - level * 0.08;
    parts.push(paint(hewnBlock({
      width: width * shrink,
      depth: depth * shrink,
      height: podium / courses,
      topWidth: width * shrink * 0.97,
      topDepth: depth * shrink * 0.97,
      jitter: height * 0.05,
      crown: height * (level === courses - 1 ? 0.22 : 0.04),
      rng,
    }).translate(0, (level * podium) / courses, 0), courseTone(rng)));
  }

  const stump = hewnBlock({
    width: width * 0.22,
    depth: depth * 0.3,
    height: height * between(rng, 0.3, 0.5),
    topWidth: width * 0.17,
    topDepth: depth * 0.22,
    jitter: height * 0.06,
    crown: height * 0.25,
    rng,
  }).translate(width * between(rng, -0.24, 0.24), podium, depth * between(rng, -0.2, 0.2));
  parts.push(paint(stump, TONE.fresh));

  parts.push(...stoneChunks({ rng, span: width * 0.6, size: height * 0.3, amount: 3 }));
  parts.push(...sandDrift({ rng, span: width * 0.55, height: height * 0.55, lumps: 5 }));
  return parts;
}

const BUILDERS = {
  pyramid,
  obelisk,
  pylon,
  godSeated,
  godStanding,
  sphinx,
  colossus,
  stela,
  offeringTable,
  canopicJar,
  solarBarque,
  stairs,
  slab,
  rubble,
  buriedBase,
};

export const PROP_NAMES = Object.keys(BUILDERS);

let stone = null;

/**
 * Один материал на весь набор: иначе инстансинг рассыпается на вызовы отрисовки.
 *
 * Материал живёт весь сеанс и переживает пересборку сцены, поэтому ронять его `dispose`
 * вместе со сценой нельзя. Цвет камня приходит из вершин: чужой материал без
 * `vertexColors` соберёт набор в один тон и потеряет песок у подножий.
 */
export function propMaterial(rng) {
  if (stone) return stone;
  const grain = createSurfaceGrunge({
    random: rng,
    size: GRAIN.size,
    spots: GRAIN.spots,
    streaks: GRAIN.streaks,
  });
  stone = new THREE.MeshStandardMaterial({
    vertexColors: true,
    color: 0xffffff,
    roughness: GRAIN.roughness,
    metalness: 0,
    roughnessMap: grain,
    bumpMap: grain,
    bumpScale: GRAIN.bump,
  });
  return stone;
}

/** Слитая геометрия пропса: основание на нуле, центр в начале координат. */
export function propGeometry(name, { rng, height }) {
  const build = BUILDERS[name];
  if (!build) throw new Error(`Неизвестный пропс: ${name}`);
  const merged = mergeGeometries(build({ rng, height }));
  if (!merged) throw new Error(`Пропс ${name} собран из несовместимых кусков`);
  settle(merged);
  projectUv(merged, GRAIN_TILE);
  merged.computeBoundingSphere();
  return merged;
}

export function buildProp(name, { rng, height }) {
  const mesh = new THREE.Mesh(propGeometry(name, { rng, height }), propMaterial(rng));
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
