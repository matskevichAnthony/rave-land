import * as THREE from 'three';

const CANVAS_WIDTH = 512;
const CANVAS_HEIGHT = 128;
const STRIP_HEIGHT = 88;
const STRIP_RADIUS = 20;
const STRIP_PADDING_X = 28;
const FONT = 'bold 52px system-ui, sans-serif';
const TEXT_COLOR = '#e8e4ff';
const STRIP_COLOR = 'rgba(12, 8, 28, 0.72)';
const SPRITE_WIDTH = 1.2;
const SPRITE_HEIGHT = 0.3;
const LABEL_HEIGHT = 2.1;

export function createNameLabel(name) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const context = canvas.getContext('2d');
  context.font = FONT;
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  const maxTextWidth = CANVAS_WIDTH - STRIP_PADDING_X * 2;
  const textWidth = Math.min(context.measureText(name).width, maxTextWidth);
  const stripWidth = textWidth + STRIP_PADDING_X * 2;
  const stripTop = (CANVAS_HEIGHT - STRIP_HEIGHT) / 2;

  context.fillStyle = STRIP_COLOR;
  context.beginPath();
  context.roundRect((CANVAS_WIDTH - stripWidth) / 2, stripTop, stripWidth, STRIP_HEIGHT, STRIP_RADIUS);
  context.fill();

  context.fillStyle = TEXT_COLOR;
  context.fillText(name, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, maxTextWidth);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, fog: false }),
  );
  sprite.scale.set(SPRITE_WIDTH, SPRITE_HEIGHT, 1);
  sprite.position.y = LABEL_HEIGHT;
  return sprite;
}
