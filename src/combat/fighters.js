import { COMBAT } from '../config.js';
import { fireCycle } from './weapons.js';

/**
 * Реестр бойцов и машина их состояний. Игрок и боты живут здесь на равных.
 *
 * Запись бойца это простые данные: ни THREE, ни DOM, ни физики. Правило одно, и оно держит
 * весь бой: hp, стойку и патроны нельзя прочитать нигде, кроме реестра. Отображение и
 * анимация только читают, а пишут сюда шаг боя и урон.
 *
 * Выстрел и попадание это таймеры, а не состояния: стрелять можно на ходу и в прицеле
 * одновременно, а реакция на попадание не должна отбирать управление.
 */

export const PLAYER_ID = 'player';

export const STANCE = {
  unarmed: 'unarmed',
  armed: 'armed',
  aiming: 'aiming',
  reloading: 'reloading',
  dead: 'dead',
};

function emptyIntent() {
  return { aim: false, fire: false, reload: false, aimPitch: 0 };
}

/**
 * Патроны в стволе и в запасе.
 *
 * Нижняя граница запаса нужна дробовику: магазин у него один патрон, и пять магазинов это
 * пять выстрелов на весь бой.
 */
function magazineFor(weapon) {
  return {
    ammo: weapon.magazine,
    reserve: Math.max(weapon.magazine * COMBAT.reserveMagazines, COMBAT.minReserve),
  };
}

export function createFighters() {
  const byId = new Map();
  // Список бойцов держится рядом с картой, а не собирается заново на каждый запрос: его
  // спрашивают в каждом шаге боя и на каждый выстрел, а мусорщик тут заметен глазом.
  const roster = [];
  const fired = [];

  function add({ id, team, name, weapon, maxHp = COMBAT.maxHp, isPlayer = false, seed = 1 }) {
    const fighter = {
      id, team, name, weapon, isPlayer, seed,
      maxHp, hp: maxHp, alive: true,
      stance: STANCE.unarmed,
      ...magazineFor(weapon),
      fireCooldown: 0, reloadLeft: 0, flinchLeft: 0, respawnLeft: 0, aimedFor: 0,
      shotId: 0, reloadId: 0, hitT: 0, dryFired: false, reloadStarted: false,
      x: 0, y: 0, z: 0, yaw: 0, speed: 0, aimPitch: 0,
      // Куда наведён ствол и не упал ли рядом свой: пишет мозг и арена, читают мозг и NPC.
      aimAt: null, allyDown: false,
      intent: emptyIntent(),
    };
    byId.set(id, fighter);
    roster.push(fighter);
    return fighter;
  }

  function remove(id) {
    const fighter = byId.get(id);
    if (!fighter) return;
    byId.delete(id);
    roster.splice(roster.indexOf(fighter), 1);
  }

  /** Поднять бойца после смерти: патроны и здоровье как у нового, место даёт вызывающий. */
  function revive(fighter, { x, y, z }) {
    Object.assign(fighter, magazineFor(fighter.weapon));
    fighter.hp = fighter.maxHp;
    fighter.alive = true;
    fighter.stance = STANCE.armed;
    fighter.respawnLeft = 0;
    fighter.flinchLeft = 0;
    fighter.hitT = 0;
    fighter.aimAt = null;
    fighter.allyDown = false;
    fighter.reloadLeft = 0;
    fighter.fireCooldown = 0;
    fighter.x = x;
    fighter.y = y;
    fighter.z = z;
  }

  function beginReload(fighter) {
    if (!fighter.weapon.flags.reload || fighter.reloadLeft > 0) return;
    if (fighter.ammo >= fighter.weapon.magazine || fighter.reserve <= 0) return;
    fighter.reloadLeft = COMBAT.reloadSeconds;
    fighter.reloadId += 1;
    fighter.reloadStarted = true;
    fighter.stance = STANCE.reloading;
  }

  function finishReload(fighter) {
    const taken = Math.min(fighter.weapon.magazine - fighter.ammo, fighter.reserve);
    fighter.ammo += taken;
    fighter.reserve -= taken;
  }

  /**
   * Дробовику магазин набивается сам.
   *
   * Флага RELOAD у него нет и клипа перезарядки тоже: патрон досылается внутри самого
   * выстрела, поэтому ждать нечего, кроме конца цикла.
   */
  function chamberNext(fighter) {
    if (fighter.weapon.flags.reload || fighter.fireCooldown > 0) return;
    finishReload(fighter);
  }

  function stanceFor(fighter, intent) {
    if (!fighter.alive) return STANCE.dead;
    if (fighter.reloadLeft > 0) return STANCE.reloading;
    if (!intent.aim) return STANCE.armed;
    // Разрешение целиться на ходу это свойство ствола и уровня умения, а не персонажа.
    const moving = fighter.speed > COMBAT.movingThreshold;
    if (moving && !fighter.weapon.flags.moveAim) return STANCE.armed;
    return fighter.weapon.flags.canAim ? STANCE.aiming : STANCE.armed;
  }

  function canFire(fighter) {
    if (fighter.fireCooldown > 0 || fighter.reloadLeft > 0 || !fighter.alive) return false;
    if (fighter.speed > COMBAT.runningThreshold && !fighter.weapon.flags.moveFire) return false;
    return fighter.stance === STANCE.aiming;
  }

  // Щелчок по пустому и лязг перезарядки это отметки одного шага: их снимает следующий шаг,
  // иначе звук повторится на каждом кадре, пока флаг висит.
  function tickTimers(fighter, dt) {
    fighter.dryFired = false;
    fighter.reloadStarted = false;
    fighter.fireCooldown = Math.max(0, fighter.fireCooldown - dt);
    fighter.flinchLeft = Math.max(0, fighter.flinchLeft - dt);
    fighter.hitT = fighter.flinchLeft / COMBAT.flinchSeconds;
  }

  /**
   * Шаг боя: таймеры, стойка, спуск. Возвращает тех, у кого в этом шаге вылетела пуля.
   *
   * Сам выстрел здесь не решается: реестру нечем спросить у мира, во что попала пуля.
   * Он списывает патрон и двигает счётчик клипа, а луч кладёт арена.
   */
  function step(dt) {
    fired.length = 0;
    for (const fighter of roster) {
      tickTimers(fighter, dt);
      if (!fighter.alive) {
        fighter.respawnLeft = Math.max(0, fighter.respawnLeft - dt);
        fighter.stance = STANCE.dead;
        continue;
      }
      if (fighter.reloadLeft > 0) {
        fighter.reloadLeft = Math.max(0, fighter.reloadLeft - dt);
        if (!fighter.reloadLeft) finishReload(fighter);
      }
      chamberNext(fighter);

      const { intent } = fighter;
      fighter.aimPitch = intent.aimPitch;
      fighter.stance = stanceFor(fighter, intent);
      fighter.aimedFor = fighter.stance === STANCE.aiming ? fighter.aimedFor + dt : 0;
      if (intent.reload) beginReload(fighter);

      if (!intent.fire || !canFire(fighter)) continue;
      if (!fighter.ammo) {
        beginReload(fighter);
        // Щелчок по пустому патроннику идёт в темпе стрельбы, а не каждый шаг под зажатой
        // кнопкой: иначе из пустого ствола сыплется треск тридцать раз в секунду.
        fighter.fireCooldown = fireCycle(fighter.weapon);
        fighter.dryFired = true;
        continue;
      }
      fighter.ammo -= 1;
      fighter.shotId += 1;
      fighter.fireCooldown = fireCycle(fighter.weapon);
      fired.push(fighter);
    }
    return fired;
  }

  return {
    add,
    remove,
    revive,
    step,
    get: (id) => byId.get(id) ?? null,
    all: () => roster,
  };
}
