// GLB shrink pass: resample animations, dedup, prune, downsize textures to webp, quantize.
// No draco/meshopt: the app's GLTFLoader has no decoders; KHR_mesh_quantization and
// EXT_texture_webp are supported natively.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup, prune, quantize, resample, textureCompress,
} from '@gltf-transform/functions';
import sharp from 'sharp';

const BASE_COLOR_SIZE = 512;
const AUX_TEXTURE_SIZE = 256;

const [input, output] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(input);

await document.transform(
  resample(),
  dedup(),
  prune(),
  textureCompress({
    encoder: sharp,
    targetFormat: 'webp',
    resize: [BASE_COLOR_SIZE, BASE_COLOR_SIZE],
    slots: /baseColor/,
  }),
  textureCompress({
    encoder: sharp,
    targetFormat: 'webp',
    resize: [AUX_TEXTURE_SIZE, AUX_TEXTURE_SIZE],
    slots: /^(?!.*baseColor).*$/,
  }),
  quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeTexcoord: 12 }),
);

await io.write(output, document);
console.log('written', output);
