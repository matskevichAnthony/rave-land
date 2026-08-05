export const TERRAIN_DEFAULTS = {
  seed: 7,
  size: 160,
  resolution: 120,
  amplitude: 12,
  plateauRadius: 18,
};

export const PLAYER = {
  walkSpeed: 4.5,
  runSpeed: 8,
  jumpSpeed: 8,
  gravity: -24,
  spawn: { x: 0, z: 21 },
  appearance: { src: 'assets/models/character-animated.glb' },
};

export const CAMERA = {
  fov: 60,
  near: 0.1,
  far: 700,
  followHeight: 1.4,
  startDistance: 9,
};

export const BLOOM = {
  strength: 0.55,
  radius: 0.4,
  threshold: 0.85,
};

export const MAX_LAMP_LIGHTS = 8;

export const NEON_COLORS = ['#ff2fd6', '#00ffd0', '#7b5cff', '#ffe14d', '#00a8ff'];

export const STORAGE_KEY = 'rave-land-world';
