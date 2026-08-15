import * as THREE from 'three';

const BODY_DENSITY = 700;
const LINEAR_DAMPING = 0.35;
const ANGULAR_DAMPING = 0.6;
// Части трупа не сталкивались между собой вовсе, поэтому нога свободно уходила внутрь груди и
// тело складывалось само в себя. Туловище и конечности разведены по двум группам: нога
// встречает грудь, но не вторую ногу, а сегменты туловища не распирают друг друга. Каждая
// группа не сталкивается сама с собой и сталкивается со всем остальным миром.
const TORSO_GROUP = 0x0002;
const LIMB_GROUP = 0x0004;
const TORSO_COLLISION_GROUPS = (TORSO_GROUP << 16) | (0xffff & ~TORSO_GROUP);
const LIMB_COLLISION_GROUPS = (LIMB_GROUP << 16) | (0xffff & ~LIMB_GROUP);
const FRICTION = 0.7;
// Толчок мерится скоростью задетой части, поэтому импульс берётся от её массы. От общей
// массы кисть весом в треть килограмма получала под сотню метров в секунду и за один шаг
// физики оказывалась под рельефом, утаскивая шарнирами половину трупа.
const IMPULSE_SPEED = 6;
const UPWARD_KICK = 0.35;
// Рельеф это трёхмерная сетка без толщины: провалившаяся сквозь неё капсула наружу уже не
// вернётся. Мягкий CCD смотрит вперёд по пути тела и стоит куда меньше полного.
const SOFT_CCD_PREDICTION = 0.3;
// Труп это 14-17 динамических тел с шарнирами, самая дорогая вещь на сцене. В перестрелке
// они появляются пачками, поэтому и потолок ниже, и улёгшиеся замораживаются.
const MAX_CORPSES = 8;
const SETTLE_SECONDS = 5;
const SETTLE_SPEED = 0.12;
const MIN_SEGMENT_LENGTH = 0.06;
const MIN_CAPSULE_HALF_HEIGHT = 0.015;
const DEFAULT_LEAF_LENGTH = 0.12;

const SLOT_RADIUS = {
  hips: 0.13,
  spine: 0.12,
  chest: 0.12,
  neck: 0.05,
  head: 0.09,
  upperArm: 0.05,
  forearm: 0.04,
  hand: 0.035,
  thigh: 0.07,
  shin: 0.055,
  foot: 0.045,
};

const LEAF_LENGTH = {
  head: 0.2,
  hand: 0.14,
  foot: 0.18,
};

const SIDED_SLOTS = new Set(['upperArm', 'forearm', 'hand', 'thigh', 'shin', 'foot']);

function classifySlot(name) {
  if (/forearm|lowerarm/.test(name)) return 'forearm';
  if (/upper_?arm|arm[._-]?[lr]$|arm$/.test(name)) return 'upperArm';
  if (/hand|wrist/.test(name)) return 'hand';
  if (/thigh|upleg|upperleg/.test(name)) return 'thigh';
  if (/shin|calf|lowerleg|leg[._-]?[lr]$|leg$/.test(name)) return 'shin';
  if (/foot|ankle/.test(name)) return 'foot';
  if (/head/.test(name)) return 'head';
  if (/neck/.test(name)) return 'neck';
  if (/chest|spine0?2|upperchest/.test(name)) return 'chest';
  if (/spine/.test(name)) return 'spine';
  if (/hips|pelvis/.test(name)) return 'hips';
  return null;
}

// Сторону в скелетах пишут по-разному: LeftHand, Hand.L, L_Hand. Последний вариант здесь не
// читался, а часть без стороны в ragdoll не попадает вовсе: руки и ноги оставались без тел и
// торчали из лежащего трупа в позе стоя, то есть наполовину уходили под рельеф.
const SIDE_LEFT = /left|l[._-]?$|(^|[^a-z])l([^a-z]|$)/;
const SIDE_RIGHT = /right|r[._-]?$|(^|[^a-z])r([^a-z]|$)/;

function sideOf(name) {
  if (SIDE_LEFT.test(name)) return 'L';
  if (SIDE_RIGHT.test(name)) return 'R';
  return '';
}

function boneDepth(bone) {
  let depth = 0;
  for (let node = bone.parent; node; node = node.parent) depth += 1;
  return depth;
}

function collectParts(bones) {
  const taken = new Set();
  const parts = [];
  for (const bone of bones) {
    const name = bone.name.toLowerCase();
    const slot = classifySlot(name);
    if (!slot) continue;
    const side = sideOf(name);
    if (SIDED_SLOTS.has(slot) && !side) continue;
    const key = SIDED_SLOTS.has(slot) ? slot + side : slot;
    if (taken.has(key)) continue;
    taken.add(key);
    parts.push({ bone, slot });
  }
  return parts.sort((a, b) => boneDepth(a.bone) - boneDepth(b.bone));
}

function findParentPart(bone, byBone) {
  for (let node = bone.parent; node && node.isBone; node = node.parent) {
    const part = byBone.get(node);
    if (part) return part;
  }
  return null;
}

function toBodyLocal(worldPoint, bodyPosition, bodyQuaternion) {
  return worldPoint
    .clone()
    .sub(bodyPosition)
    .applyQuaternion(bodyQuaternion.clone().invert());
}

function nearestPart(parts, point) {
  let best = null;
  let bestDistance = Infinity;
  for (const part of parts) {
    const distance = part.center.distanceToSquared(point);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = part;
    }
  }
  return best;
}

export function createSkinnedRagdolls({ RAPIER, physicsWorld, scene }) {
  const corpses = [];
  const workMatrix = new THREE.Matrix4();
  const parentInverse = new THREE.Matrix4();
  const workPosition = new THREE.Vector3();
  const workQuaternion = new THREE.Quaternion();
  const scratchScale = new THREE.Vector3();

  function buildPart(part) {
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    part.bone.matrixWorld.decompose(position, quaternion, scale);

    const segment = new THREE.Vector3();
    const childBone = part.bone.children.find((node) => node.isBone);
    if (childBone) {
      segment.copy(childBone.getWorldPosition(new THREE.Vector3())).sub(position);
    }
    if (segment.length() < MIN_SEGMENT_LENGTH) {
      segment
        .set(0, (LEAF_LENGTH[part.slot] ?? DEFAULT_LEAF_LENGTH) * scale.y, 0)
        .applyQuaternion(quaternion);
    }

    const radius = SLOT_RADIUS[part.slot] * scale.y;
    const halfHeight = Math.max(segment.length() / 2 - radius, MIN_CAPSULE_HALF_HEIGHT);
    const center = position.clone().addScaledVector(segment, 0.5);

    const body = physicsWorld.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(center.x, center.y, center.z)
        .setRotation(quaternion)
        .setLinearDamping(LINEAR_DAMPING)
        .setAngularDamping(ANGULAR_DAMPING)
        .setSoftCcdPrediction(SOFT_CCD_PREDICTION),
    );
    // Конечность это то, чего у тела по две, поэтому отдельного списка конечностей не нужно.
    const limb = SIDED_SLOTS.has(part.slot);
    physicsWorld.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius)
        .setDensity(BODY_DENSITY)
        .setFriction(FRICTION)
        .setCollisionGroups(limb ? LIMB_COLLISION_GROUPS : TORSO_COLLISION_GROUPS),
      body,
    );

    part.body = body;
    part.position = position;
    part.quaternion = quaternion;
    part.scale = scale;
    part.center = center;
    part.centerOffset = center.clone().sub(position).applyQuaternion(quaternion.clone().invert());
  }

  function spawn(characterRoot, { impulse, hitPoint }) {
    characterRoot.updateWorldMatrix(true, true);
    let skeleton = null;
    characterRoot.traverse((child) => {
      if (child.isSkinnedMesh) {
        skeleton ??= child.skeleton;
        child.frustumCulled = false;
      }
    });
    if (!skeleton) return false;

    const parts = collectParts(skeleton.bones);
    if (parts.length < 3) return false;

    for (const part of parts) buildPart(part);

    const byBone = new Map(parts.map((part) => [part.bone, part]));
    for (const part of parts) {
      const parentPart = findParentPart(part.bone, byBone);
      if (!parentPart) continue;
      const joint = RAPIER.JointData.spherical(
        toBodyLocal(part.position, parentPart.center, parentPart.quaternion),
        toBodyLocal(part.position, part.center, part.quaternion),
      );
      // Соседи по шарниру перекрываются по построению: бедро начинается внутри таза. Держит
      // их шарнир, и контакты им только мешают, расталкивая тело изнутри.
      physicsWorld
        .createImpulseJoint(joint, parentPart.body, part.body, true)
        .setContactsEnabled(false);
    }

    const struck =
      (hitPoint && nearestPart(parts, hitPoint)) ??
      parts.find((part) => part.slot === 'chest') ??
      parts[0];
    const kick = new THREE.Vector3(impulse.x, impulse.y + UPWARD_KICK, impulse.z)
      .normalize()
      .multiplyScalar(struck.body.mass() * IMPULSE_SPEED);
    struck.body.applyImpulse(kick, true);

    corpses.push({ root: characterRoot, parts, age: 0, frozen: false });
    if (corpses.length > MAX_CORPSES) removeCorpse(corpses.shift());
    return true;
  }

  function removeCorpse(corpse) {
    if (!corpse.frozen) {
      for (const part of corpse.parts) physicsWorld.removeRigidBody(part.body);
    }
    scene.remove(corpse.root);
  }

  /**
   * Улёгшийся труп теряет физику и остаётся позированным мешем.
   *
   * Кости уже стоят там, где их оставила симуляция, поэтому картинка не меняется вовсе, а
   * из мира уходят полтора десятка тел с шарнирами на каждого убитого. На арене с респавном
   * это главная экономия кадра.
   */
  function freeze(corpse) {
    corpse.frozen = true;
    for (const part of corpse.parts) physicsWorld.removeRigidBody(part.body);
  }

  function settled(corpse) {
    for (const part of corpse.parts) {
      const { x, y, z } = part.body.linvel();
      if (Math.hypot(x, y, z) > SETTLE_SPEED) return false;
    }
    return true;
  }

  function update(dt = 0) {
    for (const corpse of corpses) {
      if (corpse.frozen) continue;
      corpse.age += dt;
      if (corpse.age > SETTLE_SECONDS && settled(corpse)) {
        freeze(corpse);
        continue;
      }
      for (const part of corpse.parts) {
        const rotation = part.body.rotation();
        workQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
        workPosition
          .copy(part.centerOffset)
          .applyQuaternion(workQuaternion)
          .negate()
          .add(part.body.translation());

        part.bone.parent.updateWorldMatrix(true, false);
        workMatrix.compose(workPosition, workQuaternion, part.scale);
        parentInverse.copy(part.bone.parent.matrixWorld).invert();
        workMatrix.premultiply(parentInverse);
        workMatrix.decompose(part.bone.position, part.bone.quaternion, scratchScale);
      }
    }
  }

  return { spawn, update };
}
