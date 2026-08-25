/**
 * Диффузия: два вещества, которые сами себя съедают и сами себя воспроизводят.
 *
 * Это Грей-Скотт, реакция-диффузия. Пятна, кораллы, лабиринты и точки здесь никем не
 * нарисованы: они устойчивые состояния системы из двух уравнений, и весь вид кадра решают
 * два числа, скорость подачи и скорость убыли. Соседние значения дают несовместимые миры,
 * и что именно вырастет, видно только после прогона.
 *
 * Считается на мелкой сетке и растягивается на кадр: сотня проходов по холсту афиши в
 * полный размер это десятки секунд, а по сетке в двести клеток это доли.
 */

const GRID_WIDTH = 210;
// Шагов много намеренно: на сотне система только-только расходится от зародышей, а узор,
// ради которого её и берут, встаёт ближе к трёмстам.
const STEPS = [200, 330];
// Пары «подача, убыль» из живых зон карты Грея-Скотта: между ними система вырождается в
// ровное поле, поэтому берём не диапазон, а известные точки с небольшим разбросом. Самые
// медленные зоны выброшены: на трёх сотнях шагов они не успевают выйти за зародыши, и афиша
// получается пустой.
const RECIPES = [
  [0.037, 0.06],
  [0.03, 0.062],
  [0.025, 0.06],
  [0.039, 0.058],
  [0.026, 0.051],
  [0.034, 0.0618],
];
const JITTER = 0.0015;
const DIFFUSE_A = 1;
const DIFFUSE_B = 0.5;
const SEEDS = [6, 16];
const SEED_RADIUS = [6, 20];
// Помимо пятен поле засевается очень редким шумом целиком: узор тогда начинается и вдали
// от пятен. Посев щедрее сотой доли клеток систему убивает: вещество съедает само себя
// раньше, чем успевает сложиться в рисунок, и кадр остаётся пустым.
const SEED_NOISE = [0.0006, 0.004];

function laplace(field, index, width) {
  return (
    field[index - 1] + field[index + 1] + field[index - width] + field[index + width]
    + (field[index - width - 1] + field[index - width + 1]
      + field[index + width - 1] + field[index + width + 1]) * 0.25
  ) / 5 - field[index];
}

export default {
  id: 'diffusion',
  label: 'Диффузия',
  grow(ctx, frame, random, palette) {
    const width = GRID_WIDTH;
    const height = Math.round((GRID_WIDTH * frame.height) / frame.width);
    const cells = width * height;
    const a = new Float32Array(cells).fill(1);
    const b = new Float32Array(cells);
    const [feedBase, killBase] = random.pick(RECIPES);
    const feed = feedBase + random.range(-JITTER, JITTER);
    const kill = killBase + random.range(-JITTER, JITTER);

    const sprinkle = random.range(SEED_NOISE[0], SEED_NOISE[1]);
    for (let index = width + 1; index < cells - width - 1; index += 1) {
      if (random() < sprinkle) b[index] = 1;
    }

    for (let spot = 0; spot < random.int(SEEDS[0], SEEDS[1]); spot += 1) {
      const centreX = random.int(0, width - 1);
      const centreY = random.int(0, height - 1);
      const radius = random.int(SEED_RADIUS[0], SEED_RADIUS[1]);
      for (let y = Math.max(1, centreY - radius); y < Math.min(height - 1, centreY + radius); y += 1) {
        for (let x = Math.max(1, centreX - radius); x < Math.min(width - 1, centreX + radius); x += 1) {
          b[y * width + x] = 1;
        }
      }
    }

    // Буферы меняются местами, а не копируются: копирование двух полей на каждом шаге
    // стоило столько же, сколько сам счёт реакции.
    let liveA = a;
    let liveB = b;
    let nextA = new Float32Array(a);
    let nextB = new Float32Array(b);
    for (let step = random.int(STEPS[0], STEPS[1]); step > 0; step -= 1) {
      for (let index = width + 1; index < cells - width - 1; index += 1) {
        const reaction = liveA[index] * liveB[index] * liveB[index];
        nextA[index] = liveA[index] + DIFFUSE_A * laplace(liveA, index, width)
          - reaction + feed * (1 - liveA[index]);
        nextB[index] = liveB[index] + DIFFUSE_B * laplace(liveB, index, width)
          + reaction - (kill + feed) * liveB[index];
      }
      [liveA, nextA] = [nextA, liveA];
      [liveB, nextB] = [nextB, liveB];
    }

    const grid = ctx.canvas.ownerDocument.createElement('canvas');
    grid.width = width;
    grid.height = height;
    const paint = grid.getContext('2d');
    const picture = paint.createImageData(width, height);
    const ink = hexToBytes(random.pick(palette));
    const back = hexToBytes(random.pick(palette));
    // Вещество растягивается на весь размах, а не делится на единицу: у плотных рецептов
    // оно стоит высоко везде, и постоянный множитель заливал кадр одной краской вместо
    // узора, а у редких еле отрывалось от нуля и терялось в фоне.
    let peak = 0;
    let floorLevel = Infinity;
    for (let index = 0; index < cells; index += 1) {
      peak = Math.max(peak, liveB[index]);
      floorLevel = Math.min(floorLevel, liveB[index]);
    }
    const span = Math.max(peak - floorLevel, 1e-6);
    for (let index = 0; index < cells; index += 1) {
      const level = Math.min(1, Math.max(0, (liveB[index] - floorLevel) / span));
      const mix = level * level * (3 - 2 * level);
      const at = index * 4;
      picture.data[at] = back[0] + (ink[0] - back[0]) * mix;
      picture.data[at + 1] = back[1] + (ink[1] - back[1]) * mix;
      picture.data[at + 2] = back[2] + (ink[2] - back[2]) * mix;
      picture.data[at + 3] = Math.round(255 * Math.min(1, mix * 1.4));
    }
    paint.putImageData(picture, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(grid, 0, 0, frame.width, frame.height);
  },
};

function hexToBytes(hex) {
  const clean = hex.replace('#', '');
  return [0, 1, 2].map((channel) => Number.parseInt(clean.slice(channel * 2, channel * 2 + 2), 16));
}
