import * as THREE from 'three';
import { bonesOfClip, findBone, findClip, splitMasks } from './skeleton-profile.js';

/**
 * Поза персонажа из слоёв клипов плюс процедурный доворот корпуса.
 *
 * AnimationMixer не умеет масок по костям, а веса тут не помогают: два экшена с весом 0.5
 * на одну кость дают усреднённую позу, а не «ноги от походки, руки от прицела». Поэтому
 * маска это подмножество треков: из клипа собирается новый клип только с нужными костями,
 * и два таких экшена с весом 1 складываются точно, потому что каждую кость пишет ровно один.
 *
 * Смесь по весам законна там, где клипы полнотелые и однородные: соседние направления
 * прицельной ходьбы смешиваются именно так, и диагональ получается сама собой.
 */

const FADE_SECONDS = 0.18;
const WEIGHT_EPSILON = 0.005;
const WALK_THRESHOLD = 0.1;
const RUN_THRESHOLD = 3;
const SPRINT_THRESHOLD = 6.5;
// Скорость, на которую снят клип: измерена по корневому перемещению в ped.ifp (F-037).
// Клип проигрывается тем быстрее, чем быстрее едет персонаж, иначе стопы проскальзывают.
const CLIP_SPEED = { walk: 1.52, run: 4.3, sprint: 6.3,
                     aimWalkF: 1.85, aimWalkB: 1.85, aimWalkL: 1.8, aimWalkR: 1.8,
                     armedRun: 5.98 };
const TIME_SCALE_LIMIT = { min: 0.45, max: 1.8 };
// Прицельный шаг тянется по времени до предела, а всё, что быстрее, это уже бег с оружием.
const AIM_RUN_THRESHOLD = CLIP_SPEED.aimWalkF * TIME_SCALE_LIMIT.max;
// Двуручный ствол наводится корпусом: доворот раскладывается по позвоночнику, а руки
// приходят из клипа, потому что доворот поверх него ломает хват. Одноручному движок
// наводит саму правую руку, корпус оставляя клипу (F-050), поэтому цепочка своя.
const AIM_SHARE = { spine: 0.35, chest: 0.65 };
const AIM_YAW_LIMIT = THREE.MathUtils.degToRad(25);
const AIM_PITCH_LIMIT = THREE.MathUtils.degToRad(35);
// Сектор, который рука закрывает сама. Влево она дотягивается хуже, потому что правая;
// за пределами сектора движок добавляет корпусом половину избытка (F-050).
const ARM_YAW_RANGE = { min: THREE.MathUtils.degToRad(-60), max: THREE.MathUtils.degToRad(45) };
const TORSO_EXCESS_SHARE = 0.5;
const HIT_PITCH = THREE.MathUtils.degToRad(20);
const TRACK_EPSILON = 1e-4;
// Персонажа разворачивает player вокруг своей вертикали, а смотрит он вдоль своего +Z.
// Отсюда поперечная ось, вокруг которой корпус наклоняется к цели.
const CHARACTER_FORWARD = new THREE.Vector3(0, 0, 1);
const CHARACTER_UP = THREE.Object3D.DEFAULT_UP;
const CHARACTER_SIDE = new THREE.Vector3().crossVectors(CHARACTER_UP, CHARACTER_FORWARD);

// Производные клипы (маски, статичные позы) считаются один раз на модель: массив animations
// у GLTFLoader общий для всех экземпляров, а AnimationAction у каждого свой.
const derivedCache = new WeakMap();
const partialCache = new WeakMap();

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

/**
 * Кости, которые клип действительно двигает.
 *
 * Клипы стрельбы и перезарядки в GTA частичные (F-048), но в GLB они приезжают полнотелыми:
 * экспортёр досыпает все кости скелета и держит нетронутые в позе первого кадра. Верить
 * набору треков поэтому нельзя. Если поверить, слой оружия перепишет ноги позой из rest, из
 * стойки под ним вычтется всё до последнего трека, и два полнотелых экшена с весом 1
 * сложатся усреднением, то есть и прицел, и походка выйдут вполсилы.
 */
function movingBones(clip) {
  const bones = new Set();
  for (const track of clip.tracks) {
    const stride = track.values.length / track.times.length;
    const still = track.values.every(
      (value, index) => Math.abs(value - track.values[index % stride]) < TRACK_EPSILON);
    if (!still) bones.add(THREE.PropertyBinding.parseTrackName(track.name).nodeName);
  }
  return bones;
}

/** Клип оружия, ужатый до своих живых костей, вместе с их набором. */
function partialOf(clip) {
  if (!partialCache.has(clip)) {
    const bones = movingBones(clip);
    const masked = maskedClip(clip, bones, 'moving');
    partialCache.set(clip, masked ? { bones, clip: masked } : { bones: bonesOfClip(clip), clip });
  }
  return partialCache.get(clip);
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

/**
 * Доли четырёх направленных клипов по вектору движения в системе персонажа.
 *
 * Персонаж смотрит вдоль своего +Z, система правая, поэтому его правая сторона это −X:
 * шаг вправо приходит с отрицательным x, и клип ему нужен GunMove_R.
 */
function directionalShares(moveDir) {
  const x = moveDir?.x ?? 0;
  const z = moveDir?.z ?? 0;
  const shares = [['aimWalkF', z], ['aimWalkB', -z], ['aimWalkL', x], ['aimWalkR', -x]];
  const moving = shares.filter(([, share]) => share > 0);
  return moving.length ? moving : [['aimWalkF', 1]];
}

/** Экшен, который сейчас задаёт слой: к его фазе подстраиваются входящие клипы. */
function heaviest(active) {
  let lead = null;
  let top = 0;
  for (const [action, weight] of active) {
    if (weight < top) continue;
    top = weight;
    lead = action;
  }
  return lead;
}

function pace(speed, authored) {
  if (!authored) return 1;
  return THREE.MathUtils.clamp(speed / authored, TIME_SCALE_LIMIT.min, TIME_SCALE_LIMIT.max);
}

export function createCharacterAnimator({ model, animations, profile }) {
  const mixer = new THREE.AnimationMixer(model);
  const derived = derivedFor(animations, profile);
  const actions = new Map();
  const layers = { base: new Map(), overlay: new Map() };
  let lastShotId = 0;
  let lastReloadId = 0;
  let reloading = null;
  let reloadLeft = 0;
  const torsoAim = new Map(Object.entries(AIM_SHARE)
    .map(([role, share]) => [findBone(model, profile, role), share])
    .filter(([bone]) => bone));
  const armBone = findBone(model, profile, 'armR');
  const handBone = findBone(model, profile, 'handR');
  // Ствол авторен вдоль кости кисти, поэтому куда он смотрит, говорит вектор до её ребёнка.
  // Ровно так его находит крепление оружия (F-049), значит замер сходится с картинкой.
  const barrelBone = handBone?.children.find((node) => node.isBone) ?? null;
  const scratch = new THREE.Quaternion();
  const turn = new THREE.Quaternion();
  const parentFrame = new THREE.Quaternion();
  const parentInverse = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const barrel = new THREE.Vector3();
  const wanted = new THREE.Vector3();
  const muzzlePoint = new THREE.Vector3();
  const handPoint = new THREE.Vector3();
  const boneFrame = new THREE.Quaternion();
  const characterFrame = new THREE.Quaternion();
  /**
   * Поза из клипа, своя копия на каждую доворачиваемую кость.
   *
   * three.js пишет кость только когда смиксованное значение изменилось с прошлого кадра:
   * PropertyMixer.apply сравнивает свои накопители между собой, а не с костью. У статичной
   * прицельной позы значение постоянно, записи не происходит вовсе, и доворот, положенный
   * прямо на кость, никто не затирает: он множится каждый кадр, пока корпус не прокрутит
   * через ноги. Поэтому кость каждый кадр собирается заново от позы из клипа.
   */
  const posed = new Map([...torsoAim.keys(), armBone].filter(Boolean).map((bone) => [bone, {
    fromClip: bone.quaternion.clone(),
    applied: bone.quaternion.clone(),
  }]));

  function actionFor(clip, { once = false } = {}) {
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

  /** Фаза цикла у входящего клипа берётся от уже играющего, иначе смесь походок шаркает. */
  function alignPhase(action, lead) {
    const cycle = lead?.getClip().duration;
    if (!cycle) return;
    action.time = (lead.time / cycle) * action.getClip().duration;
  }

  /**
   * Довести веса слоя до заданных долей.
   *
   * Веса ведутся руками, а не через fadeIn/fadeOut: смесь двух соседних направлений
   * прицельной ходьбы это те же веса, и одна механика на переход между клипами и на смесь
   * внутри семейства проще двух. Экшен, оставшийся без доли, гаснет и останавливается.
   */
  function blendLayer(name, entries, dt, { timeScale = 1, once = false, syncPhase = false } = {}) {
    const active = layers[name];
    const lead = syncPhase ? heaviest(active) : null;
    const targets = new Map();
    for (const { clip, weight } of entries) {
      if (!clip) continue;
      const action = actionFor(clip, { once });
      action.timeScale = timeScale;
      targets.set(action, weight);
      if (active.has(action)) continue;
      active.set(action, 0);
      action.reset().play();
      if (syncPhase) alignPhase(action, lead);
    }
    const step = Math.min(1, dt / FADE_SECONDS);
    for (const [action, weight] of active) {
      const share = targets.get(action) ?? 0;
      const next = weight + (share - weight) * step;
      if (!share && next < WEIGHT_EPSILON) {
        action.stop();
        active.delete(action);
        continue;
      }
      active.set(action, next);
      action.setEffectiveWeight(next);
    }
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
  function stanceUnder(clip, upper) {
    if (!clip || !upper) return clip;
    const key = `${clip.name}|${upper.clip.name}`;
    if (!trimmed.has(key)) {
      trimmed.set(key, withoutBones(clip, upper.bones) ?? clip);
    }
    return trimmed.get(key);
  }

  function locomotionRole(speed) {
    if (speed > SPRINT_THRESHOLD && clips.sprint) return 'sprint';
    if (speed > RUN_THRESHOLD) return clips.run ? 'run' : 'walk';
    if (speed > WALK_THRESHOLD) return clips.walk ? 'walk' : 'idle';
    return 'idle';
  }

  /**
   * Прицельный шаг из четырёх направленных клипов, диагональ смесью двух соседних.
   *
   * Темп считается по смешанной авторской скорости: клипы сняты на разную (вперёд быстрее,
   * чем вбок), и брать скорость одного направления на смеси значит проскальзывать стопами.
   */
  function aimWalk(pose) {
    const shares = directionalShares(pose.moveDir).filter(([role]) => clips[role]);
    const total = shares.reduce((sum, [, share]) => sum + share, 0);
    if (!total) return { base: clips.armedIdle, overlay: null };
    const authored = shares.reduce((sum, [role, share]) => sum + share * CLIP_SPEED[role], 0);
    return {
      base: shares.map(([role, share]) => ({ clip: clips[role], weight: share / total })),
      overlay: null,
      timeScale: pace(pose.speed * total, authored),
      syncPhase: true,
    };
  }

  function plan(pose) {
    if (pose.dead && clips.death) return { base: clips.death, overlay: null, once: true };
    if (pose.airborne) {
      const jump = pose.jumpTime < 0.2 ? clips.jumpLaunch : clips.jumpGlide;
      if (jump) return { base: jump, overlay: null };
    }
    if (pose.landing && clips.jumpLand) return { base: clips.jumpLand, overlay: null, once: true };
    if (pose.dancing && clips.dance) return { base: clips.dance, overlay: null };
    // Присед это одна поза без ходьбы: клипа передвижения на корточках в наборе нет,
    // поэтому на корточках стоят на месте, а не ползают с чужой анимацией ног.
    if (pose.crouching && clips.crouchAim) return { base: clips.crouchAim, overlay: null };

    if (!pose.aiming) {
      const role = locomotionRole(pose.speed);
      return { base: clips[role] ?? clips.idle, overlay: null,
               timeScale: pace(pose.speed, CLIP_SPEED[role]) };
    }

    if (directionalAim) {
      // Стойка стоя выбирается по флагу оружия, как в CTaskSimpleUseGun::SetMoveAnim
      // (F-050): одноручному стволу гановая стойка не даётся вовсе, гангстер встаёт в
      // gang_gunstand и наводит только руку, а двуручному достаётся Gun_stand.
      if (pose.speed <= WALK_THRESHOLD) {
        const standing = pose.weapon?.flags?.aimWithArm
          ? clips.gangStand ?? clips.idle
          : clips.gunStand ?? clips.armedIdle;
        return { base: standing, overlay: null };
      }
      if (pose.speed > AIM_RUN_THRESHOLD && clips.armedRun) {
        return { base: clips.armedRun, overlay: null,
                 timeScale: pace(pose.speed, CLIP_SPEED.armedRun) };
      }
      return aimWalk(pose);
    }

    // Ступень ниже: низ от локомоции, верх от прицельной позы. Ещё ниже, если и позы нет:
    // одна локомоция, а наведение целиком процедурное.
    const role = locomotionRole(pose.speed);
    const timeScale = pace(pose.speed, CLIP_SPEED[role]);
    if (aimPose && lower[role]) {
      return { base: lower[role], overlay: aimPose, timeScale };
    }
    return { base: clips[role] ?? clips.idle, overlay: null, timeScale };
  }

  /**
   * Довернуть кость к цели долей общего угла.
   *
   * Оси берутся в системе персонажа, а не в мировых: в мировых наклон превращается в крен,
   * стоит персонажу отвернуться от оси Z. Сам поворот выражается в системе родителя кости,
   * потому что собственные оси кости у каждого скелета свои: у нашего рига кость идёт вдоль
   * Y, у гташной вдоль X, и на её локальных осях наклон уводило бы в сторону.
   */
  function turnBone(bone, share, yaw, pitch) {
    if (!share || (!yaw && !pitch)) return;
    // Мировые матрицы костей считаются при рендере, а доворот идёт сразу после mixer.update:
    // без пересчёта ориентация родителя отстаёт на кадр, а у второй кости ещё и не видит
    // доворота первой.
    bone.parent.updateWorldMatrix(true, false);
    bone.parent.getWorldQuaternion(boneFrame).invert().multiply(characterFrame);
    if (yaw) {
      axis.copy(CHARACTER_UP).applyQuaternion(boneFrame).normalize();
      bone.quaternion.premultiply(scratch.setFromAxisAngle(axis, yaw * share));
    }
    if (pitch) {
      axis.copy(CHARACTER_SIDE).applyQuaternion(boneFrame).normalize();
      bone.quaternion.premultiply(scratch.setFromAxisAngle(axis, pitch * share));
    }
  }

  /**
   * Навести ствол поворотом плеча, как PedIK::PointArm у движка (F-050).
   *
   * Клип стрельбы одноручного оружия авторен под свой разворот корпуса: на стойке из другого
   * клипа ствол уезжает на десятки градусов, и фиксированным доворотом это не лечится, потому
   * что величина зависит от стойки. Поэтому поворот считается от фактического направления
   * ствола к нужному. Ниже плеча рука жёсткая, значит плечо поворачивает ствол ровно на ту же
   * величину. Без кости ствола (скелет без пальцев) остаётся простой доворот на угол.
   */
  function pointArm(bone, yaw, pitch) {
    if (!barrelBone) {
      turnBone(bone, 1, yaw, pitch);
      return;
    }
    bone.updateWorldMatrix(true, true);
    barrel.copy(barrelBone.getWorldPosition(muzzlePoint))
      .sub(handBone.getWorldPosition(handPoint))
      .normalize();
    wanted.copy(CHARACTER_FORWARD)
      .applyAxisAngle(CHARACTER_SIDE, pitch)
      .applyAxisAngle(CHARACTER_UP, yaw)
      .applyQuaternion(characterFrame);
    turn.setFromUnitVectors(barrel, wanted);
    bone.parent.getWorldQuaternion(parentFrame);
    parentInverse.copy(parentFrame).invert();
    bone.quaternion.premultiply(scratch.copy(parentInverse).multiply(turn).multiply(parentFrame));
  }

  function applyAim(pose) {
    if (!posed.size) return;
    const aimed = Boolean(pose.aiming);
    const byArm = aimed && Boolean(pose.weapon?.flags?.aimWithArm) && Boolean(armBone);
    const yaw = aimed ? (pose.aimYaw ?? 0) : 0;
    const armYaw = byArm ? THREE.MathUtils.clamp(yaw, ARM_YAW_RANGE.min, ARM_YAW_RANGE.max) : 0;
    const torsoYaw = THREE.MathUtils.clamp(
      byArm ? (yaw - armYaw) * TORSO_EXCESS_SHARE : yaw, -AIM_YAW_LIMIT, AIM_YAW_LIMIT);
    const aimPitch = aimed
      ? THREE.MathUtils.clamp(pose.aimPitch ?? 0, -AIM_PITCH_LIMIT, AIM_PITCH_LIMIT) : 0;
    // Отдачу корпусом отыгрывает позвоночник при любом стволе: это удар в тело, не наводка.
    const torsoPitch = HIT_PITCH * (pose.hitT ?? 0) + (byArm ? 0 : aimPitch);

    model.updateWorldMatrix(true, false);
    model.getWorldQuaternion(characterFrame);
    // Кости идут от родителя к ребёнку, и обойти надо все: кость вне активной цепочки тоже
    // нужно вернуть к позе из клипа, иначе доворот прошлого кадра остаётся на ней навсегда.
    for (const [bone, memo] of posed) {
      if (bone.quaternion.equals(memo.applied)) bone.quaternion.copy(memo.fromClip);
      else memo.fromClip.copy(bone.quaternion);
      turnBone(bone, torsoAim.get(bone), torsoYaw, torsoPitch);
      // Рука идёт последней: она наводится от уже довёрнутого корпуса, а не мимо него.
      // На перезарядке наводка снимается, иначе она держит ствол в цели и съедает клип.
      if (byArm && !reloading && bone === armBone) pointArm(bone, armYaw + torsoYaw, aimPitch);
      memo.applied.copy(bone.quaternion);
    }
  }

  /** Клип перезарядки, начатый в этом кадре: его длительность нужна тому, кто считает патроны. */
  function startReload(pose) {
    const id = pose.reloadId ?? 0;
    if (id === lastReloadId) return 0;
    lastReloadId = id;
    const clip = pose.weapon?.reloadClip ? byName.get(pose.weapon.reloadClip) : null;
    if (!clip || reloading) return 0;
    reloading = clip;
    reloadLeft = clip.duration;
    return clip.duration;
  }

  /** Обновить позу; возвращает длительность перезарядки, если она началась этим вызовом. */
  function update(dt, pose) {
    const chosen = plan(pose);
    reloadLeft = Math.max(0, reloadLeft - dt);
    if (!reloadLeft) reloading = null;
    const reloadSeconds = startReload(pose);

    // Оружие в руках это верхний слой из пакета своей группы, поверх любой стойки и походки.
    // Прицел это тот же клип, остановленный на кадре aimTime, выстрел проигрывает отрезок
    // до fireTo и возвращается к прицелу. Ровно так это устроено в самой игре.
    const weapon = pose.aiming ? pose.weapon : null;
    const fireClip = weapon ? byName.get(weapon.fireClip) : null;
    const armed = reloading ?? fireClip;
    const upper = armed ? partialOf(armed) : null;
    const base = Array.isArray(chosen.base) ? chosen.base : [{ clip: chosen.base, weight: 1 }];
    const { timeScale, once, syncPhase } = chosen;
    blendLayer('base', base.map(({ clip, weight }) => ({ clip: stanceUnder(clip, upper), weight })),
               dt, { timeScale, once, syncPhase });
    blendLayer('overlay', [{ clip: upper?.clip ?? chosen.overlay, weight: 1 }], dt,
               { once: Boolean(reloading) });

    const firing = fireClip && !reloading ? actionFor(partialOf(fireClip).clip) : null;
    if (pose.shotId !== lastShotId) {
      lastShotId = pose.shotId;
      if (firing) {
        firing.paused = false;
        firing.time = weapon.fireFrom;
      }
    } else if (firing && !firing.paused && firing.time >= weapon.fireTo) {
      firing.paused = true;
      firing.time = weapon.aimTime;
    } else if (firing?.paused) {
      firing.time = weapon.aimTime;
    }
    mixer.update(dt);
    applyAim(pose);
    return reloadSeconds;
  }

  function debug() {
    const names = Object.fromEntries(
      Object.entries(clips).filter(([, clip]) => clip).map(([role, clip]) => [role, clip.name]));
    return { profile: profile.id, directionalAim, masked: Boolean(aimPose), roles: names,
             bones: posed.size };
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
