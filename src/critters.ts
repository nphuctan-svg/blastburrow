import type { Critter } from './content.js';

type Pixel = (color: string, x: number, y: number, width: number, height: number) => void;
type GaitFrame = 0 | 1 | 2 | 3 | 4;
interface Pose { frame: GaitFrame; gaze: number; knockedOut: boolean }

const outline = '#28262c';
const cream = '#ffedcb';
export const CRITTER_SIZE = 24;

const cycles = {
  hare: { distance: .85, lift: 4, squash: 1 },
  fox: { distance: .84, lift: 2, squash: 0 },
  frog: { distance: 1, lift: 8, squash: 4 },
  mole: { distance: .76, lift: 1, squash: 2 },
  owl: { distance: 1.15, lift: 4, squash: 0 },
  cat: { distance: 1.05, lift: 1, squash: 2 }
} satisfies Record<Critter, { distance: number; lift: number; squash: number }>;
const movingFrames = [1, 2, 3, 4] as const;

export function critterGait(critter: Critter, traveled: number, weight: number) {
  if (weight <= 0) return { frame: 0 as const, lift: 0, squash: 0 };
  const cycle = cycles[critter];
  const phase = (traveled % cycle.distance) / cycle.distance;
  const arc = Math.sin(phase * Math.PI) ** 2;
  return {
    frame: movingFrames[Math.floor(phase * movingFrames.length)],
    lift: cycle.lift * arc * weight,
    squash: cycle.squash * Math.max(0, 1 - arc * 2) * weight
  };
}

function eye(p: Pixel, x: number, y: number, pose: Pose, height = 3) {
  x += pose.gaze;
  if (pose.knockedOut) {
    p(outline, x - 1, y, 1, 3); p(outline, x + 1, y, 1, 3);
    p(outline, x, y + 1, 1, 1);
  } else {
    p(outline, x, y, 2, height);
    p('#fff5df', x, y, 1, 1);
  }
}

function hare(p: Pixel, pose: Pose) {
  const fur = '#eec06c';
  const stretch = pose.frame === 2 || pose.frame === 3;
  for (const root of [5, 14]) {
    const x = root - (stretch ? pose.gaze || 1 : 0);
    p(outline, x + 1, 0, 4, 2); p(outline, x, 2, 6, 9);
    p(fur, x + 1, 1, 4, 9); p('#d68e89', x + 2, 2, 2, 7);
    p('#f3a8a0', x + 2, 2, 1, 5);
  }
  p(outline, 6, 15, 13, 8); p('#ca925a', 7, 16, 11, 6);
  p(cream, 9, 17, 7, 4);
  p(outline, 3, 17, 4, 4); p('#f7d995', 4, 18, 2, 2);
  const toes = stretch ? 20 : 22;
  p(outline, stretch ? 4 : 5, pose.frame ? toes : 21, 6, 2); p(outline, 14, toes, 6, 2);
  p(fur, stretch ? 5 : 6, pose.frame ? toes : 21, 4, 1); p(fur, 15, toes, 4, 1);
  p(outline, 6, 8, 13, 2); p(outline, 4, 10, 17, 7); p(outline, 6, 17, 13, 3);
  p(fur, 6, 9, 13, 9); p(fur, 5, 11, 15, 6);
  p('#ffda84', 7, 10, 9, 2);
  p(cream, 7, 15, 11, 3); p('#f0b083', 5, 14, 3, 2); p('#f0b083', 17, 14, 3, 2);
  eye(p, 8, 12, pose); eye(p, 15, 12, pose);
  p('#9c5558', 11, 15, 3, 1); p(outline, 12, 16, 1, 1);
  p('#fff8e5', 11, 17, 2, 2); p('#ae7653', 12, 18, 1, 1);
}

function fox(p: Pixel, pose: Pose) {
  const fur = '#e08652';
  // The brush rises above the shoulder with a light, stepped tip.
  const swish = [0, -2, -1, 1, 0][pose.frame];
  p(outline, 20, 8 + swish, 3, 2); p(outline, 18, 10 + swish, 6, 9); p(outline, 16, 16, 7, 6); p(outline, 13, 19, 8, 4);
  p('#af593f', 16, 18, 5, 4); p(fur, 19, 11 + swish, 4, 8); p(fur, 18, 16, 4, 4);
  p(cream, 21, 9 + swish, 2, 2); p(cream, 19, 11 + swish, 4, 3); p('#edc6a0', 21, 14 + swish, 2, 1);
  p(outline, 4, 15, 13, 8); p('#ad5a49', 5, 16, 11, 6); p(cream, 6, 17, 7, 4);
  const reach = [0, -2, 0, 2, 0][pose.frame];
  if (pose.frame) {
    p(outline, 4 - reach, 20, 4, 3); p(outline, 14 - reach, 20, 4, 3);
    p('#9b5c4c', 5 - reach, 21, 2, 1); p('#9b5c4c', 15 - reach, 21, 2, 1);
  }
  p(outline, 4 + reach, 21, 5, 2); p(outline, 12 + reach, 22, 5, 2);
  p('#633c40', 5 + reach, 21, 3, 1); p('#633c40', 13 + reach, 22, 3, 1);
  for (const x of [3, 13]) {
    p(outline, x + 1, 3, 3, 2); p(outline, x, 5, 5, 3); p(outline, x, 8, 6, 3);
    p(fur, x + 1, 5, 3, 5); p('#9a5551', x + 2, 5, 1, 3);
  }
  p(outline, 4, 8, 14, 3); p(outline, 2, 11, 18, 4); p(outline, 5, 15, 12, 3);
  p(fur, 4, 9, 14, 6); p('#f4a568', 6, 9, 9, 2);
  p(cream, 3, 13, 6, 2); p(cream, 13, 13, 6, 2); p(cream, 6, 14, 10, 3);
  eye(p, 6, 11, pose, 2); eye(p, 13, 11, pose, 2);
  p(outline, 9, 15, 4, 1); p('#554047', 10, 16, 2, 1);
}

function frog(p: Pixel, pose: Pose) {
  const skin = '#92bc64';
  p(outline, 4, 8, 16, 2); p(outline, 2, 10, 20, 10); p(outline, 4, 20, 16, 2);
  p('#5c8d5b', 3, 12, 18, 8); p(skin, 3, 9, 18, 7);
  p('#b3d67d', 6, 12, 12, 4);
  for (const x of [4, 14]) {
    p(outline, x + 1, 4, 5, 2); p(outline, x, 6, 7, 5);
    p(skin, x + 1, 5, 5, 6); p('#f5eeb4', x + 1, 6, 5, 4);
    eye(p, x + 3, 7, pose);
  }
  p('#60935d', 4, 12, 2, 2); p('#60935d', 18, 12, 2, 2);
  p('#507c56', 9, 13, 1, 1); p('#507c56', 14, 13, 1, 1);
  p('#eadba0', 5, 16, 14, 3); p('#c7c68a', 7, 19, 10, 2);
  p('#3d5843', 5, 15, 1, 2); p('#3d5843', 18, 15, 1, 2); p('#3d5843', 6, 17, 12, 1);
  const tuck = [0, 0, 2, 3, 1][pose.frame];
  const left = 1 + tuck;
  const right = 16 - tuck;
  p(outline, left, 20 - tuck, 7, 3); p(outline, right, 21 - tuck, 7, 3);
  p(skin, left + 1, 20 - tuck, 5, 2); p(skin, right + 1, 21 - tuck, 5, 2);
  p('#bfd886', left + 2, 21 - tuck, 1, 1); p('#bfd886', right + 4, 22 - tuck, 1, 1);
}

function mole(p: Pixel, pose: Pose) {
  const fur = '#9388ac';
  p(outline, 8, 4, 8, 2); p(outline, 5, 6, 14, 3); p(outline, 3, 9, 18, 11); p(outline, 5, 20, 14, 3);
  p('#686181', 4, 10, 16, 10); p('#686181', 6, 19, 12, 3);
  p(fur, 6, 7, 12, 10); p(fur, 4, 10, 16, 5);
  p('#b7a6c6', 8, 5, 8, 2); p('#b7a6c6', 6, 7, 8, 2);
  p('#c7abc4', 8, 12, 8, 7); p('#dbadad', 7, 14, 10, 3);
  eye(p, 7, 11, pose, 2); eye(p, 15, 11, pose, 2);
  p('#a55d7a', 9, 13, 6, 4); p('#d6899e', 8, 14, 8, 2); p('#edabb6', 10, 13, 4, 2);
  p(outline, 11, 17, 2, 1);
  const reach = [0, -1, -3, 1, 2][pose.frame];
  for (const [x, y] of [[2, 17 + Math.min(1, reach)], [16, 18 + Math.min(0, -reach)]]) {
    p(outline, x, y, 6, 6); p('#bdaaa9', x + 1, y + 1, 4, 4);
    p(cream, x, y + 3, 2, 2); p(cream, x + 2, y + 4, 1, 2); p(cream, x + 4, y + 3, 1, 2);
  }
}

function owlWing(p: Pixel, frame: GaitFrame) {
  if (frame === 1) {
    p(outline, 1, 6, 3, 5); p(outline, 0, 8, 6, 7); p(outline, 2, 13, 5, 4);
    p('#66899e', 1, 9, 5, 5); p('#a6c2d2', 2, 7, 2, 5); p('#93b5cd', 2, 12, 3, 3);
  } else if (frame === 2 || frame === 4) {
    p(outline, 0, 10, 5, 5); p(outline, 1, 13, 6, 4);
    p('#66899e', 1, 11, 4, 3); p('#a6c2d2', 1, 11, 3, 2); p('#93b5cd', 2, 14, 4, 2);
  } else {
    const y = frame === 3 ? 14 : 12;
    p(outline, 1, y, 5, 8); p('#66899e', 2, y + 1, 3, 6); p('#a6c2d2', 2, y + 1, 2, 4);
  }
}

function owl(p: Pixel, pose: Pose) {
  const feathers = '#93b5cd';
  p(outline, 8, 2, 8, 2); p(outline, 5, 4, 14, 3); p(outline, 3, 7, 18, 12); p(outline, 5, 19, 14, 3);
  p('#66899e', 4, 8, 16, 11); p(feathers, 6, 5, 12, 15); p('#b9d3dc', 8, 3, 8, 3);
  owlWing(p, pose.frame);
  owlWing((color, x, y, width, height) => p(color, CRITTER_SIZE - x - width, y, width, height), pose.frame);
  for (const x of [4, 12]) {
    p('#5f758e', x + 1, 6, 6, 10); p('#ddd5c4', x, 8, 8, 6);
    p(cream, x + 1, 7, 6, 8); p('#fff2db', x + 2, 8, 3, 2);
    eye(p, x + 3, 10, pose, 4);
  }
  p('#c2834d', 10, 13, 4, 2); p('#f3ba63', 11, 13, 2, 3); p('#f6ce7b', 11, 13, 2, 1);
  p('#c1d6d9', 8, 16, 8, 4); p('#688da3', 9, 17, 2, 1); p('#688da3', 13, 17, 2, 1);
  p('#688da3', 11, 19, 2, 1);
  const feet = pose.frame ? 20 : 22;
  p(outline, 6, feet - Number(!pose.frame), 5, 2); p(outline, 13, feet, 5, 2);
  p('#dda967', 7, feet - Number(!pose.frame), 3, 1); p('#dda967', 14, feet, 3, 1);
}

function cat(p: Pixel, pose: Pose) {
  const fur = '#dca7be';
  const curl = [0, -2, -1, 1, 0][pose.frame];
  p(outline, 1, 8 + curl, 3, 2); p(outline, 0, 10 + curl, 3, 8 - curl); p(outline, 1, 17, 7, 4);
  p('#a06b96', 1, 10 + curl, 1, 8 - curl); p(fur, 2, 9 + curl, 1, 3); p(fur, 2, 18, 5, 2);
  p(outline, 7, 16, 13, 7); p('#bb85a3', 8, 16, 11, 6); p('#f8d8c3', 10, 17, 6, 4);
  const reach = [0, 3, 1, -2, -1][pose.frame];
  p(outline, 7 - reach, 21, 5, 2); p(outline, 15 + reach, 22, 5, 2);
  p(fur, 8 - reach, 21, 3, 1); p(fur, 16 + reach, 22, 3, 1);
  p(outline, 5, 3, 3, 3); p(outline, 5, 6, 6, 3); p(outline, 18, 3, 3, 3); p(outline, 15, 6, 6, 3);
  p(fur, 6, 4, 1, 4); p(fur, 7, 5, 1, 3); p(fur, 19, 4, 1, 4); p(fur, 18, 5, 1, 3);
  p('#ba758f', 7, 6, 2, 2); p('#ba758f', 17, 6, 2, 2);
  p(outline, 6, 8, 14, 2); p(outline, 4, 10, 18, 7); p(outline, 7, 17, 13, 3);
  p(fur, 6, 8, 14, 10); p(fur, 5, 11, 16, 5); p('#eebed0', 8, 9, 10, 2);
  p('#ad7698', 9, 8, 1, 2); p('#ad7698', 12, 8, 2, 3); p('#ad7698', 16, 8, 1, 2);
  p('#f9dbca', 9, 14, 9, 4);
  eye(p, 8, 12, pose); eye(p, 16, 12, pose);
  p('#945066', 12, 14, 3, 1); p(outline, 13, 16, 1, 1);
  p('#734d70', 3, 13, 5, 1); p('#734d70', 4, 16, 4, 1);
  p('#734d70', 19, 13, 5, 1); p('#734d70', 19, 16, 4, 1);
}

const artists = { hare, fox, frog, mole, owl, cat } satisfies Record<Critter, (p: Pixel, pose: Pose) => void>;
const sprites = new Map<string, HTMLCanvasElement>();

export function critterSprite(critter: Critter, frame: GaitFrame = 0, side = 0, knockedOut = false): HTMLCanvasElement {
  const key = `${critter}:${frame}:${side}:${knockedOut}`;
  const cached = sprites.get(key);
  if (cached) return cached;
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = CRITTER_SIZE;
  const ctx = sprite.getContext('2d')!;
  const mirror = critter === 'fox' ? side > 0 : side < 0;
  if (mirror) {
    ctx.translate(CRITTER_SIZE, 0);
    ctx.scale(-1, 1);
  }
  artists[critter]((color, x, y, width, height) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);
  }, { frame, gaze: mirror ? -side : side, knockedOut });
  sprites.set(key, sprite);
  return sprite;
}
