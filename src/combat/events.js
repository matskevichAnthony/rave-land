/**
 * Крошечная шина событий боя: `shot`, `hit`, `death`, `respawn`.
 *
 * Прямые вызовы связали бы урон с киллфидом, звуком, рэгдоллами и восприятием NPC в один
 * узел. Здесь урон только сообщает, что случилось, а кто на это смотрит, решают подписчики.
 */

const handlers = new Map();

export function on(type, handler) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(handler);
}

export function emit(type, payload) {
  for (const handler of handlers.get(type) ?? []) handler(payload);
}
