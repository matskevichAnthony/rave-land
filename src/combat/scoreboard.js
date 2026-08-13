import { FIGHTING_TEAMS } from './teams.js';
import { on } from './events.js';

/** Счёт по фракциям и личные фраги. Считается по событиям, никого ни о чём не спрашивая. */
export function createScoreboard() {
  const frags = new Map(FIGHTING_TEAMS.map((team) => [team, 0]));
  const personal = new Map();
  const listeners = new Set();

  on('death', ({ attacker, target }) => {
    if (frags.has(attacker.team)) frags.set(attacker.team, frags.get(attacker.team) + 1);
    personal.set(attacker.id, (personal.get(attacker.id) ?? 0) + 1);
    for (const listener of listeners) listener({ attacker, target });
  });

  return {
    onChange: (listener) => listeners.add(listener),
    fragsOf: (id) => personal.get(id) ?? 0,
    teams: () => [...frags].map(([team, score]) => ({ team, score })),
  };
}
