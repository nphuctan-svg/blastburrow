import { ARENA_TEAMS, BASE_BOMB_RANGE, HEIGHT, REGIONS, ROOT_LANCE_BONUS, WIDTH, bombFuseFor, missionFor, regionFor,
  type Critter, type Gadget } from './content.js';
import { CRITTER_SIZE, critterGait, critterSprite } from './critters.js';
import { DIRECTIONS, FLAME_LINKS, exitOpen, hazardAt, index, nextPoint, shutterClosed, tileAt,
  type Bomb, type Direction, type EnemyKind, type Flame, type ItemKind, type Point, type State, type VisualCue } from './engine.js';
import { rootwarrenLesson, type MarkKind } from './rootwarren.js';

const CELL = 48;
const PLAYER_SIZE = 36;
const seatColors = ['#f3cd7d', '#cbb1e2', '#b3d6a4', '#8ebfd9'];
const edge = '#29292e';
const cream = '#ffecd0';
const lookSide = (facing: Direction) => facing === 'left' ? -1 : facing === 'right' ? 1 : 0;
type Paint = (color: string, x: number, y: number, w: number, h: number) => void;
const mixed = (hex: string, delta: number) => {
  const raw = Number.parseInt(hex.slice(1), 16);
  return '#' + [raw >> 16, raw >> 8 & 255, raw & 255]
    .map(value => Math.min(255, Math.max(0, value + delta)).toString(16).padStart(2, '0')).join('');
};
const seedCell = (i: number, n: number) => ((Math.imul(i + 17, 7325719) ^ Math.imul(n + 3, 851789)) >>> 0) % 997;
function paint(ctx: CanvasRenderingContext2D, originX: number, originY: number, scale = 1): Paint {
  return (color, x, y, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(originX + x * scale), Math.round(originY + y * scale), w * scale, h * scale);
  };
}

function teamBadge(p: Paint, team: typeof ARENA_TEAMS[number], own: boolean) {
  const border = own ? cream : '#18151b';
  p(border, -11, -9, 22, 18);
  p(border, -13, -7, 26, 14);
  p('#252029', -11, -7, 22, 14);
  if (team.shape === 'diamond') {
    p(team.color, -2, -7, 4, 14);
    p(team.color, -4, -5, 8, 10);
    p(team.color, -6, -3, 12, 6);
    p(team.color, -8, -1, 16, 2);
  } else {
    p(team.color, -5, -6, 10, 12);
    p(team.color, -7, -4, 14, 8);
  }
}

const avatarCache = new Map<Critter, string>();
export function avatarFor(critter: Critter) {
  const cached = avatarCache.get(critter);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const context = canvas.getContext('2d')!;
  const p = paint(context, 5, 4);
  p('#4a3a30', 0, 10, 22, 16);
  p('#564435', -3, 15, 28, 12);
  context.drawImage(critterSprite(critter), 4, 4);
  const uri = canvas.toDataURL();
  avatarCache.set(critter, uri);
  return uri;
}

function ground(p: Paint, x: number, y: number, palette: string[], path: boolean, seed: number) {
  const floor = path ? mixed(palette[0], 9) : palette[(x + y) % 2];
  p(floor, 0, 0, CELL, CELL);
  p(mixed(floor, 6), 0, 0, 48, 2);
  p(mixed(floor, -7), 0, 46, 48, 2);
  if (path) {
    p(mixed(floor, -5), 0, 8, 48, 34);
    p(mixed(floor, 3), 4, 11, 40, 26);
    p(mixed(floor, -6), 12, 40, 27, 2);
    p(mixed(floor, 3), 3, 7, 26, 2);
  }
  for (let i = 0; i < 17; i++) {
    const a = seedCell(seed + x * 37 + y * 71, i * 3);
    const b = seedCell(seed + y * 17 + x * 61, i * 5 + 1);
    p(mixed(floor, i % 3 === 0 ? 12 : i % 2 === 0 ? -9 : 6), a % 44, b % 46, i % 4 === 0 ? 4 : 2, 2);
  }
  if (!path && (x * 3 + y * 5) % 6 < 3) {
    const a = 8 + seedCell(seed + x, y) % 28;
    const b = 9 + seedCell(seed + y, x) % 24;
    p(mixed(palette[2], -9), a, b, 2, 6);
    p(mixed(palette[2], -15), a - 2, b + 2, 2, 3);
    p(mixed(palette[2], 8), a + 2, b - 1, 2, 3);
    if ((x + y) % 4 === 0) p('#ccb884', a + 2, b - 3, 2, 2);
  }
}

function wall(p: Paint, palette: string[], x: number, y: number) {
  const green = palette[2];
  const base = mixed(green, -33);
  const rocks = ['#4b473d', '#5e5645', '#6e6550'];
  p('#30362a', 2, 30, 44, 15);
  p(rocks[0], 3, 26, 42, 14);
  p(rocks[1], 5, 27, 38, 8);
  p(rocks[2], 8, 32, 8, 4);
  p(rocks[2], 27, 34, 9, 3);
  p('#403b34', 19, 31, 2, 8); p('#403b34', 37, 28, 2, 9);
  p(base, 1, 10, 46, 20); p(base, 5, 4, 38, 31); p(base, 11, 2, 28, 4);
  p(green, 4, 12, 40, 13); p(green, 8, 6, 34, 18);
  p(mixed(green, -14), 7, 23, 33, 6);
  p(mixed(green, -16), 3, 22, 12, 5); p(mixed(green, -9), 33, 25, 12, 4);
  for (let n = 0; n < 10; n++) {
    const v = seedCell(x * 47 + y * 67, n);
    const a = 7 + v % 32;
    const b = 8 + Math.floor(v / 13) % 16;
    p(mixed(green, [13, -5, 23, -14][n % 4]), a, b, 3 + n % 4, 2);
    if (n % 4 === 0) p(mixed(green, 12), a + 1, b - 2, 2, 2);
  }
  if ((x * 3 + y) % 7 === 0) {
    p('#e7bf75', 13, 15, 2, 3); p('#e7bf75', 12, 16, 4, 1);
    p('#cad3a0', 33, 22, 2, 2);
  }
}

function border(p: Paint, palette: string[], x: number, y: number) {
  const top = y === 0;
  const solid = mixed(palette[1], -25);
  const mid = mixed(palette[2], -24);
  const hi = mixed(palette[2], -5);
  p(solid, 0, 0, 48, 48);
  if (top) p(mixed(solid, -9), 0, 0, 48, 16);
  const baseY = top ? 17 : 6;
  p(mid, 0, baseY + 11, 48, 13);
  p(mid, 4, baseY + 5, 40, 12);
  p(mid, 12, baseY, 28, 12);
  p(mixed(mid, -9), 0, baseY + 23, 48, 8);
  p(mixed(mid, -13), 4, baseY + 28, 12, 7); p(mixed(mid, -13), 28, baseY + 27, 18, 6);
  for (let i = 0; i < 17; i++) {
    const seed = seedCell(x * 19 + y * 97, i);
    const xx = seed % 43;
    const yy = baseY + 6 + (seed >> 2) % 20;
    p(i % 4 === 0 ? hi : mixed(mid, i % 2 === 0 ? 8 : -5), xx, yy, i % 3 + 3, 2);
  }
  if ((x + 2 * y) % 4 === 0) {
    p('#7c714e', 19, baseY + 13, 3, 4);
    p('#d1a66b', 17, baseY + 12, 5, 2);
    p('#aa735b', 25, baseY + 21, 3, 2);
  }
}

function crate(p: Paint, palette: string[], x: number, y: number) {
  const wood = palette[3];
  p('#414132', 4, 35, 41, 7);
  p('#45342e', 4, 8, 40, 31); p('#45342e', 8, 5, 32, 38);
  p(mixed(wood, -35), 7, 10, 34, 27);
  p(wood, 7, 8, 34, 7);
  p(mixed(wood, 17), 8, 7, 31, 3); p(mixed(wood, 32), 10, 8, 24, 2);
  p(mixed(wood, -13), 8, 16, 31, 17);
  p(mixed(wood, -26), 7, 33, 34, 5); p('#634c35', 9, 39, 30, 2);
  p(mixed(wood, 2), 10, 15, 2, 19); p(mixed(wood, 1), 35, 15, 2, 19);
  p(mixed(wood, 13), 15, 17, 4, 2); p(mixed(wood, 0), 14, 25, 16, 2);
  p(mixed(wood, -29), 13, 21, 20, 1); p(mixed(wood, -30), 14, 29, 19, 1);
  p('#d9aa69', 11, 13, 2, 2); p('#d9aa69', 35, 13, 2, 2);
  p('#d9aa69', 11, 33, 2, 2); p('#d9aa69', 35, 33, 2, 2);
  if ((x + y) % 3 !== 1) {
    p('#72583d', 21, 17, 7, 11);
    p('#856d44', 19, 20, 10, 6);
    p('#deb27a', 22, 19, 4, 6); p('#dfbb82', 20, 21, 8, 2);
    p('#ad8557', 23, 23, 2, 3);
  } else {
    for (let i = 0; i < 5; i++) p(mixed(wood, 24), 15 + i * 3, 17 + i * 3, 4, 4);
  }
}

function special(p: Paint, kind: string, closed: boolean) {
  if (kind === 'root') {
    p('#3e3d2c', 5, 16, 38, 22);
    p('#796443', 9, 14, 30, 21);
    for (let i = 0; i < 5; i++) {
      p(i % 2 ? '#56482e' : '#a08b58', 9 + 6 * i, 9 + 3 * (i % 3), 4, 27);
      p('#887748', 8 + 6 * i, 18 + (i % 3) * 4, 9, 4);
    }
    p('#879364', 10, 10, 12, 3); p('#b0ae70', 20, 28, 12, 3); p('#bba477', 23, 8, 3, 3);
  } else if (kind === 'reed') {
    for (let i = 0; i < 8; i++) {
      p(i % 2 ? '#94a572' : '#527557', 6 + i * 5, 15 - i * 3 % 11, 3, 22 + i * 3 % 11);
      p('#c7b178', 6 + i * 5, 12 - i * 3 % 11, 3, 5);
    }
  } else if (kind === 'ice') {
    p('#81aabb', 0, 0, 48, 48); p('#719eaf', 0, 42, 48, 6);
    p('#b9d5da', 7, 13, 13, 2); p('#c5e4e4', 30, 29, 9, 2); p('#a7cbd3', 29, 6, 2, 8);
  } else if (kind === 'rail') {
    for (let i = 0; i < 4; i++) p('#705744', i * 13 + 2, 14, 7, 23);
    p('#b39580', 0, 17, 48, 3); p('#b39580', 0, 29, 48, 3);
    p('#604d43', 0, 20, 48, 2); p('#604d43', 0, 32, 48, 2);
  } else if (kind === 'vent') {
    p('#4c3355', 9, 14, 30, 23); p('#624067', 12, 13, 24, 22);
    p('#a879aa', 14, 16, 20, 12); p('#db9fc6', 19, 18, 10, 7);
    p('#5d4569', 13, 31, 22, 4);
  } else if (kind === 'shutter') {
    p('#574044', 2, 7, 44, 32); p('#b38c71', 6, 9, 5, 27); p('#b38c71', 37, 9, 5, 27);
    p('#46383e', 11, 13, 26, 20);
    if (closed) for (let i = 0; i < 4; i++) p('#a37564', 13 + i * 6, 12, 3, 23);
    else p('#cf9b75', 12, 34, 25, 3);
  }
}

function marker(p: Paint, open: boolean, time: number) {
  p('#303630', 7, 23, 34, 18); p('#776d5a', 8, 20, 32, 17);
  p('#655e4b', 13, 13, 22, 22); p('#9e947a', 13, 12, 22, 5);
  p('#a5a78a', 17, 8, 14, 5); p('#3b4337', 17, 17, 14, 17);
  p(open ? '#8eb36d' : '#5e584a', 19, 19, 10, 12);
  p(open ? '#d1df9d' : '#827263', 22, 21, 4, 6);
  if (open) {
    p('#ecdd96', 10, 18 - time % 9, 2, 3);
    p('#ddcd85', 34, 10 + time % 7, 2, 3);
  } else p('#c4a679', 22, 25, 4, 4);
}

const pickupColors: Record<ItemKind, readonly [rim: string, face: string]> = {
  capacity: ['#7588af', '#d8e4ed'],
  range: ['#c67a48', '#ffdfa5'],
  speed: ['#729566', '#dcebb4'],
  heart: ['#c48485', '#ffdbcf'],
  relic: ['#9a7baf', '#e6d8ec']
};
const pickupKinds = Object.keys(pickupColors) as ItemKind[];

function itemArt(p: Paint, kind: ItemKind) {
  const [rim, face] = pickupColors[kind];
  p('#22251b80', 8, 39, 32, 6);
  p(edge, 5, 8, 38, 31); p(edge, 9, 4, 30, 39);
  p(rim, 7, 9, 34, 29); p(rim, 10, 6, 28, 35);
  p(face, 9, 10, 30, 27);
  p('#fff7e2', 11, 8, 26, 2); p('#fff7e2', 9, 10, 2, 11);

  if (kind === 'range') {
    p('#733840', 21, 10, 6, 11); p('#733840', 26, 15, 5, 17);
    p('#733840', 16, 17, 4, 13); p('#733840', 13, 21, 22, 11); p('#733840', 17, 32, 14, 4);
    p('#dc6142', 23, 13, 3, 13); p('#dc6142', 19, 22, 12, 11);
    p('#dc6142', 16, 24, 16, 7); p('#dc6142', 18, 20, 2, 6); p('#dc6142', 20, 31, 9, 3);
    p('#ffa74d', 22, 22, 5, 11); p('#ffa74d', 19, 26, 11, 6);
    p('#fff2af', 23, 27, 4, 6); p('#fff2af', 22, 29, 6, 3);
  } else if (kind === 'capacity') {
    p('#313047', 11, 21, 21, 11); p('#313047', 14, 17, 15, 19);
    p('#52678f', 14, 22, 15, 9); p('#52678f', 16, 19, 11, 14);
    p('#9fbedb', 15, 21, 6, 3); p('#9fbedb', 14, 24, 3, 3);
    p('#674c48', 22, 14, 3, 5); p('#674c48', 24, 12, 4, 3);
    p('#f4a95c', 27, 10, 3, 3); p('#f9d579', 28, 11, 2, 2);
    p('#31535c', 31, 12, 4, 12); p('#31535c', 27, 16, 12, 4);
    p('#c1edc8', 32, 13, 2, 10); p('#c1edc8', 28, 17, 10, 2);
  } else if (kind === 'speed') {
    p('#345749', 11, 17, 8, 2); p('#345749', 12, 22, 6, 2);
    p('#294238', 18, 12, 11, 20); p('#294238', 16, 25, 19, 10); p('#294238', 34, 28, 3, 5);
    p('#538a65', 20, 14, 7, 14); p('#538a65', 18, 26, 15, 5); p('#538a65', 32, 28, 3, 3);
    p('#99bd7e', 21, 14, 5, 3); p('#f4e1a4', 22, 18, 6, 2); p('#f4e1a4', 22, 22, 6, 2);
    p('#f4e1a4', 18, 31, 16, 2);
  } else if (kind === 'heart') {
    p('#703a50', 14, 13, 9, 5); p('#703a50', 26, 13, 8, 5);
    p('#703a50', 11, 17, 26, 9); p('#703a50', 13, 24, 22, 5);
    p('#703a50', 16, 28, 16, 4); p('#703a50', 19, 31, 10, 4); p('#703a50', 22, 34, 4, 2);
    p('#dc6568', 15, 15, 6, 9); p('#dc6568', 27, 15, 6, 9);
    p('#dc6568', 13, 18, 22, 7); p('#dc6568', 15, 24, 18, 4);
    p('#dc6568', 18, 27, 12, 4); p('#dc6568', 21, 30, 6, 3);
    p('#ffb5a0', 15, 17, 5, 2); p('#ffb5a0', 15, 19, 2, 3);
  } else {
    p('#63455b', 17, 12, 14, 4); p('#63455b', 14, 15, 20, 4); p('#63455b', 11, 18, 26, 5);
    p('#63455b', 14, 22, 20, 4); p('#63455b', 17, 25, 14, 4); p('#63455b', 20, 28, 8, 4); p('#63455b', 22, 31, 4, 4);
    p('#e9ac58', 18, 14, 12, 3); p('#e9ac58', 15, 17, 18, 4); p('#e9ac58', 14, 20, 20, 3);
    p('#d7834a', 18, 23, 12, 4); p('#d7834a', 21, 27, 6, 4); p('#d7834a', 23, 30, 2, 2);
    p('#fff0ad', 18, 17, 7, 3); p('#fff0ad', 17, 19, 4, 2);
    p('#f6c86d', 22, 20, 5, 8); p('#f6c86d', 23, 27, 2, 3);
  }
}

function enemyArt(p: Paint, kind: EnemyKind, regional: string, step: number) {
  const color = kind === 'beetle' ? '#d98a73' : kind === 'moth' ? '#c4add9' : kind === 'crab' ? '#dbab6b' : regional;
  const dark = mixed(color, -44);
  const pale = mixed(color, 24);
  if (kind === 'moth') {
    p(edge, 1, 5 + step, 7, 9); p(edge, 15, 5 + step, 7, 9);
    p(dark, 2, 6 + step, 6, 6); p(dark, 15, 6 + step, 6, 6);
    p(color, 3, 6 + step, 3, 3); p(color, 17, 6 + step, 3, 3);
  } else {
    p(edge, 1, 11, 21, 6); p(dark, 2, 11, 19, 4);
    p(edge, 4, 16 + step, 4, 3); p(edge, 15, 16 + (1 - step), 4, 3);
  }
  p(edge, 6, 4, 11, 2); p(edge, 4, 6, 15, 10);
  p(color, 6, 6, 11, 9); p(pale, 7, 6, 8, 2); p(dark, 6, 13, 11, 3);
  p(cream, 7, 10, 3, 3); p(cream, 13, 10, 3, 3);
  p(edge, 8, 10, 2, 3); p(edge, 14, 10, 2, 3);
  p(edge, 11, 13, 2, 1);
  if (kind === 'boss') {
    p('#744b42', 5, 3, 2, 4); p('#b78b5b', 4, 1, 2, 4);
    p('#744b42', 16, 3, 2, 4); p('#b78b5b', 17, 1, 2, 4);
  }
}

type ActiveCue = VisualCue & { age: number };
const splinterPaths = [[-21, -10], [18, -15], [-16, 5], [21, 0], [-9, -20], [5, -24], [-12, 15], [12, 13]];
function blockBreakArt(ctx: CanvasRenderingContext2D, cue: ActiveCue, wood: string) {
  const p = paint(ctx, cue.x * CELL, cue.y * CELL);
  const { age } = cue;
  const spread = 1 - (1 - age) ** 2;
  const fade = Math.min(1, 3 * (1 - age));
  ctx.globalAlpha = fade * .74;
  for (const offset of [-16, -8, 8, 16]) {
    const x = 20 + offset * spread;
    p('#dfc18b', x, 32 + spread * 6 - Math.abs(offset) * .2, 8, 5);
    p('#eee0b0', x + 2, 31 + spread * 6 - Math.abs(offset) * .2, 4, 2);
  }
  ctx.globalAlpha = fade;
  const shade = mixed(wood, -46);
  const highlight = mixed(wood, 39);
  for (const [i, [dx, dy]] of splinterPaths.entries()) {
    const x = 24 + dx * (.33 + spread * .67);
    const y = 25 + dy * spread - 10 * Math.sin(age * Math.PI) + 7 * age;
    const w = (i % 3 === 0 ? 9 : 6) - Math.floor(age * 3);
    p(shade, x - 1, y - 1, w + 2, 6);
    p(wood, x, y, w, 4);
    p(highlight, x, y, w - 2, 2);
  }
  ctx.globalAlpha = 1;
}

function defeatArt(ctx: CanvasRenderingContext2D, cue: ActiveCue, regional: string) {
  if (cue.kind !== 'knockout' && cue.kind !== 'enemy-defeat') return;
  const { age } = cue;
  const player = cue.kind === 'knockout';
  const x = cue.x * CELL + 24;
  const y = cue.y * CELL + 26;
  const lift = Math.sin(Math.min(1, age / .58) * Math.PI) * (player ? 12 : 9);
  const fall = Math.max(0, (age - .38) / .62);
  const side = player && cue.facing === 'left' ? -1 : 1;
  const fade = Math.min(1, 3.5 * (1 - age));
  const star = player ? '#ffe9a6' : '#eed9f4';

  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate(Math.round(x), Math.round(y - lift + fall * 9));
  ctx.rotate(side * .62 * Math.sin(age * Math.PI));
  ctx.scale(1 - (player ? .08 : .46) * fall, 1 - .53 * fall);
  if (cue.kind === 'knockout') {
    const sprite = critterSprite(cue.critter, 0, lookSide(cue.facing), true);
    ctx.drawImage(sprite, -PLAYER_SIZE / 2, -PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE);
  } else {
    const scale = cue.enemy === 'boss' ? 2 : 1.5;
    enemyArt(paint(ctx, -11 * scale, -9 * scale, scale), cue.enemy, regional, 0);
  }
  ctx.restore();

  ctx.globalAlpha = fade;
  const sparks = paint(ctx, x, y - 14);
  for (const [i, [dx, dy]] of [[-19, -4], [0, -14], [19, -4]].entries()) {
    const sx = dx * (.65 + age * .65);
    const sy = dy * (.65 + age * .7) - lift * .3;
    const glow = i % 2 === 0 ? star : '#ffce8b';
    sparks('#4d3541', sx - 2, sy - 5, 5, 11); sparks('#4d3541', sx - 5, sy - 2, 11, 5);
    sparks(glow, sx - 1, sy - 4, 3, 9); sparks(glow, sx - 4, sy - 1, 9, 3);
  }
  ctx.globalAlpha = 1;
}

function bombArt(p: Paint, bomb: Bomb, tick: number, quick: boolean) {
  const start = bomb.plantedAt ?? bomb.end - bombFuseFor('standard', quick);
  const duration = Math.max(1, bomb.end - start);
  const remaining = Math.max(0, Math.min(duration, bomb.end - tick));
  const age = duration - remaining;
  const fraction = remaining / duration;
  // Integrating the pulse rate keeps it accelerating smoothly as the fuse runs down.
  const pulse = (age * (.042 + .05 * (1 - fraction))) % 1 < .42;
  const imminent = remaining <= 18;
  const slow = duration === bombFuseFor('long', quick);
  p('#30372d', 10, 32, 28, 7);
  p(edge, 13, 17, 22, 18); p(edge, 16, 13, 17, 26);
  p(imminent ? pulse ? '#c56b51' : '#83464a' : pulse ? '#655060' : '#514450', 16, 16, 16, 19);
  p('#9d8289', 17, 17, 8, 3); p('#675665', 17, 20, 5, 6);
  p('#303044', 20, 31, 12, 4);
  p('#9c784f', 25, 10, 4, 7); p('#ae8b5e', 28, 8, 6, 3);
  if (pulse) p(imminent ? '#fb965967' : '#f4bf6455', 29, 1, 12, 12);
  p(pulse ? '#ffcb71' : '#dc8752', 32, 5, 6, 5);
  p(pulse ? '#fff4ba' : '#f3bd6f', 34, 4, 2, 7);
  p('#29272a', 9, 41, 30, 4);
  const charge = Math.ceil(28 * fraction);
  if (charge) p(imminent ? '#ff895e' : slow ? '#d8b9eb' : '#f7ce77', 10, 42, charge, 2);
  if (slow) {
    p('#2c253a', 3, 18, 9, 13);
    p('#dabded', 4, 19, 7, 2); p('#dabded', 4, 28, 7, 2);
    p('#b694d4', 5, 21, 5, 2); p('#d3afe8', 7, 23, 1, 3); p('#b694d4', 5, 26, 5, 2);
  }
  if (bomb.direction) {
    const { x, y } = DIRECTIONS[bomb.direction];
    const marks = [[-2, -2], [0, -1], [2, 0], [0, 1], [-2, 2]];
    const drawTip = (color: string, size: number) => {
      for (const [ahead, side] of marks) {
        p(color, 24 + (16 + ahead) * x + side * y * 2 - size / 2,
          24 + (14 + ahead) * y + side * x * 2 - size / 2, size, size);
      }
    };
    drawTip('#24292b', 5);
    drawTip('#f5dd9e', 2);
  }
}

const flameDirections = Object.keys(FLAME_LINKS) as Direction[];
const opposite: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };

function blastRay(p: Paint, direction: Direction, length: number, width: number, color: string) {
  const { x, y } = DIRECTIONS[direction];
  const center = CELL / 2;
  const across = center - width / 2;
  if (x) p(color, x < 0 ? center - length : center, across, length, width);
  else p(color, across, y < 0 ? center - length : center, width, length);
}

function blastArt(p: Paint, flame: Flame, tick: number) {
  const bright = flame.end - tick > 5;
  const links = flame.links;
  if (links === undefined) {
    p('#b576bb60', 0, 0, CELL, CELL);
    p('#d093c2', 12, 15, 24, 18); p('#eac0d8', 16, 12, 16, 24);
    p('#f5d2df', 19, 19, 10, 10);
    return;
  }

  const rim = bright ? '#e87445' : '#c96246';
  const glow = bright ? '#ffaf55' : '#e99654';
  const core = bright ? '#fff0a4' : '#ffe09a';
  p(bright ? '#ee814655' : '#dc754342', 0, 0, CELL, CELL);
  const connected = flameDirections.filter(direction => links & FLAME_LINKS[direction]);
  for (const direction of connected) {
    blastRay(p, direction, 24, 18, rim);
    blastRay(p, direction, 24, 12, glow);
    blastRay(p, direction, 24, 6, core);
  }
  if (flame.origin) {
    p(rim, 10, 15, 28, 18); p(rim, 15, 10, 18, 28);
    p(glow, 13, 17, 22, 14); p(glow, 17, 13, 14, 22);
    p(core, 17, 17, 14, 14); p('#fff5c8', 21, 21, 6, 6);
  } else if (connected.length === 1) {
    const tip = opposite[connected[0]];
    blastRay(p, tip, 8, 18, rim);
    blastRay(p, tip, 13, 12, rim);
    blastRay(p, tip, 10, 12, glow);
    blastRay(p, tip, 15, 6, glow);
    blastRay(p, tip, 11, 6, core);
  }
}

const gadgetColors: Record<Gadget, [string, string]> = {
  standard: ['#775439', '#b48853'], long: ['#5a466a', '#9c79af'],
  directional: ['#74513b', '#b18b62'], shield: ['#445a43', '#7e9b64']
};

function gadgetSymbol(p: Paint, gadget: Gadget) {
  if (gadget === 'standard') {
    p(edge, 3, 8, 16, 13); p(edge, 6, 6, 10, 17);
    p('#6d5467', 5, 9, 12, 11); p('#453b50', 7, 16, 10, 5); p('#b295a0', 6, 9, 6, 3);
    p('#bf9360', 13, 4, 3, 4); p('#ab824e', 16, 3, 3, 2);
    p('#fbaf61', 18, 1, 4, 6); p('#ffe9ad', 17, 3, 6, 2);
  } else if (gadget === 'long') {
    p(edge, 3, 1, 18, 4); p(edge, 3, 19, 18, 4); p(edge, 5, 5, 14, 14);
    p('#d6b7ea', 4, 2, 16, 2); p('#d6b7ea', 4, 20, 16, 2); p('#5f4874', 7, 5, 10, 14);
    p('#ae8dcc', 7, 5, 2, 5); p('#ae8dcc', 15, 14, 2, 5);
    p('#f5cf87', 9, 7, 6, 3); p('#f5cf87', 11, 10, 2, 5); p('#ffc888', 9, 16, 6, 3);
  } else if (gadget === 'directional') {
    p(edge, 2, 9, 17, 7); p(edge, 12, 3, 5, 19); p(edge, 16, 6, 4, 13); p(edge, 19, 9, 4, 7);
    p('#c47f4f', 3, 10, 13, 5); p('#e9b573', 13, 5, 3, 15); p('#e9b573', 16, 7, 3, 11);
    p('#e9b573', 19, 10, 3, 5); p('#ffe9a8', 7, 11, 14, 2);
  } else {
    p(edge, 3, 3, 18, 12); p(edge, 5, 15, 14, 4); p(edge, 8, 19, 8, 3);
    p('#85a464', 5, 5, 14, 9); p('#728e57', 6, 14, 12, 4); p('#58734a', 9, 18, 6, 3);
    p('#d4df97', 5, 5, 14, 2); p('#cee18b', 11, 7, 2, 11);
    p('#a1bd73', 8, 8, 2, 7); p('#526f49', 15, 8, 2, 7);
  }
}

const gadgetAtlases = new Map<Gadget, { icon: string; diagram: string }>();
export function gadgetArtFor(gadget: Gadget) {
  const cached = gadgetAtlases.get(gadget);
  if (cached) return cached;
  const icon = document.createElement('canvas');
  icon.width = icon.height = 24;
  gadgetSymbol(paint(icon.getContext('2d')!, 0, 0), gadget);

  const diagram = document.createElement('canvas');
  diagram.width = 160;
  diagram.height = 54;
  const ctx = diagram.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const p = paint(ctx, 0, 0);
  const [dark, accent] = gadgetColors[gadget];
  p('#243027', 0, 0, 160, 54);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 7; x++) {
    p((x + y) % 2 ? '#354339' : '#3d4939', 54 + x * 15, 5 + y * 15, 14, 14);
  }
  p('#1d2121', 6, 7, 40, 40); p(dark, 7, 8, 38, 37);
  p(accent, 8, 9, 36, 2); p(mixed(dark, -20), 8, 43, 36, 2);
  ctx.drawImage(icon, 10, 10, 32, 32);
  if (gadget === 'shield') {
    p('#da8259', 69, 24, 17, 6); p('#f5c57f', 69, 26, 19, 2);
    ctx.drawImage(icon, 87, 15);
    gadgetSymbol(paint(ctx, 124, 17, .8), 'standard');
    for (let i = 0; i < 15; i++) p('#f1a68b', 126 + i, 36 - i, 2, 2);
  } else {
    const directional = gadget === 'directional';
    const origin = { x: directional ? 2 : 3, y: 1 };
    const length = BASE_BOMB_RANGE + (directional ? ROOT_LANCE_BONUS : 0);
    const points = [origin];
    for (const direction of directional ? ['right'] as const : flameDirections) {
      let point = origin;
      for (let i = 0; i < length; i++) {
        point = nextPoint(point, direction);
        points.push(point);
      }
    }
    for (const point of points) {
      let links = 0;
      for (const direction of flameDirections) {
        const neighbor = nextPoint(point, direction);
        if (points.some(p => p.x === neighbor.x && p.y === neighbor.y)) links |= FLAME_LINKS[direction];
      }
      blastArt(paint(ctx, 54 + point.x * 15, 5 + point.y * 15, 15 / CELL), { ...point, end: 12, links, origin: point === origin }, 0);
    }
    gadgetSymbol(paint(ctx, 54 + origin.x * 15 + 2, 5 + origin.y * 15 + 2, .46), 'standard');
  }
  const art = { icon: icon.toDataURL(), diagram: diagram.toDataURL() };
  gadgetAtlases.set(gadget, art);
  return art;
}

function lessonMark(p: Paint, kind: MarkKind) {
  const cover = kind === 'cover';
  const color = cover ? '#b2df91' : '#ffdd8f';
  p(cover ? '#314b3bd9' : '#574430df', 11, 11, 26, 26);
  for (const [x, y] of [[9, 9], [32, 9], [9, 32], [32, 32]]) {
    p(color, x, y, 7, 2);
    p(color, x < 20 ? x : x + 5, y < 20 ? y : y - 5, 2, 7);
  }
  if (cover) {
    p(color, 17, 22, 13, 8); p(color, 22, 18, 11, 8);
    p('#4f795b', 19, 27, 9, 2); p('#4f795b', 26, 24, 4, 2);
  } else if (kind === 'bomb') {
    p(color, 18, 20, 11, 10); p(color, 20, 18, 7, 14);
    p('#fff0c5', 26, 16, 3, 4); p('#fff0c5', 28, 15, 3, 2);
  } else if (kind === 'first') {
    p(color, 22, 16, 4, 15); p(color, 19, 19, 4, 3); p(color, 18, 29, 12, 3);
  } else {
    p(color, 18, 16, 12, 3); p(color, 27, 19, 3, 6); p(color, 18, 23, 12, 3);
    p(color, 18, 26, 3, 4); p(color, 18, 29, 12, 3);
  }
}

export function makeRenderer(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.imageSmoothingEnabled = false;
  const pickups = document.createElement('canvas');
  pickups.width = CELL * pickupKinds.length;
  pickups.height = CELL;
  const pickupLayer = pickups.getContext('2d')!;
  for (const [i, kind] of pickupKinds.entries()) itemArt(paint(pickupLayer, i * CELL, 0), kind);
  const terrain = document.createElement('canvas');
  terrain.width = canvas.width;
  terrain.height = canvas.height;
  const layer = terrain.getContext('2d', { alpha: false })!;
  const shading = document.createElement('canvas');
  shading.width = canvas.width;
  shading.height = canvas.height;
  const shade = shading.getContext('2d')!;
  const vignette = shade.createRadialGradient(360, 258, 155, 360, 258, 420);
  vignette.addColorStop(0, '#24211600'); vignette.addColorStop(1, '#22221945');
  shade.fillStyle = vignette;
  shade.fillRect(0, 0, shading.width, shading.height);
  let previousKey = '';
  let enemyPositions = new Map<number, Point>();
  const playerTravel = new Map<string, { position: Point; distance: number; movedAt: number }>();
  let previousMotionKey = '';
  let previousTick = 0;
  let previousTime = 0;
  return function render(state: State, time: number, preview: boolean, yours: string[], playerPositions: ReadonlyMap<string, Point>, visualTick: number, effectsAt: number, cues: ActiveCue[]) {
    const teamArena = state.settings.mode === 'arena' && state.settings.teams;
    const motionKey = `${state.settings.mode}:${state.settings.seed}:${state.stage}:${state.round}:${preview}`;
    if (motionKey !== previousMotionKey || state.tick < previousTick) playerTravel.clear();
    previousMotionKey = motionKey;
    previousTick = state.tick;
    const region = state.settings.mode === 'arena'
      ? REGIONS.find(value => value.id === state.settings.arena) ?? REGIONS[0]
      : regionFor(state.settings.missionId);
    const palette = region.palette;
    const lesson = rootwarrenLesson(state.settings.mode, state.settings.missionId, state.stage);
    const key = (lesson?.kind ?? region.id) + ':' + state.settings.seed + ':' + state.stage + ':' + state.round + ':' + state.tiles.join('');
    if (key !== previousKey) {
      for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
        const point = { x, y };
        const p = paint(layer, x * CELL, y * CELL);
        const tile = state.tiles[index(point)];
        ground(p, x, y, palette, y === 1 || y === 5 || x === 1 || x === 13, state.settings.seed);
        if (tile === 'wall') {
          if (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1) border(p, palette, x, y);
          else if (lesson && flameDirections.every(direction => tileAt(state, nextPoint(point, direction)) === 'wall')) {
            p(mixed(palette[1], -24), 0, 0, CELL, CELL);
            const shade = seedCell(x * 5 + y * 13, 2);
            p(mixed(palette[1], -15), shade % 40, shade % 32 + 4, 5, 2);
          } else wall(p, palette, x, y);
        } else if (tile === 'crate') crate(p, palette, x, y);
        else if (tile !== 'floor' && tile !== 'shutter') special(p, tile, false);
      }
      for (const [x, y] of [[1, 0], [13, 0], [1, 10], [13, 10]]) {
        const p = paint(layer, x * CELL, y * CELL);
        p('#362f28', 18, 24, 12, 14); p('#8c7550', 19, 23, 10, 8);
        p('#e1ab66', 21, 24, 6, 5); p('#f4cf77', 23, 23, 3, 5);
        p('#b0884d', 18, 30, 12, 3);
      }
      previousKey = key;
    }
    ctx.drawImage(terrain, 0, 0);
    const step = Math.floor(time / 185);
    const smooth = Math.min(1, Math.max(.12, (time - previousTime) / 60));
    previousTime = time;
    for (let y = 1; y < HEIGHT - 1; y++) for (let x = 1; x < WIDTH - 1; x++) {
      const point = { x, y };
      const tile = tileAt(state, point);
      if (tile === 'wall') continue;
      const p = paint(ctx, x * CELL, y * CELL);
      if (tile === 'shutter') special(p, tile, shutterClosed(point, state.tick));
      const danger = hazardAt(state, point);
      if (danger) {
        p(danger === 'hit' ? '#e56d5c57' : '#f1bd7446', 0, 0, 48, 48);
        p(danger === 'hit' ? '#ef9475' : '#dcab6a', 1, 1, 46, 2);
        p(danger === 'hit' ? '#ef9475' : '#dcab6a', 1, 45, 46, 2);
        if (tile === 'rail' && danger === 'hit') {
          p('#55414b', 4, 7, 40, 32); p('#b57e61', 6, 9, 36, 22);
          p('#e0a773', 10, 11, 27, 4); p('#2f2833', 8, 31, 9, 7); p('#2f2833', 31, 31, 9, 7);
        }
      }
    }
    for (const mark of lesson?.marks ?? []) lessonMark(paint(ctx, mark.point.x * CELL, mark.point.y * CELL), mark.kind);
    if (state.carving) {
      const carving = paint(ctx, state.carving.x * CELL, state.carving.y * CELL);
      const tone = step % 6 === 0 ? '#f6d18b' : '#d0bb7a';
      carving('#51463a', 32, 27, 11, 10); carving(tone, 36, 28, 3, 7); carving(tone, 34, 30, 7, 3);
    }
    if (state.settings.mode !== 'arena') {
      marker(paint(ctx, state.exit.x * CELL, state.exit.y * CELL), exitOpen(state), step);
      const rescue = missionFor(state.settings.missionId).objective === 'rescue';
      for (const target of state.targets) {
        const p = paint(ctx, target.x * CELL, target.y * CELL);
        if (rescue && !target.done) {
          if (tileAt(state, target) === 'crate') {
            p('#352f2b', 27, 24, 9, 8);
            p('#edc886', 28, 27, 2, 2); p('#edc886', 32, 27, 2, 2);
            p('#ead499', 21, 2 - step % 3, 6, 2); p('#f8e3a8', 23, -1 - step % 3, 2, 7);
          } else ctx.drawImage(critterSprite('hare', step % 2 ? 4 : 0), target.x * CELL + (CELL - CRITTER_SIZE) / 2, target.y * CELL + 13);
        } else if (!rescue) {
          p('#4d4b3c', 11, 25, 26, 12); p('#95846d', 14, 20, 20, 13);
          p(target.done ? '#b8d380' : '#e2a66a', 18, 16, 12, 13);
          p(target.done ? '#e4f5ac' : '#f1d692', 21, 18, 6, 7);
        }
      }
    }
    for (const item of state.items) {
      const sprite = pickupKinds.indexOf(item.kind) * CELL;
      ctx.drawImage(pickups, sprite, 0, CELL, CELL, item.x * CELL, item.y * CELL - step % 3, CELL, CELL);
    }
    for (const bomb of state.bombs) bombArt(paint(ctx, bomb.x * CELL, bomb.y * CELL), bomb, visualTick, state.settings.fuse === 'quick');
    const blasts = new Map<number, Flame>();
    const blastTick = state.status === 'playing' ? visualTick : effectsAt;
    for (const flame of state.flames) {
      if (state.status !== 'playing' && flame.end <= blastTick) continue;
      const cell = index(flame);
      const other = blasts.get(cell);
      if (!other) blasts.set(cell, { ...flame });
      else {
        other.end = Math.max(other.end, flame.end);
        if (flame.links !== undefined) other.links = (other.links ?? 0) | flame.links;
        other.origin ||= flame.origin;
      }
    }
    for (const flame of blasts.values()) blastArt(paint(ctx, flame.x * CELL, flame.y * CELL), flame, blastTick);
    for (const cue of cues) if (cue.kind === 'crate' || cue.kind === 'gate') {
      blockBreakArt(ctx, cue, cue.kind === 'crate' ? palette[3] : '#a08b58');
    }
    const regionalEnemyColor = ['#c48a67', '#849c6a', '#95b3c7', '#c69566', '#c698c6', '#d38969'][REGIONS.indexOf(region)];
    for (const cue of cues) if (cue.kind === 'enemy-defeat') defeatArt(ctx, cue, regionalEnemyColor);
    const nextEnemyPositions = new Map<number, Point>();
    for (const enemy of state.enemies) if (enemy.hp > 0) {
      const p = paint(ctx, enemy.x * CELL, enemy.y * CELL);
      if (enemy.phase === 'warn' || enemy.phase === 'charge') {
        const cross = enemy.kind === 'boss' && region.id === 'vents';
        for (const direction of cross ? Object.keys(DIRECTIONS) as (keyof typeof DIRECTIONS)[] : [enemy.facing]) {
          let target: Point = enemy;
          for (let i = 0; i < (cross ? 3 : 5); i++) {
            target = nextPoint(target, direction);
            const tile = tileAt(state, target);
            if (['wall', 'root', 'crate'].includes(tile) || tile === 'shutter' && shutterClosed(target, state.tick)) break;
            const signal = paint(ctx, target.x * CELL, target.y * CELL);
            signal(cross ? '#cf9bd35d' : '#e58c6769', 0, 0, CELL, CELL);
            signal(cross ? '#e5bdd9' : '#ffb57b', 18, 22, 12, 3);
          }
        }
        p('#ffd182', 23, 1, 3, 9); p('#ffd182', 23, 12, 3, 3);
      }
      const old = enemyPositions.get(enemy.id);
      const hit = enemy.contactAt !== undefined && state.tick - enemy.contactAt <= 2;
      const pt = !hit && old && Math.abs(enemy.x - old.x) + Math.abs(enemy.y - old.y) < 2.3
        ? { x: old.x + (enemy.x - old.x) * smooth, y: old.y + (enemy.y - old.y) * smooth } : enemy;
      nextEnemyPositions.set(enemy.id, pt);
      const scale = enemy.kind === 'boss' ? 2 : 1.5;
      enemyArt(paint(ctx, pt.x * CELL + 24 - 11 * scale, pt.y * CELL + 15 - scale * 3, scale), enemy.kind, regionalEnemyColor, step % 2);
      if (enemy.phase === 'stunned') p('#f3dc8e', 20 + step % 5, 5, 4, 4);
      if (enemy.kind === 'boss') {
        p('#45373b', 5, 41, 38, 5); p('#efab75', 6, 42, Math.floor(36 * enemy.hp / enemy.maxHp), 3);
      }
    }
    for (const [i, player] of state.players.entries()) {
      if (!player.hp) continue;
      const pt = playerPositions.get(player.id) ?? player;
      const p = paint(ctx, pt.x * CELL, pt.y * CELL);
      const previous = playerTravel.get(player.id);
      const moved = previous ? Math.hypot(pt.x - previous.position.x, pt.y - previous.position.y) : 0;
      const stride = moved <= 2 ? previous : undefined;
      const idleMs = stride ? time - stride.movedAt : Infinity;
      // Follow the drawn path through tile centers and corners, including online interpolation.
      const moving = moved > .0001 && moved <= 2 && !preview;
      const movingWeight = moving ? 1 : Math.max(0, 1 - idleMs / 65);
      const distance = (stride && idleMs < 65 ? stride.distance : 0) + (moving ? moved : 0);
      playerTravel.set(player.id, { position: pt, distance, movedAt: moving ? time : stride?.movedAt ?? -Infinity });
      const gait = critterGait(player.critter, distance, movingWeight);
      p('#363a2b', 9, 35, 31, 7);
      if (!teamArena && (yours.includes(player.id) || !player.bot && !preview)) {
        const ownerColor = seatColors[i];
        p(mixed(ownerColor, -50), 8, 36, 32, 2); p(mixed(ownerColor, -50), 12, 39, 24, 2);
        p(ownerColor, 20, 2, 8, 3); p(ownerColor, 22, 5, 4, 3);
      }
      const alpha = state.tick > 20 && state.tick < player.safeUntil && step % 2 ? .62 : 1;
      ctx.globalAlpha = alpha;
      const sprite = critterSprite(player.critter, gait.frame, lookSide(player.facing));
      const spriteX = Math.round(pt.x * CELL + (CELL - PLAYER_SIZE) / 2);
      const spriteHeight = Math.round(PLAYER_SIZE - gait.squash);
      const spriteY = Math.round(pt.y * CELL + 44 - spriteHeight - gait.lift - Number(preview && step % 4 === 3));
      ctx.drawImage(sprite, spriteX, spriteY, PLAYER_SIZE, spriteHeight);
      ctx.globalAlpha = 1;
      if (player.shield) {
        p('#d6d999', 5, 21, 2, 13); p('#d6d999', 42, 21, 2, 13);
        p('#d6d999', 9, 40, 30, 2);
      }
    }
    for (const cue of cues) if (cue.kind === 'knockout') defeatArt(ctx, cue, regionalEnemyColor);
    enemyPositions = nextEnemyPositions;
    for (const [i, x, y] of [[1, 2, 2], [2, 11, 2], [3, 3, 8], [4, 10, 7], [5, 6, 2], [6, 12, 8]]) {
      const glow = Math.floor(time / 88 + i * 3) % 27;
      if (glow > 18) continue;
      const p = paint(ctx, x * CELL, y * CELL);
      const a = 9 + (step + i * 2) % 17;
      const b = 10 + (step * 2 + i * 17) % 23;
      p('#e1d07b51', a - 2, b - 2, 6, 6); p('#e6d98b', a, b, 2, 2);
    }
    ctx.drawImage(shading, 0, 0);
    if (teamArena) {
      for (const player of state.players) {
        if (!player.hp) continue;
        const pt = playerPositions.get(player.id) ?? player;
        const team = ARENA_TEAMS[player.team];
        const x = pt.x * CELL + (team.shape === 'diamond' ? 13 : 35);
        teamBadge(paint(ctx, x, pt.y * CELL + 3), team, !preview && yours.includes(player.id));
      }
    }
  };
}
