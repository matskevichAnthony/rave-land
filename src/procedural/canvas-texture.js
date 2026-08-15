/** Текстуры, нарисованные на canvas: дешевле файла и меняются вместе с сидом. */

import * as THREE from 'three';
import { between } from './random.js';

const BLOB = {
  size: 256,
  count: 90,
  radius: [0.06, 0.3],
  alpha: [0.04, 0.16],
  color: '#ffffff',
};

/** Цвет в виде строки `rgba(...)`: canvas принимает прозрачность только так. */
export function rgba(hex, alpha) {
  return new THREE.Color(hex).getStyle().replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
}

function paintBlob(ctx, color, x, y, radius, alpha) {
  const blob = ctx.createRadialGradient(x, y, 0, x, y, radius);
  blob.addColorStop(0, rgba(color, alpha));
  blob.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = blob;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

/**
 * Мягкий шум пятнами: дымка, копоть, разводы.
 *
 * Каждое пятно рисуется ещё и во всех сдвигах на сторону, поэтому текстура сходится сама
 * с собой и её можно повторять без видимого шва.
 */
export function createBlobTexture({
  random,
  size = BLOB.size,
  blobs = BLOB.count,
  radius = BLOB.radius,
  alpha = BLOB.alpha,
  color = BLOB.color,
}) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  for (let index = 0; index < blobs; index += 1) {
    const x = random() * size;
    const y = random() * size;
    const blobRadius = between(random, ...radius) * size;
    const blobAlpha = between(random, ...alpha);
    for (let tileX = -1; tileX <= 1; tileX += 1) {
      for (let tileY = -1; tileY <= 1; tileY += 1) {
        const shiftedX = x + tileX * size;
        const shiftedY = y + tileY * size;
        const outside = shiftedX + blobRadius < 0 || shiftedX - blobRadius > size
          || shiftedY + blobRadius < 0 || shiftedY - blobRadius > size;
        if (!outside) paintBlob(ctx, color, shiftedX, shiftedY, blobRadius, blobAlpha);
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
