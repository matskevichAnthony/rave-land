import * as THREE from 'three';

/**
 * Выгрузка сцены в OBJ с попутным MTL.
 *
 * Свой писатель, а не `OBJExporter` из адд-онов, по двум причинам. Половина цвета этой сцены
 * живёт в цвете вершин (инстансы красятся именно им, другого места у них нет), а штатный
 * экспортёр цвет вершин не пишет вовсе. И материалов он тоже не пишет: наружу уходит голая
 * геометрия, то есть зал одного цвета. Формат при этом простой настолько, что своя реализация
 * короче обхода чужой.
 *
 * Файла всегда два: сам OBJ и MTL рядом с ним. Имя MTL записано внутрь OBJ строкой `mtllib`,
 * поэтому переименовывать их порознь нельзя, они найдут друг друга только по этому имени.
 */

const OBJ_MIME = 'text/plain';
// В OBJ и MTL цвет читают как sRGB, а в сцене он линейный: без перевода зал уходит белёсым.
const toSRGB = (color) => color.clone().convertLinearToSRGB();

/** Цвет вершины, если он есть: у сцены им покрашены копии инстансов. */
function vertexColorAt(colors, index, draft) {
  if (!colors) return null;
  draft.setRGB(colors.getX(index), colors.getY(index), colors.getZ(index));
  return toSRGB(draft);
}

function writeVertices(lines, geometry) {
  const position = geometry.getAttribute('position');
  const colors = geometry.getAttribute('color');
  const draft = new THREE.Color();
  for (let index = 0; index < position.count; index += 1) {
    const tint = vertexColorAt(colors, index, draft);
    const place = `v ${position.getX(index)} ${position.getY(index)} ${position.getZ(index)}`;
    lines.push(tint ? `${place} ${tint.r} ${tint.g} ${tint.b}` : place);
  }
  return position.count;
}

function writeNormals(lines, geometry) {
  const normal = geometry.getAttribute('normal');
  if (!normal) return 0;
  for (let index = 0; index < normal.count; index += 1) {
    lines.push(`vn ${normal.getX(index)} ${normal.getY(index)} ${normal.getZ(index)}`);
  }
  return normal.count;
}

/**
 * Грани в OBJ считаются от единицы и сквозным счётом по всему файлу, а не по мешу.
 *
 * Счёт вершин и счёт нормалей ведутся порознь: геометрия без нормалей ничего не добавляет
 * ко второму, и одним общим счётчиком все следующие грани сослались бы на чужие нормали.
 */
function writeFaces(lines, geometry, base, normalBase) {
  const index = geometry.getIndex();
  const count = index ? index.count : geometry.getAttribute('position').count;
  const at = (corner) => (index ? index.getX(corner) : corner);
  for (let corner = 0; corner < count; corner += 3) {
    const face = [at(corner), at(corner + 1), at(corner + 2)].map((vertex) => (
      normalBase === null ? String(vertex + base) : `${vertex + base}//${vertex + normalBase}`
    ));
    lines.push(`f ${face.join(' ')}`);
  }
}

function materialLines(materials) {
  const lines = ['# UNDERSTAV'];
  for (const [name, material] of materials) {
    const diffuse = toSRGB(material.color ?? new THREE.Color(1, 1, 1));
    lines.push(
      `newmtl ${name}`,
      `Kd ${diffuse.r} ${diffuse.g} ${diffuse.b}`,
      'Ka 0 0 0',
      'illum 2',
    );
    if (material.emissive) {
      const glow = toSRGB(material.emissive.clone().multiplyScalar(material.emissiveIntensity ?? 1));
      lines.push(`Ke ${glow.r} ${glow.g} ${glow.b}`);
    }
    if (material.opacity < 1) lines.push(`d ${material.opacity}`);
    lines.push('');
  }
  return lines;
}

/**
 * OBJ и MTL из готовых частей сцены.
 *
 * `parts` это `{ name, geometry, material }` уже в мировых координатах: складывать матрицы
 * писателю формата нечем и незачем, этим занят тот, кто сцену запекал.
 */
export function writeObj(parts, stem) {
  const names = new Map();
  const lines = ['# UNDERSTAV', `mtllib ${stem}.mtl`];
  let base = 1;
  let normalBase = 1;

  for (const part of parts) {
    if (!names.has(part.material)) names.set(part.material, `mat-${names.size}`);
    lines.push(`o ${part.name}`, `usemtl ${names.get(part.material)}`);
    const vertices = writeVertices(lines, part.geometry);
    const normals = writeNormals(lines, part.geometry);
    writeFaces(lines, part.geometry, base, normals > 0 ? normalBase : null);
    base += vertices;
    normalBase += normals;
  }

  const materials = [...names].map(([material, name]) => [name, material]);
  return [
    { name: `${stem}.obj`, blob: new Blob([lines.join('\n')], { type: OBJ_MIME }) },
    {
      name: `${stem}.mtl`,
      blob: new Blob([materialLines(materials).join('\n')], { type: OBJ_MIME }),
    },
  ];
}
