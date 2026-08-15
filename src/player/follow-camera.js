import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA } from '../config.js';
import {
  exitPointerLock,
  isPointerLocked,
  pointerLockSupported,
  requestPointerLock,
} from './pointer-lock.js';

const MOUSE_SENSITIVITY = 0.0026;
// Радиан на пиксель перетаскивания: свайп во всю ширину телефона разворачивает примерно на
// пол-оборота, полный оборот выходит за два свайпа.
const DRAG_SENSITIVITY = 0.007;
const PITCH_MIN = -0.5;
const PITCH_MAX = 1.25;
const START_PITCH = 0.42;
const DISTANCE_MIN = 2.5;
const DISTANCE_MAX = 16;
const ZOOM_STEP = 0.0014;
const GROUND_CLEARANCE = 0.35;
const AIM_DISTANCE = 2.1;
const AIM_SHOULDER_OFFSET = 0.55;
const AIM_HEIGHT_LIFT = 0.25;
const AIM_BLEND_RATE = 0.18;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export function createFollowCamera(camera, domElement, terrain) {
  let yaw = 0;
  let pitch = START_PITCH;
  let distance = CAMERA.startDistance;
  let editing = false;
  let aiming = false;
  let aimBlend = 0;
  const target = new THREE.Vector3();
  const offset = new THREE.Vector3();

  const orbit = new OrbitControls(camera, domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.12;
  orbit.enablePan = true;
  orbit.maxDistance = 200;
  orbit.enabled = false;

  function turn(deltaX, deltaY, sensitivity) {
    yaw -= deltaX * sensitivity;
    pitch = clamp(pitch + deltaY * sensitivity, PITCH_MIN, PITCH_MAX);
  }

  function listenLock() {
    domElement.addEventListener('click', () => {
      if (!editing && !isPointerLocked(domElement)) requestPointerLock(domElement);
    });
    window.addEventListener('mousemove', (event) => {
      if (editing || !isPointerLocked(domElement)) return;
      turn(event.movementX, event.movementY, MOUSE_SENSITIVITY);
    });
  }

  /** Там, где захвата мыши нет, взгляд крутится перетаскиванием по самому слою обзора. */
  function listenDrag() {
    let dragId = null;
    let lastX = 0;
    let lastY = 0;

    domElement.addEventListener('pointerdown', (event) => {
      // Кнопки виртуального пада лежат внутри слоя: нажатие по ним взгляд не крутит.
      if (editing || dragId !== null || event.target !== domElement) return;
      dragId = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
      domElement.setPointerCapture(dragId);
    });
    domElement.addEventListener('pointermove', (event) => {
      if (event.pointerId !== dragId) return;
      turn(event.clientX - lastX, event.clientY - lastY, DRAG_SENSITIVITY);
      lastX = event.clientX;
      lastY = event.clientY;
    });
    const release = (event) => {
      if (event.pointerId !== dragId) return;
      domElement.releasePointerCapture(dragId);
      dragId = null;
    };
    domElement.addEventListener('pointerup', release);
    domElement.addEventListener('pointercancel', release);
  }

  if (pointerLockSupported()) listenLock(); else listenDrag();

  window.addEventListener('wheel', (event) => {
    if (editing) return;
    distance = clamp(distance + event.deltaY * ZOOM_STEP * distance, DISTANCE_MIN, DISTANCE_MAX);
  });

  function place() {
    aimBlend += ((aiming ? 1 : 0) - aimBlend) * AIM_BLEND_RATE;
    const viewDistance = distance + (AIM_DISTANCE - distance) * aimBlend;
    const shoulder = AIM_SHOULDER_OFFSET * aimBlend;
    target.y += AIM_HEIGHT_LIFT * aimBlend;
    target.x += Math.cos(yaw) * shoulder;
    target.z += -Math.sin(yaw) * shoulder;

    const cosPitch = Math.cos(pitch);
    offset
      .set(Math.sin(yaw) * cosPitch, Math.sin(pitch), Math.cos(yaw) * cosPitch)
      .multiplyScalar(viewDistance);
    camera.position.copy(target).add(offset);
    const minY = terrain.heightAt(camera.position.x, camera.position.z) + GROUND_CLEARANCE;
    if (camera.position.y < minY) camera.position.y = minY;
    camera.lookAt(target);
  }

  function follow(position) {
    target.set(position.x, position.y + CAMERA.followHeight, position.z);
    place();
  }

  function snapTo(position) {
    yaw = 0;
    pitch = START_PITCH;
    target.set(position.x, position.y + CAMERA.followHeight, position.z);
    place();
  }

  function setEditMode(nextEditing) {
    editing = nextEditing;
    orbit.enabled = editing;
    if (editing) {
      exitPointerLock();
      orbit.target.copy(target);
    } else {
      offset.subVectors(camera.position, orbit.target);
      distance = clamp(offset.length(), DISTANCE_MIN, DISTANCE_MAX);
      yaw = Math.atan2(offset.x, offset.z);
      pitch = clamp(Math.asin(offset.y / (offset.length() || 1)), PITCH_MIN, PITCH_MAX);
    }
  }

  return {
    controls: orbit,
    follow,
    snapTo,
    setEditMode,
    // Сдвиг взгляда с виртуального пада приходит в тех же пикселях, что и перетаскивание.
    dragLook: (deltaX, deltaY) => {
      if (!editing) turn(deltaX, deltaY, DRAG_SENSITIVITY);
    },
    setAiming: (next) => {
      aiming = next;
    },
    update: () => orbit.update(),
    azimuth: () => yaw,
    // Положительный pitch поднимает камеру над целью, то есть взгляд идёт вниз, и ствол
    // персонажа опускается на тот же угол. Аниматор ждёт угол ровно с этим знаком.
    aimPitch: () => pitch,
  };
}
