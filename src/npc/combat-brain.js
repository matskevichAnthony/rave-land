import { BOT, COMBAT } from '../config.js';
import { mulberry32 } from '../terrain/heightfield.js';
import { isAutomatic } from '../combat/weapons.js';
import { CIVIL } from '../combat/teams.js';
import { react } from '../combat/reactions.js';
import { bestCover } from './cover.js';

/**
 * Что боец хочет сделать: намерение и точка, а не движение.
 *
 * Разделение принципиальное. Мозг решает «жать спуск, целиться туда, стоять за тем ящиком»,
 * и это ровно то же намерение, что игрок задаёт мышью и клавишами. Как дойти до точки, знает
 * `pursue.js`, а что при этом играет, знает аниматор. Поэтому бой у бота и у игрока один.
 *
 * Читаемость поведения важнее оптимальности: бот сначала выдерживает паузу реакции, потом
 * стреляет очередью, потом отдыхает и подправляет позицию. Бой, где все убивают мгновенно,
 * выглядит хуже боя с промахами.
 */

const MODE = { patrol: 'patrol', engage: 'engage', reposition: 'reposition',
               retreat: 'retreat' };
const LOST_LINE_SECONDS = 0.4;
const RETREAT_DISTANCE = 22;
const STRAFE_REACH = 3;

function range(random, { min, max }) {
  return min + random() * (max - min);
}

export function createBrain({ seed, team }) {
  const random = mulberry32(seed);
  const peaceful = team === CIVIL;
  let mode = MODE.patrol;
  let reactionLeft = 0;
  let burstLeft = 0;
  let pauseLeft = 0;
  let strafe = random() < 0.5 ? 1 : -1;
  let strafeLeft = range(random, BOT.strafeSeconds);
  let coverPoint = null;
  let coverLeft = 0;
  let lastHp = Infinity;
  // Точка, приказ и цель наводки заводятся один раз на бойца: мозг работает тридцать раз в
  // секунду у каждого, и новый объект на решение это мусор пропорционально населению арены.
  const spot = { x: 0, z: 0 };
  const plan = { x: 0, z: 0, run: false, face: null };
  const aimAt = { x: 0, y: 0, z: 0 };

  /** Событие в режим: та же форма, что у таблиц решений San Andreas, числа наши. */
  function decide(fighter, event) {
    const reaction = react(fighter.team, event, random());
    if (reaction === 'retreat' || reaction === 'flee') return MODE.retreat;
    if (reaction === 'reposition') return MODE.reposition;
    return MODE.engage;
  }

  function holdFire() {
    burstLeft = 0;
    pauseLeft = 0;
    reactionLeft = BOT.reactionSeconds;
  }

  /**
   * Очередь с паузой, а не непрерывный поток.
   *
   * Длина очереди берётся из ствола: автоматическому положено 5-7 выстрелов, остальным 2-3.
   * Пауза между очередями это половина того, почему перестрелка читается глазами.
   */
  function trigger(fighter, dt) {
    if (reactionLeft > 0) {
      reactionLeft -= dt;
      return false;
    }
    if (pauseLeft > 0) {
      pauseLeft -= dt;
      return false;
    }
    if (burstLeft <= 0) {
      const auto = isAutomatic(fighter.weapon);
      burstLeft = Math.round(range(random, auto
        ? { min: BOT.burst.autoMin, max: BOT.burst.autoMax }
        : { min: BOT.burst.min, max: BOT.burst.max }));
    }
    if (fighter.fireCooldown > 0) return false;
    burstLeft -= 1;
    if (burstLeft <= 0) pauseLeft = range(random, BOT.burstPauseSeconds);
    return true;
  }

  /**
   * Кружить вокруг цели, держа дистанцию боя.
   *
   * Одновременно два движения: сближение или разрыв до середины рабочей дистанции и обход
   * вбок. Стрейф меняет сторону по таймеру, поэтому бой не превращается в две неподвижные
   * фигуры, стреляющие друг в друга в упор.
   */
  function circleAround(fighter, target, distance, dt) {
    strafeLeft -= dt;
    if (strafeLeft <= 0) {
      strafe = -strafe;
      strafeLeft = range(random, BOT.strafeSeconds);
    }
    const toX = (target.x - fighter.x) / (distance || 1);
    const toZ = (target.z - fighter.z) / (distance || 1);
    const closing = distance - (BOT.keepDistance.near + BOT.keepDistance.far) / 2;
    spot.x = fighter.x + toX * closing + -toZ * strafe * STRAFE_REACH;
    spot.z = fighter.z + toZ * closing + toX * strafe * STRAFE_REACH;
    return spot;
  }

  function awayFrom(fighter, target, distance) {
    const toX = (fighter.x - target.x) / (distance || 1);
    const toZ = (fighter.z - target.z) / (distance || 1);
    spot.x = fighter.x + toX * RETREAT_DISTANCE;
    spot.z = fighter.z + toZ * RETREAT_DISTANCE;
    return spot;
  }

  function stay(fighter) {
    spot.x = fighter.x;
    spot.z = fighter.z;
    return spot;
  }

  /**
   * Бой лицом к лицу: кружить вокруг цели и стрелять очередями.
   *
   * Оружие без флага MOVEFIRE стреляет только стоя, и это не наша выдумка, а данные
   * weapon.dat: у трёх стволов из четырёх флага нет. Поэтому бот с автоматом подбегает,
   * встаёт, отдаёт очередь и снова идёт, а с пистолетом стреляет на ходу.
   */
  function engage(fighter, target, distance, hasLine, dt) {
    const planted = !fighter.weapon.flags.moveFire && hasLine
      && reactionLeft <= 0 && pauseLeft <= 0;
    return order(planted ? stay(fighter) : circleAround(fighter, target, distance, dt),
                 { run: false, face: target });
  }

  /** Приказ живёт один на бойца: он уходит в шаг движения и переписывается на следующем. */
  function order(point, { run, face }) {
    plan.x = point.x;
    plan.z = point.z;
    plan.run = run;
    plan.face = face;
    return plan;
  }

  /**
   * Одно решение бойца за шаг боя: намерение пишется в запись, точка возвращается.
   *
   * Возвращает приказ движения: `null` значит мирное блуждание, и тогда за движение отвечает
   * `wander.js`, как и до всякого боя.
   */
  function think(fighter, dt, { fighters, perception, cover }) {
    const { intent } = fighter;
    intent.fire = false;
    intent.reload = false;
    intent.aim = false;
    fighter.aimAt = null;

    if (!fighter.alive) {
      mode = MODE.patrol;
      holdFire();
      return null;
    }

    const wounded = fighter.hp < lastHp;
    lastHp = fighter.hp;

    const sight = perception.target(fighter.id);
    const target = sight ? fighters.get(sight.enemyId) : null;
    if (!target?.alive) {
      if (mode !== MODE.patrol) holdFire();
      mode = MODE.patrol;
      coverPoint = null;
      return null;
    }

    const distance = Math.hypot(target.x - fighter.x, target.z - fighter.z);
    if (peaceful) {
      // Мирные не воюют вовсе: они бегут от того, кто выстрелил рядом, и успокаиваются, когда
      // рядом перестают стрелять.
      if (sight.lostFor > BOT.alertSeconds) return null;
      return order(awayFrom(fighter, target, distance), { run: true, face: null });
    }

    if (mode === MODE.patrol) {
      mode = decide(fighter, 'enemySeen');
      holdFire();
    }
    if (wounded && fighter.hp < fighter.maxHp * BOT.retreatHpShare) {
      mode = decide(fighter, 'damage');
    }
    if (fighter.allyDown) {
      fighter.allyDown = false;
      mode = decide(fighter, 'allyDied');
    }

    const hasLine = sight.lostFor < LOST_LINE_SECONDS;
    // Ствол наводится и когда линия потеряна: боец продолжает держать направление, а не
    // опускает оружие на каждый угол дома.
    intent.aim = true;
    aimAt.x = target.x;
    aimAt.y = target.y + COMBAT.chestHeight;
    aimAt.z = target.z;
    fighter.aimAt = aimAt;
    intent.aimPitch = Math.atan2(
      (fighter.y + COMBAT.eyeHeight) - aimAt.y, Math.max(distance, 0.1));

    if (fighter.ammo === 0 && fighter.reloadLeft <= 0) intent.reload = true;
    const inRange = distance <= fighter.weapon.targetRange;
    intent.fire = hasLine && inRange && mode !== MODE.retreat && trigger(fighter, dt);
    if (!hasLine) holdFire();

    coverLeft -= dt;
    if (mode === MODE.retreat) {
      coverPoint = coverPoint ?? bestCover(cover, fighter, target);
      return order(coverPoint ?? awayFrom(fighter, target, distance),
                   { run: true, face: target });
    }
    if (mode === MODE.reposition || !hasLine || !inRange) {
      if (coverLeft <= 0 || !coverPoint) {
        // Отсиделся за укрытием, значит решает заново, и прежнее укрытие из выбора
        // исключается: иначе выбор детерминирован, ближайший ящик выигрывает снова, и бот
        // получает приказ идти туда, где уже стоит. Снаружи это стояние столбом.
        if (mode === MODE.reposition && hasLine) mode = decide(fighter, 'enemySeen');
        coverPoint = bestCover(cover, fighter, target, coverPoint);
        coverLeft = BOT.coverHoldSeconds;
      }
      if (mode === MODE.engage) return engage(fighter, target, distance, hasLine, dt);
      return order(coverPoint ?? circleAround(fighter, target, distance, dt),
                   { run: !hasLine, face: target });
    }

    coverPoint = null;
    return engage(fighter, target, distance, hasLine, dt);
  }

  return { think };
}
