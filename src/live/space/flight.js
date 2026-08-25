/**
 * Камера: медленный дрейф как основа и врезка на приход.
 *
 * Неподвижная камера превращает тела в аппликацию: они крутятся, но плоскость, в которой они
 * стоят, остаётся плоскостью. Полметра хода хватает, чтобы ближние тела поехали относительно
 * дальних, и объём стал виден. Это основа, и на нуле трипа она единственное, что здесь есть.
 *
 * Дальше начинается монтаж. Раз в шестнадцать или тридцать два удара ракурс меняется одним
 * кадром: другая точка, другое расстояние, другая высота. Плавный проезд между ракурсами
 * читался бы заставкой, потому что глаз успевает его проследить и заскучать; врезка читается
 * склейкой и держит внимание ровно так же, как держит его смена плана в кино. Между врезками
 * ракурс не стоит, а медленно едет сам: наезд или облёт, выбранные вместе с точкой.
 *
 * Тряски здесь нет и не будет. Дрожание камеры на удар это первое, что приходит в голову, и
 * первое, от чего в зале начинает мутить; вся работа отдана смене ракурса и наезду.
 *
 * Удары считаются по признаку, который приходит снаружи: своего счёта времени у камеры нет,
 * иначе врезки разъехались бы с музыкой на первом же изменении темпа.
 */

import * as THREE from 'three';

const DISTANCE = 4.6;
const SWAY = 0.42;
const SWAY_SPEED = 0.13;

// Через сколько ударов резать. Оба числа кратны такту, поэтому врезка всегда попадает на
// сильную долю, а не приходится посреди фразы.
const CUT_BEATS = [16, 32];

// Ракурс: от какой точки смотреть. Ближе двух метров тело закрывает собой весь кадр, дальше
// семи объём пропадает и сцена читается плоской.
const SHOT_RADIUS = [2.2, 7];
const SHOT_HIGH = [-0.5, 0.5];

// Куда ракурс едет между врезками: облёт вокруг центра и наезд с отъездом.
const SHOT_SWING = [-0.25, 0.25];
const SHOT_DOLLY = [-0.7, 0.7];
const RADIUS_LIMIT = [1.7, 9];

// Насколько центр внимания уходит от середины сцены. Кадр, где центр ровно посередине, читается
// витриной; смещение даёт композицию.
const AIM = 0.8;

const between = (min, max) => min + Math.random() * (max - min);

const base = new THREE.Vector3();
const shot = new THREE.Vector3();
const focus = new THREE.Vector3();
const CENTRE = new THREE.Vector3();

export function createFlight() {
  let beats = 0;
  let nextCut = 0;
  let struck = false;
  let azimuth = 0;
  let elevation = 0;
  let radius = DISTANCE;
  let swing = 0;
  let dolly = 0;
  const aim = new THREE.Vector3();

  function cut() {
    azimuth = between(0, Math.PI * 2);
    elevation = between(SHOT_HIGH[0], SHOT_HIGH[1]);
    radius = between(SHOT_RADIUS[0], SHOT_RADIUS[1]);
    swing = between(SHOT_SWING[0], SHOT_SWING[1]);
    dolly = between(SHOT_DOLLY[0], SHOT_DOLLY[1]);
    aim.set(between(-AIM, AIM), between(-AIM, AIM) * 0.6, 0);
    nextCut = beats + Math.round(between(CUT_BEATS[0], CUT_BEATS[1]));
  }

  cut();

  return {
    /**
     * Кадр камеры.
     *
     * Ракурс и основа считаются оба, а на экран идёт смесь по трипу: на нуле остаётся ровно
     * прежнее покачивание, на единице ракурс целиком свой. Так одна ручка уводит камеру из
     * витрины в монтаж, и промежуточные её положения тоже что-то значат.
     */
    step(camera, { dt, time, punched, trip }) {
      if (punched && !struck) beats += 1;
      struck = punched;
      if (beats >= nextCut) cut();

      azimuth += swing * dt;
      radius = Math.min(Math.max(radius + dolly * dt, RADIUS_LIMIT[0]), RADIUS_LIMIT[1]);

      base.set(
        Math.sin(time * SWAY_SPEED) * SWAY,
        Math.cos(time * SWAY_SPEED * 0.7) * SWAY * 0.6,
        DISTANCE,
      );
      const flat = Math.cos(elevation) * radius;
      shot.set(Math.sin(azimuth) * flat, Math.sin(elevation) * radius, Math.cos(azimuth) * flat);

      camera.position.lerpVectors(base, shot, trip);
      focus.lerpVectors(CENTRE, aim, trip);
      camera.lookAt(focus);
    },
  };
}
