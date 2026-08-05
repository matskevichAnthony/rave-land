import { mulberry32 } from '../terrain/heightfield.js';

const IDLE_DURATION = { min: 2, max: 6 };
const TRIP_RADIUS = { min: 6, max: 25 };
const TRIPS_PER_RUN = { min: 4, max: 5 };
const WALK_SPEED = 1.4;
const RUN_SPEED = 4.2;
const ARRIVE_DISTANCE = 0.5;
const YAW_TURN_RATE = 6;
const TWO_PI = Math.PI * 2;

function rangeFrom(random, { min, max }) {
  return min + random() * (max - min);
}

function lerpAngle(from, to, t) {
  let delta = (to - from) % TWO_PI;
  if (delta > Math.PI) delta -= TWO_PI;
  if (delta < -Math.PI) delta += TWO_PI;
  return from + delta * t;
}

function clampToWorld(point, worldRadius) {
  const fromCenter = Math.hypot(point.x, point.z);
  if (fromCenter <= worldRadius) return point;
  const scale = worldRadius / fromCenter;
  return { x: point.x * scale, z: point.z * scale };
}

export function createWanderer({ seed, home: rawHome, worldRadius }) {
  const random = mulberry32(seed);
  const home = clampToWorld(rawHome, worldRadius);
  const position = { x: home.x, z: home.z };
  let yaw = random() * TWO_PI;
  let state = 'idle';
  let speed = 0;
  let idleLeft = rangeFrom(random, IDLE_DURATION);
  let tripsUntilRun = Math.round(rangeFrom(random, TRIPS_PER_RUN));
  let target = null;

  function pickTarget() {
    const angle = random() * TWO_PI;
    const radius = rangeFrom(random, TRIP_RADIUS);
    return clampToWorld(
      { x: home.x + Math.cos(angle) * radius, z: home.z + Math.sin(angle) * radius },
      worldRadius,
    );
  }

  function startTrip() {
    target = pickTarget();
    tripsUntilRun -= 1;
    if (tripsUntilRun <= 0) {
      state = 'run';
      speed = RUN_SPEED;
      tripsUntilRun = Math.round(rangeFrom(random, TRIPS_PER_RUN));
    } else {
      state = 'walk';
      speed = WALK_SPEED;
    }
  }

  function startIdle() {
    state = 'idle';
    speed = 0;
    target = null;
    idleLeft = rangeFrom(random, IDLE_DURATION);
  }

  function snapshot() {
    return { x: position.x, z: position.z, yaw, speed, state };
  }

  function update(dt) {
    if (state === 'idle') {
      idleLeft -= dt;
      if (idleLeft <= 0) startTrip();
      return snapshot();
    }

    const dx = target.x - position.x;
    const dz = target.z - position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= ARRIVE_DISTANCE) {
      startIdle();
      return snapshot();
    }

    const step = Math.min(speed * dt, distance);
    position.x += (dx / distance) * step;
    position.z += (dz / distance) * step;
    yaw = lerpAngle(yaw, Math.atan2(dx, dz), Math.min(YAW_TURN_RATE * dt, 1));
    return snapshot();
  }

  return { update, home };
}
