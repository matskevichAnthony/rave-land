import { LEG_LENGTH, SPINE_BASE_Y } from './rig.js';

const TWO_PI = Math.PI * 2;
const SPEED_RESPONSE = 6;
const WALK_SPEED = 1.4;
const RUN_SPEED = 4;
const IDLE_FADE_SPEED = 0.3;
const MIN_STEP_LENGTH = 0.35;
const HIP_SWING_WALK = 0.42;
const HIP_SWING_RUN_EXTRA = 0.26;
const KNEE_REST = 0.12;
const KNEE_SWING_WALK = 0.75;
const KNEE_SWING_RUN_EXTRA = 0.55;
const ARM_SWING_RATIO = 0.85;
const ARM_TILT = 0.09;
const ELBOW_BEND_WALK = 0.3;
const ELBOW_BEND_RUN_EXTRA = 0.95;
const ELBOW_SWING = 0.35;
const IDLE_ELBOW_BEND = 0.1;
const BOB_WALK = 0.02;
const BOB_RUN_EXTRA = 0.032;
const LEAN_WALK = 0.05;
const LEAN_RUN_EXTRA = 0.14;
const NECK_COUNTER = 0.6;
const TORSO_SWAY = 0.035;
const BREATH_RATE = 1.7;
const BREATH_BOB = 0.006;
const BREATH_PITCH = 0.022;
const IDLE_ARM_SWAY = 0.03;
const HEAD_DRIFT_RATE = 0.4;
const HEAD_DRIFT = 0.07;
const AIM_RESPONSE = 9;
const AIM_SHOULDER_PITCH = -1.5;
const AIM_SHOULDER_TILT = 0.12;
const AIM_ELBOW_BEND = -0.18;

function clamp01(value) {
  return Math.min(Math.max(value, 0), 1);
}

function lerp(from, to, t) {
  return from + (to - from) * t;
}

export function createAnimator(joints, random) {
  let smoothedSpeed = 0;
  let phase = random() * TWO_PI;
  let idlePhase = random() * TWO_PI;
  let aimBlend = 0;

  return (dt, { speed = 0, aiming = false } = {}) => {
    smoothedSpeed += (speed - smoothedSpeed) * Math.min(1, dt * SPEED_RESPONSE);
    aimBlend += ((aiming ? 1 : 0) - aimBlend) * Math.min(1, dt * AIM_RESPONSE);
    const walkFactor = clamp01(smoothedSpeed / WALK_SPEED);
    const runFactor = clamp01((smoothedSpeed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED));
    const idleFactor = clamp01(1 - smoothedSpeed / IDLE_FADE_SPEED);

    const hipSwing = HIP_SWING_WALK * walkFactor + HIP_SWING_RUN_EXTRA * runFactor;
    const stepLength = Math.max(MIN_STEP_LENGTH, 2 * LEG_LENGTH * Math.sin(Math.max(hipSwing, 0.05)));
    phase = (phase + dt * TWO_PI * (smoothedSpeed / (2 * stepLength))) % TWO_PI;
    idlePhase += dt;

    const gaitL = Math.sin(phase);
    const gaitR = -gaitL;
    const kneeSwing = KNEE_SWING_WALK * walkFactor + KNEE_SWING_RUN_EXTRA * runFactor;

    joints.hipL.rotation.x = gaitL * hipSwing;
    joints.hipR.rotation.x = gaitR * hipSwing;
    joints.kneeL.rotation.x = KNEE_REST * walkFactor + Math.max(0, -Math.cos(phase)) * kneeSwing;
    joints.kneeR.rotation.x = KNEE_REST * walkFactor + Math.max(0, Math.cos(phase)) * kneeSwing;

    const armSwing = hipSwing * ARM_SWING_RATIO;
    joints.shoulderL.rotation.x = gaitR * armSwing;
    joints.shoulderR.rotation.x = lerp(gaitL * armSwing, AIM_SHOULDER_PITCH, aimBlend);

    const breath = Math.sin(idlePhase * BREATH_RATE);
    const elbowBend =
      ELBOW_BEND_WALK * walkFactor + ELBOW_BEND_RUN_EXTRA * runFactor + IDLE_ELBOW_BEND * idleFactor;
    joints.elbowL.rotation.x = -(elbowBend + Math.max(0, gaitL) * ELBOW_SWING * walkFactor);
    joints.elbowR.rotation.x = lerp(
      -(elbowBend + Math.max(0, gaitR) * ELBOW_SWING * walkFactor),
      AIM_ELBOW_BEND,
      aimBlend,
    );

    const armSway = breath * IDLE_ARM_SWAY * idleFactor;
    joints.shoulderL.rotation.z = -ARM_TILT - armSway;
    joints.shoulderR.rotation.z = lerp(ARM_TILT + armSway, AIM_SHOULDER_TILT, aimBlend);

    const bob = BOB_WALK * walkFactor + BOB_RUN_EXTRA * runFactor;
    const lean = LEAN_WALK * walkFactor + LEAN_RUN_EXTRA * runFactor;
    joints.spine.position.y =
      SPINE_BASE_Y - Math.cos(phase * 2) * bob + breath * BREATH_BOB * idleFactor;
    joints.spine.rotation.x = lean + breath * BREATH_PITCH * idleFactor;
    joints.spine.rotation.z = gaitL * TORSO_SWAY * walkFactor;
    joints.neck.rotation.x = -lean * NECK_COUNTER - breath * BREATH_PITCH * 0.5 * idleFactor;
    joints.neck.rotation.y = Math.sin(idlePhase * HEAD_DRIFT_RATE) * HEAD_DRIFT * idleFactor;
  };
}
