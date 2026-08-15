import * as THREE from 'three';
import { on } from '../combat/events.js';
import { teamColor, teamName } from '../combat/teams.js';
import { createKillfeed } from './killfeed.js';
import { ensure } from '../ui/dom.js';

/**
 * Что игрок должен видеть про бой: своё здоровье, откуда прилетело и как идёт счёт.
 *
 * Указатель направления важнее всего остального: в перестрелке от третьего лица попадание в
 * спину иначе не читается вовсе, и смерть выглядит случайной. Поэтому на каждое попадание по
 * игроку зажигается стрелка в сторону стрелявшего, а экран коротко вспыхивает.
 */

const ARROW_COUNT = 4;
const ARROW_SECONDS = 1.4;
const FLASH_SECONDS = 0.35;
const HEALTH_LOW_SHARE = 0.35;

const BATTLE_MARKUP = `
  <div class="battle" data-battle hidden>
    <div class="battle__title">Перестрелка</div>
    <div class="battle__score" data-score></div>
  </div>
`;

const VITALS_MARKUP = `
  <div class="vitals" data-vitals hidden>
    <div class="vitals__bar"><span class="vitals__fill" data-health-fill></span></div>
    <div class="vitals__line">
      <b class="vitals__hp" data-health-value>100</b>
      <span class="vitals__frags">фраги <b data-frags>0</b></span>
    </div>
    <div class="vitals__dead" data-dead hidden>
      Тебя убили. Возрождение через <b data-respawn>5</b>
    </div>
  </div>
`;

// Слой попаданий берётся целиком: сквозной клик и обрезка по краям кадра держатся на обёртке,
// а без неё вспышка накрыла бы страницу и съела мышь.
const DAMAGE_MARKUP = `
  <div class="damage" aria-hidden="true">
    <span class="damage__flash" data-damage-flash></span>
    <div class="damage__arrows" data-damage-arrows></div>
  </div>
`;

export function createBattleHud({ camera, scoreboard, playerFighter }) {
  const root = ensure('[data-battle]', BATTLE_MARKUP);
  const scoreRows = root.querySelector('[data-score]');
  const vitals = ensure('[data-vitals]', VITALS_MARKUP);
  const fill = vitals.querySelector('[data-health-fill]');
  const value = vitals.querySelector('[data-health-value]');
  const frags = vitals.querySelector('[data-frags]');
  const dead = vitals.querySelector('[data-dead]');
  const respawn = vitals.querySelector('[data-respawn]');
  const damage = ensure('.damage', DAMAGE_MARKUP);
  const flash = damage.querySelector('[data-damage-flash]');
  const arrowsRoot = damage.querySelector('[data-damage-arrows]');
  const killfeed = createKillfeed();

  const arrows = Array.from({ length: ARROW_COUNT }, () => {
    const element = document.createElement('span');
    element.className = 'damage__arrow';
    element.hidden = true;
    arrowsRoot.append(element);
    return { element, left: 0 };
  });
  const rows = new Map();
  const forward = new THREE.Vector3();
  const shown = { hp: null, frags: null, alive: null, respawn: null };
  let nextArrow = 0;
  let flashLeft = 0;

  function buildScore() {
    scoreRows.replaceChildren();
    rows.clear();
    for (const { team } of scoreboard.teams()) {
      const row = document.createElement('div');
      row.className = 'battle__row';
      const label = document.createElement('span');
      label.textContent = teamName(team);
      label.style.color = teamColor(team);
      const count = document.createElement('b');
      count.textContent = '0';
      row.append(label, count);
      scoreRows.append(row);
      rows.set(team, count);
    }
  }

  function refreshScore() {
    for (const { team, score } of scoreboard.teams()) {
      const cell = rows.get(team);
      if (cell && cell.textContent !== String(score)) cell.textContent = score;
    }
  }

  /** Стрелка в сторону стрелявшего, в системе экрана: ноль это прямо перед камерой. */
  function pointAt(attacker) {
    camera.getWorldDirection(forward);
    const view = Math.atan2(forward.x, forward.z);
    const bearing = Math.atan2(attacker.x - playerFighter.x, attacker.z - playerFighter.z);
    const arrow = arrows[nextArrow];
    nextArrow = (nextArrow + 1) % arrows.length;
    arrow.element.style.setProperty('--damage-angle', `${(bearing - view).toFixed(3)}rad`);
    arrow.element.hidden = false;
    arrow.left = ARROW_SECONDS;
  }

  on('hit', ({ target, attacker }) => {
    if (target !== playerFighter) return;
    pointAt(attacker);
    flashLeft = FLASH_SECONDS;
    flash.classList.add('damage__flash--on');
  });

  scoreboard.onChange(({ attacker, target }) => {
    killfeed.push(attacker, target);
    refreshScore();
  });

  function update(dt) {
    if (flashLeft > 0) {
      flashLeft -= dt;
      if (flashLeft <= 0) flash.classList.remove('damage__flash--on');
    }
    for (const arrow of arrows) {
      if (arrow.left <= 0) continue;
      arrow.left -= dt;
      arrow.element.style.opacity = Math.min(1, arrow.left / ARROW_SECONDS).toFixed(2);
      if (arrow.left <= 0) arrow.element.hidden = true;
    }

    const hp = Math.round(playerFighter.hp);
    if (hp !== shown.hp) {
      shown.hp = hp;
      value.textContent = hp;
      fill.style.width = `${(hp / playerFighter.maxHp) * 100}%`;
      vitals.classList.toggle('vitals--low', hp <= playerFighter.maxHp * HEALTH_LOW_SHARE);
    }
    const score = scoreboard.fragsOf(playerFighter.id);
    if (score !== shown.frags) {
      shown.frags = score;
      frags.textContent = score;
    }
    if (playerFighter.alive !== shown.alive) {
      shown.alive = playerFighter.alive;
      dead.hidden = playerFighter.alive;
    }
    const left = Math.ceil(playerFighter.respawnLeft);
    if (!playerFighter.alive && left !== shown.respawn) {
      shown.respawn = left;
      respawn.textContent = left;
    }
  }

  buildScore();

  return {
    update,
    setActive(active) {
      root.hidden = !active;
      vitals.hidden = !active;
      if (active) return;
      flash.classList.remove('damage__flash--on');
      for (const arrow of arrows) {
        arrow.left = 0;
        arrow.element.hidden = true;
      }
    },
  };
}
