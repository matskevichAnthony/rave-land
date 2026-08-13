import { COMBAT } from '../config.js';
import { emit } from './events.js';
import { canDamage } from './teams.js';

/**
 * Единственная дверь к чужому здоровью.
 *
 * Всё, что убавляет hp, проходит здесь: и пуля игрока, и пуля бота. Дальше только события,
 * поэтому киллфид, счёт, рэгдолл и тревога у соседей подписываются, а не вызываются.
 */
export function applyDamage(fighters, { attackerId, targetId, zone, weapon, direction, point }) {
  const target = fighters.get(targetId);
  const attacker = fighters.get(attackerId);
  if (!target?.alive || !attacker) return null;
  if (!canDamage(attacker.team, target.team)) return null;

  const amount = weapon.damage * zone.factor;
  target.hp = Math.max(0, target.hp - amount);
  target.flinchLeft = COMBAT.flinchSeconds;
  emit('hit', { attacker, target, zone, amount, point, direction });

  if (target.hp > 0) return { killed: false };
  target.alive = false;
  target.respawnLeft = COMBAT.respawnSeconds;
  emit('death', { attacker, target, zone, point, direction });
  return { killed: true };
}
