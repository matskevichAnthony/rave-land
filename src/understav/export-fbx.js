import * as THREE from 'three';

/**
 * Выгрузка сцены в двоичный FBX 7.4.
 *
 * Экспортёра FBX в three нет ни в ядре, ни в адд-онах: там только загрузчик. Поэтому файл
 * пишется здесь, и пишется двоичным, а не текстом. Текстовый вариант формата собирается
 * строками и потому проще, но читают его единицы: Blender берёт только двоичный, а чужие
 * импортёры спотыкаются об текст исключением про пустую ссылку, и на руках остаётся файл,
 * который не открывается нигде.
 *
 * Устройство файла: заголовок в двадцать семь байт, дальше дерево узлов, где у каждого
 * записано смещение своего конца, а замыкает всё футер с выравниванием на шестнадцать байт.
 * Смещения абсолютные, поэтому файл пишется в один буфер с самого начала и правится на
 * месте, когда длина узла становится известна.
 *
 * Единица файла сантиметр, как принято в FBX, поэтому метры сцены умножаются на сто. Иначе
 * тридцатиметровый неф приезжает в чужую сцену размером в треть метра.
 *
 * Цвет вершин лежит слоем `LayerElementColor`, как его пишет FBX SDK. Проверять этот слой
 * обратной загрузкой в three бессмысленно: её `FBXLoader` ищет цвет не в том поле дерева и
 * берёт из файла только геометрию с нормалями. Половина цвета сцены живёт в копиях
 * инстансов, и кому он нужен наверняка, тому GLB.
 */

const FBX_MIME = 'application/octet-stream';
const FBX_VERSION = 7400;
const METRES_TO_FBX = 100;

const HEAD_MAGIC = 'Kaydara FBX Binary  \0\x1a\0';
const FOOT_ID = [0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66,
  0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e];
const FOOT_MAGIC = [0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e,
  0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b];
const FOOT_ZEROS = 120;
const ALIGNMENT = 16;
// Конец списка вложенных узлов это пустая запись: три нулевых поля и нулевая длина имени.
const NULL_RECORD = 13;

// Идентификаторы узлов в FBX сквозные и произвольные, важна только их несхожесть.
const FIRST_ID = 1000000;
const ROOT_ID = 0;
const DOCUMENT_ID = FIRST_ID - 1;
const KINDS_PER_PART = 3;

// Дата в заголовке обязательна по формату и ни на что не влияет, а сид обязан давать
// одинаковый файл, поэтому она не «сейчас», а одна и та же.
const STAMP = { year: 2026, month: 1, day: 1 };

// В двоичном FBX имя объекта записано задом наперёд и склеено двумя байтами вместо «::».
const objectName = (kind, name) => `${name}\0\x01${kind}`;

// Цвет в FBX читают как sRGB, а в сцене он линейный.
const toSRGB = (color) => color.clone().convertLinearToSRGB();

const I = (value) => ({ type: 'I', value });
const D = (value) => ({ type: 'D', value });
const L = (value) => ({ type: 'L', value });
const S = (value) => ({ type: 'S', value });
const C = (value) => ({ type: 'C', value });
const doubles = (value) => ({ type: 'd', value });
const ints = (value) => ({ type: 'i', value });

const node = (name, props = [], children = []) => ({ name, props, children });

/** Строка блока Properties70: имя, два типа, флаг и сами значения. */
const property70 = (name, type, flag, values) => node('P', [
  S(name), S(type), S(''), S(flag), ...values,
]);

function createWriter() {
  let bytes = new Uint8Array(1 << 16);
  let view = new DataView(bytes.buffer);
  let length = 0;

  function ensure(extra) {
    if (length + extra <= bytes.length) return;
    let size = bytes.length;
    while (size < length + extra) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(bytes.subarray(0, length));
    bytes = grown;
    view = new DataView(bytes.buffer);
  }

  return {
    get length() {
      return length;
    },
    u8(value) {
      ensure(1);
      view.setUint8(length, value);
      length += 1;
    },
    u32(value) {
      ensure(4);
      view.setUint32(length, value, true);
      length += 4;
    },
    i32(value) {
      ensure(4);
      view.setInt32(length, value, true);
      length += 4;
    },
    f64(value) {
      ensure(8);
      view.setFloat64(length, value, true);
      length += 8;
    },
    i64(value) {
      ensure(8);
      view.setBigInt64(length, BigInt(value), true);
      length += 8;
    },
    text(value) {
      ensure(value.length);
      for (let at = 0; at < value.length; at += 1) {
        view.setUint8(length + at, value.charCodeAt(at));
      }
      length += value.length;
    },
    raw(values) {
      ensure(values.length);
      bytes.set(values, length);
      length += values.length;
    },
    zeros(count) {
      ensure(count);
      bytes.fill(0, length, length + count);
      length += count;
    },
    patchU32(at, value) {
      view.setUint32(at, value, true);
    },
    take() {
      return bytes.slice(0, length);
    },
  };
}

function writeProperty(writer, { type, value }) {
  writer.u8(type.charCodeAt(0));
  if (type === 'C') return writer.u8(value ? 1 : 0);
  if (type === 'I') return writer.i32(value);
  if (type === 'D') return writer.f64(value);
  if (type === 'L') return writer.i64(value);
  if (type === 'S') {
    writer.u32(value.length);
    return writer.text(value);
  }
  const wide = type === 'd';
  writer.u32(value.length);
  // Массив разрешено сжать дефлейтом, но несжатый читают все, а вес файла тут не главное.
  writer.u32(0);
  writer.u32(value.length * (wide ? 8 : 4));
  for (const item of value) {
    if (wide) writer.f64(item);
    else writer.i32(item);
  }
  return undefined;
}

/** Узел с потомками. Смещение конца известно только после записи, поэтому его правят. */
function writeNode(writer, item) {
  const endAt = writer.length;
  writer.u32(0);
  writer.u32(item.props.length);
  const sizeAt = writer.length;
  writer.u32(0);
  writer.u8(item.name.length);
  writer.text(item.name);

  const propsAt = writer.length;
  for (const prop of item.props) writeProperty(writer, prop);
  writer.patchU32(sizeAt, writer.length - propsAt);

  if (item.children.length > 0) {
    for (const child of item.children) writeNode(writer, child);
    writer.zeros(NULL_RECORD);
  }
  writer.patchU32(endAt, writer.length);
}

function writeFile(nodes) {
  const writer = createWriter();
  writer.text(HEAD_MAGIC);
  writer.u32(FBX_VERSION);
  for (const item of nodes) writeNode(writer, item);
  writer.zeros(NULL_RECORD);

  writer.raw(FOOT_ID);
  writer.zeros(4);
  // Выравнивание на шестнадцать байт, а ровно выровненный футер получает ещё полный шаг:
  // так пишет FBX SDK, и чужие импортёры ищут магию именно на этом месте.
  const aligned = ((writer.length + ALIGNMENT - 1) & ~(ALIGNMENT - 1)) - writer.length;
  writer.zeros(aligned === 0 ? ALIGNMENT : aligned);
  writer.u32(FBX_VERSION);
  writer.zeros(FOOT_ZEROS);
  writer.raw(FOOT_MAGIC);
  return writer.take();
}

function header(creator) {
  return node('FBXHeaderExtension', [], [
    node('FBXHeaderVersion', [I(1003)]),
    node('FBXVersion', [I(FBX_VERSION)]),
    node('EncryptionType', [I(0)]),
    node('CreationTimeStamp', [], [
      node('Version', [I(1000)]),
      node('Year', [I(STAMP.year)]),
      node('Month', [I(STAMP.month)]),
      node('Day', [I(STAMP.day)]),
      node('Hour', [I(0)]),
      node('Minute', [I(0)]),
      node('Second', [I(0)]),
      node('Millisecond', [I(0)]),
    ]),
    node('Creator', [S(creator)]),
  ]);
}

function globalSettings() {
  return node('GlobalSettings', [], [
    node('Version', [I(1000)]),
    node('Properties70', [], [
      property70('UpAxis', 'int', 'Integer', [I(1)]),
      property70('UpAxisSign', 'int', 'Integer', [I(1)]),
      property70('FrontAxis', 'int', 'Integer', [I(2)]),
      property70('FrontAxisSign', 'int', 'Integer', [I(1)]),
      property70('CoordAxis', 'int', 'Integer', [I(0)]),
      property70('CoordAxisSign', 'int', 'Integer', [I(1)]),
      property70('UnitScaleFactor', 'double', 'Number', [D(1)]),
    ]),
  ]);
}

function documents(creator) {
  return node('Documents', [], [
    node('Count', [I(1)]),
    node('Document', [L(DOCUMENT_ID), S(creator), S('Scene')], [
      node('Properties70', [], []),
      node('RootNode', [L(ROOT_ID)]),
    ]),
  ]);
}

function definitions(parts) {
  const kinds = ['Geometry', 'Model', 'Material'];
  return node('Definitions', [], [
    node('Version', [I(100)]),
    node('Count', [I(parts.length * KINDS_PER_PART + 1)]),
    node('ObjectType', [S('GlobalSettings')], [node('Count', [I(1)])]),
    ...kinds.map((kind) => node('ObjectType', [S(kind)], [node('Count', [I(parts.length)])])),
  ]);
}

/** Вершины и грани: у последнего угла грани индекс инвертируют, так формат и метит конец. */
function polygonIndices(geometry) {
  const index = geometry.getIndex();
  const count = index ? index.count : geometry.getAttribute('position').count;
  const list = new Array(count);
  for (let corner = 0; corner < count; corner += 1) {
    const vertex = index ? index.getX(corner) : corner;
    list[corner] = corner % 3 === 2 ? -(vertex + 1) : vertex;
  }
  return list;
}

/** Значения по углам граней: нормали и цвет в FBX лежат не по вершине, а по углу. */
function byCorner(geometry, attribute, size) {
  const source = geometry.getAttribute(attribute);
  if (!source) return null;
  const index = geometry.getIndex();
  const count = index ? index.count : source.count;
  const list = [];
  for (let corner = 0; corner < count; corner += 1) {
    const vertex = index ? index.getX(corner) : corner;
    list.push(source.getX(vertex), source.getY(vertex), source.getZ(vertex));
    if (size === 4) list.push(1);
  }
  return list;
}

function layerElement(type, values, name) {
  return node(type, [I(0)], [
    node('Version', [I(101)]),
    node('Name', [S('')]),
    node('MappingInformationType', [S('ByPolygonVertex')]),
    node('ReferenceInformationType', [S('Direct')]),
    node(name, [doubles(values)]),
  ]);
}

function geometryNode(part, id) {
  const position = part.geometry.getAttribute('position');
  const vertices = [];
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    vertices.push(
      position.getX(vertex) * METRES_TO_FBX,
      position.getY(vertex) * METRES_TO_FBX,
      position.getZ(vertex) * METRES_TO_FBX,
    );
  }
  const normals = byCorner(part.geometry, 'normal', 3);
  const colors = byCorner(part.geometry, 'color', 4);

  const layers = [];
  const children = [
    node('Vertices', [doubles(vertices)]),
    node('PolygonVertexIndex', [ints(polygonIndices(part.geometry))]),
    node('GeometryVersion', [I(124)]),
  ];
  if (normals) {
    layers.push('LayerElementNormal');
    children.push(layerElement('LayerElementNormal', normals, 'Normals'));
  }
  if (colors) {
    layers.push('LayerElementColor');
    children.push(layerElement('LayerElementColor', colors, 'Colors'));
  }
  layers.push('LayerElementMaterial');
  children.push(node('LayerElementMaterial', [I(0)], [
    node('Version', [I(101)]),
    node('Name', [S('')]),
    node('MappingInformationType', [S('AllSame')]),
    node('ReferenceInformationType', [S('IndexToDirect')]),
    node('Materials', [ints([0])]),
  ]));
  children.push(node('Layer', [I(0)], [
    node('Version', [I(100)]),
    ...layers.map((type) => node('LayerElement', [], [
      node('Type', [S(type)]),
      node('TypedIndex', [I(0)]),
    ])),
  ]));

  return node('Geometry', [L(id), S(objectName('Geometry', part.name)), S('Mesh')], children);
}

function modelNode(part, id) {
  return node('Model', [L(id), S(objectName('Model', part.name)), S('Mesh')], [
    node('Version', [I(232)]),
    node('Properties70', [], [
      property70('Lcl Translation', 'Lcl Translation', 'A', [D(0), D(0), D(0)]),
    ]),
    node('Shading', [C(true)]),
    node('Culling', [S('CullingOff')]),
  ]);
}

function materialNode(part, id) {
  const material = part.material;
  const diffuse = toSRGB(material.color ?? new THREE.Color(1, 1, 1));
  const glow = toSRGB((material.emissive ?? new THREE.Color(0, 0, 0)).clone()
    .multiplyScalar(material.emissiveIntensity ?? 1));
  return node('Material', [L(id), S(objectName('Material', part.name)), S('')], [
    node('Version', [I(102)]),
    node('ShadingModel', [S('phong')]),
    node('MultiLayer', [I(0)]),
    node('Properties70', [], [
      property70('DiffuseColor', 'Color', 'A', [D(diffuse.r), D(diffuse.g), D(diffuse.b)]),
      property70('EmissiveColor', 'Color', 'A', [D(glow.r), D(glow.g), D(glow.b)]),
      property70('Opacity', 'double', 'Number', [D(material.opacity ?? 1)]),
    ]),
  ]);
}

/**
 * FBX из готовых частей сцены.
 *
 * `parts` это `{ name, geometry, material }` уже в мировых координатах: сам файл держит все
 * узлы плоским списком под корнем, и своих преобразований у них нет.
 */
export function writeFbx(parts, stem) {
  const creator = `UNDERSTAV ${stem}`;
  const objects = [];
  const links = [];

  parts.forEach((part, order) => {
    const geometryId = FIRST_ID + order * KINDS_PER_PART;
    const modelId = geometryId + 1;
    const materialId = geometryId + 2;
    objects.push(
      geometryNode(part, geometryId),
      modelNode(part, modelId),
      materialNode(part, materialId),
    );
    links.push(
      node('C', [S('OO'), L(modelId), L(ROOT_ID)]),
      node('C', [S('OO'), L(geometryId), L(modelId)]),
      node('C', [S('OO'), L(materialId), L(modelId)]),
    );
  });

  const file = writeFile([
    header(creator),
    globalSettings(),
    documents(creator),
    node('References', [], []),
    definitions(parts),
    node('Objects', [], objects),
    node('Connections', [], links),
    node('Takes', [], [node('Current', [S('')])]),
  ]);

  return [{ name: `${stem}.fbx`, blob: new Blob([file], { type: FBX_MIME }) }];
}
