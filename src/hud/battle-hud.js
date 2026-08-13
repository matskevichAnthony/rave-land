import * as THREE from 'three';
import { on } from '../combat/events.js';
import { teamColor, teamName } from '../combat/teams.js';
import { createKillfeed } from './killfeed.js';

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

export function createBattleHud({ camera, scoreboard, playerFighter }) {
  const root = document.querySelector('[data-battle]');
  const scoreRows = root.querySelector('[data-score]');
  const vitals = document.querySelector('[data-vitals]');
  const fill = vitals.querySelector('[data-health-fill]');
  const value = vitals.querySelector('[data-health-value]');
  const frags = vitals.querySelector('[data-frags]');
  const dead = vitals.querySelector('[data-dead]');
  const respawn = vitals.querySelector('[data-respawn]');
  const flash = document.querySelector('[data-damage-flash]');
  const arrowsRoot = document.querySelector('[data-damage-arrows]');
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
