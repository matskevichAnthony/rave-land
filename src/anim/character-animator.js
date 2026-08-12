import * as THREE from 'three';
import { bonesOfClip, findBone, findClip, splitMasks } from './skeleton-profile.js';

/**
 * Поза персонажа из слоёв клипов плюс процедурный доворот корпуса.
 *
 * AnimationMixer не умеет масок по костям, а веса тут не помогают: два экшена с весом 0.5
 * на одну кость дают усреднённую позу, а не «ноги от походки, руки от прицела». Поэтому
 * маска это подмножество треков: из клипа собирается новый клип только с нужными костями,
 * и два таких экшена с весом 1 складываются точно, потому что каждую кость пишет ровно один.
 */

const FADE_SECONDS = 0.18;
const WALK_THRESHOLD = 0.1;
const RUN_THRESHOLD = 3;
const SPRINT_THRESHOLD = 6.5;
// Скорость, на которую снят клип: измерена по корневому перемещению в ped.ifp (F-037).
// Клип проигрывается тем быстрее, чем быстрее едет персонаж, иначе стопы проскальзывают.
const CLIP_SPEED = { walk: 1.52, run: 4.3, sprint: 6.3 };
const TIME_SCALE_LIMIT = { min: 0.45, max: 1.8 };
const STRAFE_DOMINANCE = 0.5;
// Доворот раскладывается по позвоночнику. Руки не трогаются: их держит клип оружия,
// и доворот поверх него ломает хват. Голову тоже, иначе взгляд уезжает от прицела.
const AIM_SHARE = { spine: 0.35, chest: 0.65 };
const AIM_YAW_LIMIT = THREE.MathUtils.degToRad(25);
const AIM_PITCH_LIMIT = THREE.MathUtils.degToRad(35);
const HIT_PITCH = THREE.MathUtils.degToRad(20);

// Производные клипы (маски, статичные позы) считаются один раз на модель: массив animations
// у GLTFLoader общий для всех экземпляров, а AnimationAction у каждого свой.
const derivedCache = new WeakMap();

function maskedClip(clip, mask, id) {
  const tracks = clip.tracks.filter(
    (track) => mask.has(THREE.PropertyBinding.parseTrackName(track.name).nodeName));
  return tracks.length ? new THREE.AnimationClip(`${clip.name}@${id}`, clip.duration, tracks) : null;
}

/**
 * Клип без костей, которые забирает слой выше.
 *
 * Два экшена, пишущих одну кость с весом 1, дают среднее, то есть движение вполсилы.
 * Поэтому под частичный клип стрельбы у стойки вычитаются ровно его кости: наборы снова
 * не пересекаются, и каждую кость пишет ровно один экшен.
 */
function withoutBones(clip, exclude) {
  const tracks = clip.tracks.filter(
    (track) => !exclude.has(THREE.PropertyBinding.parseTrackName(track.name).nodeName));
  return tracks.length ? new THREE.AnimationClip(`${clip.name}-minus`, clip.duration, tracks) : null;
}

/** Одна поза вместо цикла: для верхнего слоя этого достаточно и дешевле цикла. */
function frozenClip(clip, mask) {
  const masked = maskedClip(clip, mask, 'upper');
  if (!masked) return null;
  const frozen = masked.clone();
  frozen.name = `${clip.name}@pose`;
  for (const track of frozen.tracks) {
    const stride = track.values.length / track.times.length;
    track.times = new Float32Array([0]);
    track.values = track.values.slice(0, stride);
  }
  frozen.duration = 0;
  return frozen;
}

function buildDerived(animations, profile) {
  const clips = {};
  for (const role of Object.keys(profile.roles)) clips[role] = findClip(animations, profile, role);

  const reference = clips.walk ?? clips.idle ?? animations[0];
  const masks = reference ? splitMasks(profile, reference) : null;
  const lower = {};
  let aimPose = null;
  if (masks) {
    for (const role of ['idle', 'walk', 'run']) {
      if (clips[role]) lower[role] = maskedClip(clips[role], masks.lower, 'lower');
    }
    const poseSource = clips.aimPose ?? clips.armedIdle;
    if (poseSource) aimPose = frozenClip(poseSource, masks.upper);
  }
  // Полные прицельные клипы это лучший вариант: клип авторский и целостный, маскировать
  // нечего. Маски нужны только тем персонажам, у которых такого клипа нет.
  const directionalAim = Boolean(clips.aimWalkF && clips.armedIdle);
  return { clips, masks, lower, aimPose, directionalAim };
}

function derivedFor(animations, profile) {
  let byProfile = derivedCache.get(animations);
  if (!byProfile) derivedCache.set(animations, byProfile = new Map());
  if (!byProfile.has(profile.id)) byProfile.set(profile.id, buildDerived(animations, profile));
  return byProfile.get(profile.id);
}

function dominantDirection(moveDir) {
  if (!moveDir) return 'forward';
  if (Math.abs(moveDir.z) >= Math.abs(moveDir.x)) {
    return moveDir.z < -STRAFE_DOMINANCE ? 'back' : 'forward';
  }
  return moveDir.x > 0 ? 'right' : 'left';
}

export function createCharacterAnimator({ model, animations, profile }) {
  const mixer = new THREE.AnimationMixer(model);
  const derived = derivedFor(animations, profile);
  const actions = new Map();
  const layers = { base: null, overlay: null };
  let lastShotId = 0;
  const aimBones = Object.entries(AIM_SHARE)
    .map(([role, share]) => ({ bone: findBone(model, profile, role), share }))
    .filter((entry) => entry.bone);
  const scratch = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const parentRotation = new THREE.Quaternion();

  function actionFor(clip, { once = false } = {}) {
    if (!clip) return null;
    if (!actions.has(clip)) {
      const action = mixer.clipAction(clip);
      if (once) {
        action.loop = THREE.LoopOnce;
        action.clampWhenFinished = true;
      }
      actions.set(clip, action);
    }
    return actions.get(clip);
  }

  function setLayer(name, clip, { timeScale = 1, once = false } = {}) {
    const next = actionFor(clip, { once });
    if (next) next.timeScale = timeScale;
    const current = layers[name];
    if (next === current) return;
    if (next) next.reset().setEffectiveWeight(1).fadeIn(FADE_SECONDS).play();
    if (current) current.fadeOut(FADE_SECONDS);
    layers[name] = next;
  }

  const { clips, lower, aimPose, directionalAim } = derived;
  const byName = new Map(animations.map((clip) => [clip.name, clip]));
  const trimmed = new Map();

  /**
   * Стойка без костей, которые забирает клип оружия.
   *
   * Ключ кеша это пара «стойка и клип оружия»: у пистолета выстрел трогает 7 костей, у
   * автомата 15, поэтому одна и та же стойка обрезается по-разному.
   */
  function stanceUnder(clip, weaponClip) {
    if (!clip || !weaponClip) return clip;
    const key = `${clip.name}|${weaponClip.name}`;
    if (!trimmed.has(key)) {
      trimmed.set(key, withoutBones(clip, bonesOfClip(weaponClip)) ?? clip);
    }
    return trimmed.get(key);
  }

  function locomotionRole(speed) {
    if (speed > SPRINT_THRESHOLD && clips.sprint) return 'sprint';
    if (speed > RUN_THRESHOLD) return clips.run ? 'run' : 'walk';
    if (speed > WALK_THRESHOLD) return clips.walk ? 'walk' : 'idle';
    return 'idle';
  }

  function paceOf(role, speed) {
    const authored = CLIP_SPEED[role];
    if (!authored) return 1;
    return THREE.MathUtils.clamp(speed / authored, TIME_SCALE_LIMIT.min, TIME_SCALE_LIMIT.max);
  }

  function locomotion(speed) {
    const role = locomotionRole(speed);
    return { clip: clips[role] ?? clips.idle, timeScale: paceOf(role, speed) };
  }

  function plan(pose) {
    if (pose.dead && clips.death) return { base: clips.death, overlay: null, once: true };
    if (pose.airborne) {
      const jump = pose.jumpTime < 0.2 ? clips.jumpLaunch : clips.jumpGlide;
      if (jump) return { base: jump, overlay: null };
    }
    if (pose.landing && clips.jumpLand) return { base: clips.jumpLand, overlay: null, once: true };
    if (pose.dancing && clips.dance) return { base: clips.dance, overlay: null };

    if (!pose.aiming) {
      const { clip, timeScale } = locomotion(pose.speed);
      return { base: clip, overlay: null, timeScale };
    }

    if (directionalAim) {
      // Стоя это Gun_stand: одна кадровая прицельная поза, ровно как в игре. IDLE_armed
      // это расслабленное удержание, оно годится когда оружие в руках, но цель не взята.
      if (pose.speed <= WALK_THRESHOLD) {
        return { base: clips.aimPose ?? clips.armedIdle, overlay: null };
      }
      if (pose.speed > RUN_THRESHOLD && clips.armedRun) return { base: clips.armedRun, overlay: null };
      const byDirection = { forward: clips.aimWalkF, back: clips.aimWalkB,
                            left: clips.aimWalkL, right: clips.aimWalkR };
      const clip = byDirection[dominantDirection(pose.moveDir)] ?? clips.aimWalkF;
      return { base: clip, overlay: null };
    }

    // Ступень ниже: низ от локомоции, верх от прицельной позы. Ещё ниже, если и позы нет:
    // одна локомоция, а наведение целиком процедурное.
    const role = locomotionRole(pose.speed);
    const timeScale = paceOf(role, pose.speed);
    if (aimPose && lower[role]) {
      return { base: lower[role], overlay: aimPose, timeScale, proceduralYaw: true };
    }
    return { base: clips[role] ?? clips.idle, overlay: null, timeScale, proceduralYaw: true };
  }

  function applyAim(pose, chosen) {
    if (!aimBones.length) return;
    // Доворот корпуса нужен только тем персонажам, у которых прицельной позы нет в клипах.
    // У модели с авторскими прицельными клипами поза уже в них, и доворот поверх ломает её.
    // ВРЕМЕННО ВЫКЛЮЧЕНО для скелетов с авторскими прицельными клипами: доворот по
    // мировым осям на скелете San Andreas выкручивает корпус вертикально. Причина в оси,
    // а не в накоплении (приостановленный экшен в three продолжает писать значения), и
    // разбирается отдельно. Персонажам без прицельных клипов доворот нужен и работает.
    if (!chosen.proceduralYaw) return;
    const yaw = THREE.MathUtils.clamp(pose.aimYaw ?? 0, -AIM_YAW_LIMIT, AIM_YAW_LIMIT);
    const pitch = THREE.MathUtils.clamp(pose.aimPitch ?? 0, -AIM_PITCH_LIMIT, AIM_PITCH_LIMIT);
    const lean = HIT_PITCH * (pose.hitT ?? 0);
    if (!pose.aiming && !lean) return;

    // Мировые матрицы костей считаются при рендере, поэтому перед чтением ориентации
    // родителя их надо обновить, иначе компенсация отстаёт на кадр и на быстром развороте
    // корпус уводит в сторону.
    model.updateWorldMatrix(false, true);
    for (const { bone, share } of aimBones) {
      // Доворот выражается в системе родителя, а не в локальных осях кости: у нашего рига
      // кость идёт вдоль Y, у гташной вдоль X, и поворот в родительской системе от этого
      // не зависит.
      bone.parent.getWorldQuaternion(parentRotation).invert();
      if (yaw) {
        axis.set(0, 1, 0).applyQuaternion(parentRotation).normalize();
        bone.quaternion.premultiply(scratch.setFromAxisAngle(axis, yaw * share));
      }
      if (pitch || lean) {
        axis.set(1, 0, 0).applyQuaternion(parentRotation).normalize();
        bone.quaternion.premultiply(scratch.setFromAxisAngle(axis, (pitch + lean) * share));
      }
    }
  }

  function update(dt, pose) {
    const chosen = plan(pose);
    // Оружие в руках это верхний слой из пакета своей группы, поверх любой стойки и походки.
    // Прицел это тот же клип, остановленный на кадре aimTime, выстрел проигрывает отрезок
    // до fireTo и возвращается к прицелу. Ровно так это устроено в самой игре.
    const weapon = pose.aiming ? pose.weapon : null;
    const weaponClip = weapon ? byName.get(weapon.fireClip) : null;
    setLayer('base', weaponClip ? stanceUnder(chosen.base, weaponClip) : chosen.base,
             { once: chosen.once, timeScale: chosen.timeScale });
    setLayer('overlay', weaponClip ?? chosen.overlay);

    const action = weaponClip ? layers.overlay : null;
    if (action) {
      if (pose.shotId !== lastShotId) {
        action.paused = false;
        action.time = weapon.fireFrom;
        lastShotId = pose.shotId;
      } else if (!action.paused && action.time >= weapon.fireTo) {
        action.paused = true;
        action.time = weapon.aimTime;
      } else if (action.paused) {
        action.time = weapon.aimTime;
      }
    }
    mixer.update(dt);
    applyAim(pose, chosen);
  }

  function debug() {
    const names = Object.fromEntries(
      Object.entries(clips).filter(([, clip]) => clip).map(([role, clip]) => [role, clip.name]));
    return { profile: profile.id, directionalAim, masked: Boolean(aimPose), roles: names,
             bones: aimBones.length };
  }

  return { update, debug, mixer };
}

export function clipCoverage(animations, profile) {
  const derived = derivedFor(animations, profile);
  const missing = Object.keys(profile.roles).filter((role) => !derived.clips[role]);
  const reference = derived.clips.walk ?? derived.clips.idle;
  return {
    missing,
    masked: Boolean(derived.aimPose),
    directionalAim: derived.directionalAim,
    trackSplit: derived.masks && reference
      ? { total: bonesOfClip(reference).size, lower: derived.masks.lower.size,
          upper: derived.masks.upper.size }
      : null,
  };
}
