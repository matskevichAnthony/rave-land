import * as THREE from 'three';
import { mulberry32 } from './heightfield.js';

const COLOR_SAND = new THREE.Color('#8a7a55');
const COLOR_GRASS = new THREE.Color('#3c6b4a');
const COLOR_HIGH = new THREE.Color('#6a6577');
const COLOR_ROCK = new THREE.Color('#5c5566');
const ROCK_SLOPE_NORMAL_Y = 0.72;

function pickFaceColor(avgHeight, normalY, amplitude, target) {
  if (normalY < ROCK_SLOPE_NORMAL_Y) return target.copy(COLOR_ROCK);
  if (avgHeight < amplitude * -0.2) return target.copy(COLOR_SAND);
  if (avgHeight > amplitude * 0.45) return target.copy(COLOR_HIGH);
  return target.copy(COLOR_GRASS);
}

export function buildTerrainMesh(params, heightAt) {
  const { size, resolution, amplitude } = params;
  const geometry = new THREE.PlaneGeometry(size, size, resolution, resolution);
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i += 1) {
    positions.setY(i, heightAt(positions.getX(i), positions.getZ(i)));
  }

  const colliderVertices = new Float32Array(positions.array);
  const colliderIndices = new Uint32Array(geometry.index.array);

  const flat = geometry.toNonIndexed();
  flat.computeVertexNormals();

  const flatPositions = flat.attributes.position;
  const flatNormals = flat.attributes.normal;
  const colors = new Float32Array(flatPositions.count * 3);
  const faceColor = new THREE.Color();
  const jitterRandom = mulberry32(params.seed + 1);

  for (let face = 0; face < flatPositions.count / 3; face += 1) {
    const i = face * 3;
    const avgHeight =
      (flatPositions.getY(i) + flatPositions.getY(i + 1) + flatPositions.getY(i + 2)) / 3;
    const avgNormalY =
      (flatNormals.getY(i) + flatNormals.getY(i + 1) + flatNormals.getY(i + 2)) / 3;

    pickFaceColor(avgHeight, avgNormalY, amplitude, faceColor);
    faceColor.multiplyScalar(0.92 + jitterRandom() * 0.16);

    for (let v = 0; v < 3; v += 1) {
      colors[(i + v) * 3] = faceColor.r;
      colors[(i + v) * 3 + 1] = faceColor.g;
      colors[(i + v) * 3 + 2] = faceColor.b;
    }
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 1,
  });
  const mesh = new THREE.Mesh(flat, material);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';

  geometry.dispose();
  return { mesh, colliderVertices, colliderIndices };
}
