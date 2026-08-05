import { mulberry32 } from '../terrain/heightfield.js';
import { createAnimator } from './animation.js';
import { createLook, resolveArchetype } from './archetypes.js';
import { createCharacterMaterials } from './materials.js';
import { buildSkeleton } from './rig.js';

const BUILD_SCALE_MIN = 0.96;
const BUILD_SCALE_SPREAD = 0.08;

export function buildCharacter({ archetype, seed = 0 } = {}) {
  const random = mulberry32(Math.floor(seed));
  const look = createLook(resolveArchetype(archetype, seed), random);
  const materials = createCharacterMaterials(look, random);
  const { root, joints } = buildSkeleton(materials, look);
  root.scale.setScalar(BUILD_SCALE_MIN + random() * BUILD_SCALE_SPREAD);
  const update = createAnimator(joints, random);
  return { object: root, update };
}
