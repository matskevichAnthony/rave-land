import { NEON_COLORS } from '../config.js';
import { mulberry32 } from '../terrain/heightfield.js';

const ARCHETYPE_PICK_SALT = 0x51ed;

function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

function hsl(hue, saturation, lightness) {
  return `hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`;
}

function raverLook(random) {
  const accent = pick(random, NEON_COLORS);
  return {
    archetype: 'raver',
    skin: hsl(20 + random() * 12, 16 + random() * 8, 58 + random() * 10),
    hair: random() < 0.5 ? accent : hsl(250 + random() * 60, 30, 16),
    hairStyle: pick(random, ['short', 'buzz', 'short']),
    top: hsl(220 + random() * 80, 14 + random() * 8, 17 + random() * 8),
    topStyle: pick(random, ['shirt', 'hoodie']),
    pants: hsl(230 + random() * 40, 12, 15 + random() * 7),
    shoe: hsl(0, 0, 17 + random() * 8),
    sole: hsl(45, 8, 52),
    accent,
    glow: true,
    lips: null,
    eyeShadow: 0.35,
    dirt: 0.25,
    hood: false,
    bandage: false,
    blood: false,
    faceShadow: false,
    strap: false,
  };
}

function gothLook(random) {
  const accent = random() < 0.35 ? pick(random, NEON_COLORS) : null;
  return {
    archetype: 'goth',
    skin: hsl(260, 6, 72 + random() * 6),
    hair: hsl(270, 12, 4 + random() * 4),
    hairStyle: 'long',
    top: hsl(260 + random() * 40, 10 + random() * 6, 11 + random() * 5),
    topStyle: pick(random, ['jacket', 'shirt']),
    pants: hsl(270, 9, 10 + random() * 5),
    shoe: hsl(0, 0, 12),
    sole: hsl(0, 0, 24),
    accent,
    glow: accent !== null,
    lips: hsl(285 + random() * 30, 28, 15 + random() * 8),
    eyeShadow: 0.6,
    dirt: 0.2,
    hood: false,
    bandage: false,
    blood: false,
    faceShadow: false,
    strap: false,
  };
}

function stalkerLook(random) {
  return {
    archetype: 'stalker',
    skin: hsl(28, 14, 52 + random() * 8),
    hair: hsl(30, 12, 12),
    hairStyle: 'none',
    top: hsl(70 + random() * 50, 12 + random() * 8, 21 + random() * 7),
    topStyle: pick(random, ['hoodie', 'jacket']),
    pants: hsl(30 + random() * 30, 12, 19 + random() * 6),
    shoe: hsl(28, 18, 22),
    sole: hsl(30, 10, 32),
    accent: null,
    glow: false,
    lips: null,
    eyeShadow: 0.5,
    dirt: 0.85,
    hood: true,
    bandage: false,
    blood: false,
    faceShadow: true,
    strap: true,
  };
}

function medicLook(random) {
  return {
    archetype: 'medic',
    skin: hsl(80 + random() * 30, 8, 62 + random() * 6),
    hair: hsl(30, 10, 14),
    hairStyle: 'buzz',
    top: hsl(48 + random() * 12, 10 + random() * 6, 58 + random() * 8),
    topStyle: 'coat',
    pants: hsl(170 + random() * 20, 14, 24 + random() * 6),
    shoe: hsl(0, 0, 18),
    sole: hsl(0, 0, 28),
    accent: null,
    glow: false,
    lips: null,
    eyeShadow: 0.55,
    dirt: 0.6,
    hood: false,
    bandage: true,
    blood: true,
    faceShadow: false,
    strap: false,
  };
}

const ARCHETYPE_LOOKS = {
  raver: raverLook,
  goth: gothLook,
  stalker: stalkerLook,
  medic: medicLook,
};

const ARCHETYPE_NAMES = Object.keys(ARCHETYPE_LOOKS);

export function resolveArchetype(archetype, seed) {
  if (archetype in ARCHETYPE_LOOKS) return archetype;
  const roll = mulberry32(Math.floor(seed) + ARCHETYPE_PICK_SALT)();
  return ARCHETYPE_NAMES[Math.floor(roll * ARCHETYPE_NAMES.length)];
}

export function createLook(archetype, random) {
  return ARCHETYPE_LOOKS[archetype](random);
}
