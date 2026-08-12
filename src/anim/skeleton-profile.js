import * as THREE from 'three';

/**
 * Реестр скелетов: рантайм-аналог BONE_MAPS из tools/anim/retarget.py.
 *
 * Персонажи приходят из разных источников (свой авториг на 17 костей, модели GTA на 32),
 * и у них не совпадает ни одно имя кости. Поэтому игровой код не знает ни имён костей, ни
 * имён клипов: он спрашивает роль, а профиль отвечает, чем эта роль закрыта у конкретной
 * модели. Новый источник ассетов добавляется записью здесь и больше нигде.
 */

// GLTFLoader прогоняет имена узлов через sanitizeNodeName: пробелы становятся
// подчёркиванием, точки и двоеточия удаляются. Поэтому наш 'hand.R' в сцене зовётся
// 'handR', а гташный 'R Hand' зовётся 'R_Hand'.
const PROFILES = [
  {
    id: 'gta_sa',
    detect: ['R_Hand', 'Spine1', 'Pelvis'],
    bones: {
      hips: 'Pelvis', spine: 'Spine', chest: 'Spine1', neck: 'Neck', head: 'Head',
      armR: 'R_UpperArm', handR: 'R_Hand', handL: 'L_Hand', footR: 'R_Foot', footL: 'L_Foot',
    },
    lower: ['Root', 'Pelvis',
            'R_Thigh', 'R_Calf', 'R_Foot', 'R_Toe0',
            'L_Thigh', 'L_Calf', 'L_Foot', 'L_Toe0'],
    roles: {
      idle: [/^IDLE_stance$/, /^Idle_Gang1$/, /idle/i],
      walk: [/^WALK_civi$/, /^WALK_/],
      run: [/^run_civi$/, /\brun_/],
      sprint: [/^sprint_civi$/, /\bsprint_/],
      armedIdle: [/^IDLE_armed$/],
      // Две стойки стоя с оружием, и они не взаимозаменяемы: gang_gunstand это выпрямленная
      // рука с завалом пистолета набок, Gun_stand это двуручное удержание корпусом (F-050).
      gangStand: [/^gang_gunstand$/],
      gunStand: [/^Gun_stand$/],
      armedWalk: [/^WALK_armed$/],
      crouchAim: [/^WEAPON_crouch$/],
      aimWalkF: [/^GunMove_FWD$/],
      aimWalkB: [/^GunMove_BWD$/],
      aimWalkL: [/^GunMove_L$/],
      aimWalkR: [/^GunMove_R$/],
      armedRun: [/^run_armed$/],
      jumpLaunch: [/^JUMP_launch$/],
      jumpGlide: [/^JUMP_glide$/, /^FALL_glide$/],
      jumpLand: [/^JUMP_land$/, /^FALL_land$/],
      hitPartial: [/^SHOT_partial$/],
      death: [/^KO_shot_front$/, /^FALL_collapse$/],
      dance: [/^IDLE_HBHB$/, /dance/i],
    },
  },
  {
    id: 'rig17',
    detect: ['hips', 'chest', 'handR'],
    bones: {
      hips: 'hips', spine: 'spine', chest: 'chest', neck: 'neck', head: 'head',
      armR: 'upper_armR', handR: 'handR', handL: 'handL', footR: 'footR', footL: 'footL',
    },
    lower: ['hips', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'],
    roles: {
      idle: [/^Idle$/i, /idle|stand|breath/i],
      walk: [/^Walk$/i, /walk/i],
      run: [/^Run$/i, /\brun|\bjog/i],
      sprint: [/\bsprint/i],
      aimPose: [/^AimIdle$/i, /aim/i],
      dance: [/dance/i],
    },
  },
];

// Скелет незнакомого источника: имён костей не знаем, поэтому масок нет и слои
// недоступны, но локомоция и танец по общим регуляркам находятся.
const GENERIC = {
  id: 'generic',
  detect: [],
  bones: {},
  lower: [],
  roles: {
    idle: [/idle|stand|breath/i],
    walk: [/walk/i],
    run: [/\brun|\bsprint|\bjog/i],
    aimPose: [/aim/i],
    dance: [/dance/i],
  },
};

export function detectProfile(root) {
  const present = new Set();
  root.traverse((child) => {
    if (child.isBone) present.add(child.name);
  });
  const found = PROFILES.find((profile) => profile.detect.every((bone) => present.has(bone)));
  return found ?? GENERIC;
}

export function findBone(root, profile, role) {
  const name = profile.bones[role];
  return name ? root.getObjectByName(name) ?? null : null;
}

export function findClip(animations, profile, role) {
  for (const pattern of profile.roles[role] ?? []) {
    const clip = animations.find((candidate) => pattern.test(candidate.name));
    if (clip) return clip;
  }
  return null;
}

/** Кости, которых касается клип. Имя трека это '<кость>.<свойство>'. */
export function bonesOfClip(clip) {
  return new Set(clip.tracks.map(
    (track) => THREE.PropertyBinding.parseTrackName(track.name).nodeName));
}

/**
 * Пара непересекающихся наборов костей для нижнего и верхнего слоя.
 *
 * Верх выводится из клипа, а не перечисляется: у моделей одного источника набор костей
 * различается (лицевые и мягкие кости есть не у всех), а вычитание нижних из фактических
 * даёт верные наборы для любой. Таз идёт в нижний слой: он несёт качание бёдер и подскок
 * шага, без него верхняя половина плывёт относительно ног.
 */
export function splitMasks(profile, clip) {
  const lower = new Set(profile.lower);
  if (!lower.size) return null;
  const upper = new Set();
  for (const bone of bonesOfClip(clip)) {
    if (!lower.has(bone)) upper.add(bone);
  }
  return upper.size ? { lower, upper } : null;
}
