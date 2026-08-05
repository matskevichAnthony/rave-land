import * as THREE from 'three';
import {
  paintHair,
  paintHand,
  paintHead,
  paintHood,
  paintPants,
  paintShoe,
  paintSleeve,
  paintTorso,
} from './textures.js';

const NEON_EMISSIVE_INTENSITY = 0.55;

function toMaterial({ map, emissiveMap }) {
  const material = new THREE.MeshLambertMaterial({ map });
  if (emissiveMap) {
    material.emissiveMap = emissiveMap;
    material.emissive = new THREE.Color('#ffffff');
    material.emissiveIntensity = NEON_EMISSIVE_INTENSITY;
  }
  return material;
}

export function createCharacterMaterials(look, random) {
  return {
    head: toMaterial(paintHead(look, random)),
    hair: toMaterial(paintHair(look, random)),
    torso: toMaterial(paintTorso(look, random)),
    sleeve: toMaterial(paintSleeve(look, random)),
    hand: toMaterial(paintHand(look, random)),
    thigh: toMaterial(paintPants(look, random, { belt: true })),
    shin: toMaterial(paintPants(look, random, { hem: true })),
    shoe: toMaterial(paintShoe(look, random)),
    hood: look.hood ? toMaterial(paintHood(look, random)) : null,
  };
}
