import { scanInventory } from './scan.js';

/** Опись как файл сайта: в разработке её собирает запрос, в сборке она пишется один раз.
 *
 * Держать её на диске нельзя: любой инструмент, пишущий рядом свою опись,
 * рано или поздно затрёт чужие записи. Здесь затирать нечего, ассет попадает в
 * опись просто потому, что он лежит на диске, и страница видит его сразу после
 * перезагрузки, без пересборки и без ручных действий.
 */

const ROUTE = '/assets/inventory.json';
const FILE = ROUTE.slice(1);

export function assetInventory() {
  return {
    name: 'rave-land-inventory',

    configureServer(server) {
      server.middlewares.use(ROUTE, (_request, response) => {
        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end(JSON.stringify(scanInventory()));
      });
    },

    generateBundle() {
      this.emitFile({ type: 'asset', fileName: FILE, source: `${JSON.stringify(scanInventory(), null, 2)}\n` });
    },
  };
}
