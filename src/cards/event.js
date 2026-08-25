/**
 * Событие UNDERSTAV под карточки: та же схема, что читает сцена, плюс поля на артиста.
 *
 * `lineup` остаётся списком строк, потому что это единственный источник порядка и написания
 * имён и его читают три модуля сцены. Город, время сета и роль лежат отдельной картой
 * `artists`, где ключ это имя из `lineup`: второй список имён рядом с первым разъехался бы
 * на первой же правке.
 */

const NUMBER_PAD = 2;

export async function loadEvent() {
  const response = await fetch('understav.json');
  if (!response.ok) throw new Error(`understav.json не отдался: ${response.status}`);
  const event = await response.json();
  if (!Array.isArray(event.lineup) || !event.lineup.length) {
    throw new Error('understav.json без лайнапа: карточки собирать не из чего');
  }
  return event;
}

/**
 * Карточка на артиста. Подпись собирается здесь, а не в шаблоне направления: все три
 * направления печатают одну и ту же строку, и правило её сборки обязано быть одно.
 */
export function artistCards(event) {
  return event.lineup.map((name, index) => {
    const extra = event.artists?.[name] ?? {};
    return {
      name,
      number: String(index + 1).padStart(NUMBER_PAD, '0'),
      set: extra.set ?? '',
      credit: [extra.role, extra.city].filter(Boolean).join(' · '),
    };
  });
}
