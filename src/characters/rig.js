import * as THREE from 'three';

export const SPINE_BASE_Y = 1.0;
export const LEG_LENGTH = 0.81;

const PELVIS_Y = 0.92;
const NECK_LOCAL_Y = 0.46;
const SHOULDER_X = 0.25;
const SHOULDER_LOCAL_Y = 0.4;
const ELBOW_LOCAL_Y = -0.31;
const HAND_LOCAL_Y = -0.3;
const HIP_X = 0.1;
const HIP_Y = 0.88;
const KNEE_LOCAL_Y = -0.41;
const FOOT_LOCAL_Y = -0.4;

const FACE_REGION = [0, 0, 0.5, 1];
const BACK_REGION = [0.5, 0, 1, 1];
const CHIN_REGION = [0.55, 0.02, 0.95, 0.3];
const TORSO_FRONT_REGION = [0, 0, 1 / 3, 1];
const TORSO_BACK_REGION = [1 / 3, 0, 2 / 3, 1];
const TORSO_SIDE_REGION = [2 / 3, 0, 1, 1];
const PANTS_PLAIN_REGION = [0, 0, 0.5, 1];
const PANTS_STRIPE_REGION = [0.5, 0, 1, 1];

const PANTS_REGIONS = {
  px: PANTS_STRIPE_REGION,
  nx: PANTS_STRIPE_REGION,
  py: PANTS_PLAIN_REGION,
  ny: PANTS_PLAIN_REGION,
  pz: PANTS_PLAIN_REGION,
  nz: PANTS_PLAIN_REGION,
};

const PANTS_PLAIN_REGIONS = {
  px: PANTS_PLAIN_REGION,
  nx: PANTS_PLAIN_REGION,
  py: PANTS_PLAIN_REGION,
  ny: PANTS_PLAIN_REGION,
  pz: PANTS_PLAIN_REGION,
  nz: PANTS_PLAIN_REGION,
};

const geometryCache = new Map();

function remapBoxUvs(geometry, regions) {
  const { widthSegments, heightSegments, depthSegments } = geometry.parameters;
  const counts = [
    (depthSegments + 1) * (heightSegments + 1),
    (depthSegments + 1) * (heightSegments + 1),
    (widthSegments + 1) * (depthSegments + 1),
    (widthSegments + 1) * (depthSegments + 1),
    (widthSegments + 1) * (heightSegments + 1),
    (widthSegments + 1) * (heightSegments + 1),
  ];
  const faceNames = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  const uv = geometry.attributes.uv;
  let offset = 0;
  faceNames.forEach((face, index) => {
    const region = regions[face];
    if (region) {
      const [u0, v0, u1, v1] = region;
      for (let i = offset; i < offset + counts[index]; i += 1) {
        uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
      }
    }
    offset += counts[index];
  });
}

function taper(geometry, bottomScale, topScale) {
  const position = geometry.attributes.position;
  const height = geometry.parameters.height;
  for (let i = 0; i < position.count; i += 1) {
    const t = position.getY(i) / height + 0.5;
    const scale = bottomScale + (topScale - bottomScale) * t;
    position.setX(i, position.getX(i) * scale);
    position.setZ(i, position.getZ(i) * scale);
  }
  geometry.computeVertexNormals();
}

function box(width, height, depth, widthSegments = 1, heightSegments = 1, depthSegments = 1) {
  return new THREE.BoxGeometry(width, height, depth, widthSegments, heightSegments, depthSegments);
}

const PART_BUILDERS = {
  torso() {
    const geometry = box(0.4, 0.48, 0.24, 2, 2, 2);
    taper(geometry, 0.94, 1.1);
    geometry.translate(0, 0.2, 0);
    remapBoxUvs(geometry, {
      px: TORSO_SIDE_REGION,
      nx: TORSO_SIDE_REGION,
      py: TORSO_SIDE_REGION,
      ny: TORSO_SIDE_REGION,
      pz: TORSO_FRONT_REGION,
      nz: TORSO_BACK_REGION,
    });
    return geometry;
  },
  pelvis() {
    const geometry = box(0.36, 0.18, 0.23);
    taper(geometry, 0.92, 1.02);
    remapBoxUvs(geometry, PANTS_PLAIN_REGIONS);
    return geometry;
  },
  head() {
    const geometry = box(0.21, 0.27, 0.23);
    taper(geometry, 0.9, 1);
    geometry.translate(0, 0.15, 0);
    remapBoxUvs(geometry, {
      px: BACK_REGION,
      nx: BACK_REGION,
      py: BACK_REGION,
      ny: CHIN_REGION,
      pz: FACE_REGION,
      nz: BACK_REGION,
    });
    return geometry;
  },
  hairCap() {
    const geometry = box(0.24, 0.09, 0.25);
    taper(geometry, 1, 0.9);
    return geometry;
  },
  hairFlap() {
    return box(0.22, 0.24, 0.06);
  },
  hood() {
    const geometry = box(0.29, 0.31, 0.28);
    taper(geometry, 0.94, 0.88);
    return geometry;
  },
  upperArm() {
    const geometry = box(0.11, 0.32, 0.11, 1, 2, 1);
    taper(geometry, 0.88, 1);
    geometry.translate(0, -0.16, 0);
    return geometry;
  },
  forearm() {
    const geometry = box(0.09, 0.3, 0.09, 1, 2, 1);
    taper(geometry, 0.85, 1);
    geometry.translate(0, -0.15, 0);
    return geometry;
  },
  hand() {
    const geometry = box(0.07, 0.1, 0.09);
    geometry.translate(0, -0.05, 0);
    return geometry;
  },
  thigh() {
    const geometry = box(0.16, 0.44, 0.17, 1, 2, 1);
    taper(geometry, 0.82, 1);
    geometry.translate(0, -0.22, 0);
    remapBoxUvs(geometry, PANTS_REGIONS);
    return geometry;
  },
  shin() {
    const geometry = box(0.13, 0.4, 0.14, 1, 2, 1);
    taper(geometry, 0.78, 1);
    geometry.translate(0, -0.2, 0);
    remapBoxUvs(geometry, PANTS_REGIONS);
    return geometry;
  },
  foot() {
    const geometry = box(0.12, 0.07, 0.26);
    geometry.translate(0, -0.035, 0.06);
    return geometry;
  },
};

function partGeometry(name) {
  if (!geometryCache.has(name)) geometryCache.set(name, PART_BUILDERS[name]());
  return geometryCache.get(name);
}

function partMesh(name, material) {
  const mesh = new THREE.Mesh(partGeometry(name), material);
  mesh.castShadow = true;
  return mesh;
}

function attachHeadGear(neck, materials, look) {
  if (look.hood) {
    const hood = partMesh('hood', materials.hood);
    hood.position.set(0, 0.17, -0.045);
    neck.add(hood);
    return;
  }
  if (look.hairStyle === 'short' || look.hairStyle === 'long') {
    const cap = partMesh('hairCap', materials.hair);
    cap.position.set(0, 0.31, -0.01);
    neck.add(cap);
  }
  if (look.hairStyle === 'long') {
    const flap = partMesh('hairFlap', materials.hair);
    flap.position.set(0, 0.18, -0.13);
    neck.add(flap);
  }
}

function buildArm(spine, materials, side) {
  const shoulder = new THREE.Group();
  shoulder.position.set(SHOULDER_X * side, SHOULDER_LOCAL_Y, 0);
  spine.add(shoulder);
  shoulder.add(partMesh('upperArm', materials.sleeve));

  const elbow = new THREE.Group();
  elbow.position.y = ELBOW_LOCAL_Y;
  shoulder.add(elbow);
  elbow.add(partMesh('forearm', materials.sleeve));

  const hand = partMesh('hand', materials.hand);
  hand.position.y = HAND_LOCAL_Y;
  elbow.add(hand);

  return { shoulder, elbow };
}

function buildLeg(root, materials, side) {
  const hip = new THREE.Group();
  hip.position.set(HIP_X * side, HIP_Y, 0);
  root.add(hip);
  hip.add(partMesh('thigh', materials.thigh));

  const knee = new THREE.Group();
  knee.position.y = KNEE_LOCAL_Y;
  hip.add(knee);
  knee.add(partMesh('shin', materials.shin));

  const foot = partMesh('foot', materials.shoe);
  foot.position.y = FOOT_LOCAL_Y;
  knee.add(foot);

  return { hip, knee };
}

export function buildSkeleton(materials, look) {
  const root = new THREE.Group();

  const pelvis = partMesh('pelvis', materials.thigh);
  pelvis.position.y = PELVIS_Y;
  root.add(pelvis);

  const spine = new THREE.Group();
  spine.position.y = SPINE_BASE_Y;
  root.add(spine);
  spine.add(partMesh('torso', materials.torso));

  const neck = new THREE.Group();
  neck.position.y = NECK_LOCAL_Y;
  spine.add(neck);
  neck.add(partMesh('head', materials.head));
  attachHeadGear(neck, materials, look);

  const armL = buildArm(spine, materials, -1);
  const armR = buildArm(spine, materials, 1);
  const legL = buildLeg(root, materials, -1);
  const legR = buildLeg(root, materials, 1);

  return {
    root,
    joints: {
      spine,
      neck,
      shoulderL: armL.shoulder,
      shoulderR: armR.shoulder,
      elbowL: armL.elbow,
      elbowR: armR.elbow,
      hipL: legL.hip,
      hipR: legR.hip,
      kneeL: legL.knee,
      kneeR: legR.knee,
    },
  };
}
