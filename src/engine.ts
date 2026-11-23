import {
  BASE_BOMB_RANGE, CAMPAIGN, CRITTERS, GADGETS, HEIGHT, REGIONS, ROOT_LANCE_BONUS, TICK_RATE, WIDTH, bombFuseFor, missionFor, regionFor,
  type Critter, type Feature, type Gadget, type Mission, type Mode
} from './content.js';
import { rootwarrenLesson, type RootwarrenLesson } from './rootwarren.js';

export type Direction = 'up' | 'down' | 'left' | 'right';
export type Tile = 'floor' | 'wall' | 'crate' | 'root' | 'reed' | 'ice' | 'rail' | 'vent' | 'shutter';
export type ItemKind = 'range' | 'capacity' | 'speed' | 'heart' | 'relic';
export type EnemyKind = 'beetle' | 'moth' | 'crab' | 'boss';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type EventKind = 'plant' | 'blast' | 'crate-break' | 'pickup' | 'hurt' | 'knockout' | 'relay' | 'gate' | 'win' | 'lose' | 'chamber' | 'warn' | 'rescue';

export interface Point { x: number; y: number }
interface MoveStep { from: Point; started: number; direction: Direction; corner?: Point; passedCenter?: boolean }
export interface PlayerMove extends Point { moveAt: number; step: MoveStep }
type PlayerPosition = Pick<Player, 'x' | 'y' | 'moveAt' | 'step'>;
export interface BufferedTurn { direction: Direction; expires: number }
export interface Input { direction?: Direction; alternate?: Direction; turn?: Direction; bomb?: boolean }
export interface Seat { id: string; critter: Critter; gadget: Gadget; bot?: boolean }
export interface Settings {
  mode: Mode;
  missionId: string;
  arena: Feature;
  seed: number;
  teams: boolean;
  difficulty: Difficulty;
  crates: 'light' | 'normal' | 'dense';
  fuse: 'quick' | 'classic';
}
export interface Player extends Seat, Point {
  facing: Direction;
  team: number;
  hp: number;
  range: number;
  capacity: number;
  speed: number;
  shield: boolean;
  moveAt: number;
  step?: MoveStep;
  bufferedTurn?: BufferedTurn;
  bufferedBomb?: { expires: number; facing: Direction };
  safeUntil: number;
  brainAt: number;
}
export interface Bomb extends Point { id: number; owner: string; range: number; end: number; plantedAt?: number; direction?: Direction; slide?: Direction; nextSlide: number }
export interface Flame extends Point { end: number; links?: number; origin?: boolean }
export interface Item extends Point { kind: ItemKind; relic?: string }
export interface Enemy extends Point {
  id: number; kind: EnemyKind; hp: number; maxHp: number; facing: Direction;
  phase: 'roam' | 'warn' | 'charge' | 'stunned'; next: number; until: number; safeUntil: number; home: Point; followup: boolean;
  contactAt?: number;
}
export interface Target extends Point { done: boolean }
export interface GameEvent extends Point { id: number; tick: number; kind: EventKind }
export type VisualCue = Point & { tick: number } & (
  | { kind: 'crate' | 'gate' }
  | { kind: 'knockout'; critter: Critter; facing: Direction }
  | { kind: 'enemy-defeat'; enemy: EnemyKind }
);
export const VISUAL_CUE_TICKS: Record<VisualCue['kind'], number> = {
  crate: 19, gate: 19, knockout: 22, 'enemy-defeat': 17
};
interface PlayerBuild { id: string; range: number; capacity: number; speed: number; spareHeart?: boolean }
export interface Checkpoint { stage: number; score: number; discoveries: string[]; builds: PlayerBuild[]; elapsed: number }
export interface State {
  settings: Settings;
  tiles: Tile[];
  players: Player[];
  bombs: Bomb[];
  flames: Flame[];
  items: Item[];
  hidden: Record<number, Item>;
  enemies: Enemy[];
  targets: Target[];
  carving?: Point;
  chainSupply?: Point;
  exit: Point;
  stage: number;
  stages: number;
  tick: number;
  elapsed: number;
  limit: number;
  score: number;
  discoveries: string[];
  status: 'playing' | 'between' | 'cleared' | 'failed';
  round: number;
  wins: number[];
  winner: number | null;
  restartAt: number;
  events: GameEvent[];
  cues: VisualCue[];
  serial: number;
  checkpoint: Checkpoint;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'adventure', missionId: CAMPAIGN[0].id, arena: 'roots', seed: 117,
  teams: false, difficulty: 'normal', crates: 'normal', fuse: 'classic'
};
const startingBuild = { range: BASE_BOMB_RANGE, capacity: 1, speed: 0 };
const upgradeLimit = { range: 6, capacity: 5, speed: 3 };
const bombBufferTicks = 3;
export const DIRECTIONS: Record<Direction, Point> = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 }
};
const directionList = Object.keys(DIRECTIONS) as Direction[];
export const FLAME_LINKS: Record<Direction, number> = { up: 1, down: 2, left: 4, right: 8 };
const spawns = [{ x: 1, y: 1 }, { x: 13, y: 9 }, { x: 13, y: 1 }, { x: 1, y: 9 }];
const coSpawns = [{ x: 1, y: 1 }, { x: 1, y: 3 }, { x: 3, y: 1 }, { x: 3, y: 3 }];
const levelSlots = [
  [5, 1], [9, 1], [13, 1], [13, 3], [13, 7], [13, 9], [9, 9],
  [5, 9], [1, 9], [3, 7], [7, 3], [9, 5], [5, 5], [11, 7]
] as const;
export const index = (point: Point) => point.y * WIDTH + point.x;
const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
export const nextPoint = (point: Point, direction: Direction): Point => ({
  x: point.x + DIRECTIONS[direction].x, y: point.y + DIRECTIONS[direction].y
});
export const tileAt = (state: State, point: Point) =>
  point.x < 0 || point.x >= WIDTH || point.y < 0 || point.y >= HEIGHT ? 'wall' : state.tiles[index(point)];
export const shutterClosed = (point: Point, tick: number) => (tick + point.x * 11 + point.y * 7) % 150 >= 91;
export const passable = (state: State, point: Point, tick = state.tick) => {
  const tile = tileAt(state, point);
  return tile !== 'wall' && tile !== 'crate' && tile !== 'root' && (tile !== 'shutter' || !shutterClosed(point, tick));
};
export const capacityFor = (player: Player) => Math.max(1, player.capacity - Number(player.gadget === 'shield'));
export const moveDelay = (player: Pick<Player, 'speed'>) => Math.max(3, 6 - player.speed);
export function slidePosition(from: Point, to: Point, progress: number): Point {
  const amount = Math.min(1, Math.max(0, progress));
  return { x: from.x + (to.x - from.x) * amount, y: from.y + (to.y - from.y) * amount };
}
export function playerPosition(player: PlayerPosition, tick: number): Point {
  const step = player.step;
  if (!step) return { x: player.x, y: player.y };
  const progress = (tick - step.started) / (player.moveAt - step.started);
  if (!step.corner) return slidePosition(step.from, player, progress);
  return slidePosition(slidePosition(step.from, step.corner, progress), slidePosition(step.corner, player, progress), progress);
}
const gridCell = (point: Point): Point => ({ x: Math.round(point.x), y: Math.round(point.y) });

export function playerCell(player: PlayerPosition, tick: number): Point {
  return gridCell(playerPosition(player, tick));
}
export const canMove = (state: State, point: Point, tick = state.tick) =>
  passable(state, point, tick) && !state.bombs.some(bomb => same(bomb, point));

export function planPlayerMove(state: State, player: PlayerPosition & Pick<Player, 'speed'>, direction: Direction, tick = state.tick): PlayerMove | undefined {
  const origin = { x: player.x, y: player.y };
  const destination = nextPoint(origin, direction);
  if (!canMove(state, destination, tick)) return;
  const stride = moveDelay(player);
  const current = player.step;
  if (!current || tick >= player.moveAt) {
    const passedCenter = current?.direction === direction && tick <= player.moveAt + 1;
    return { ...destination, moveAt: tick + stride, step: { from: origin, started: tick, direction, passedCenter } };
  }
  if (!current.direction || direction === current.direction) return;

  const from = playerPosition(player, tick);
  const heading = DIRECTIONS[current.direction];
  const reverse = same(DIRECTIONS[direction], { x: -heading.x, y: -heading.y });
  const offAxis = heading.x ? from.y !== origin.y : from.x !== origin.x;
  // Finish entering the outgoing corridor before steering into a second corner.
  if (offAxis && !same(gridCell(from), origin) && !(reverse && current.corner)) return;
  if (reverse) {
    const remaining = Math.hypot(from.x - destination.x, from.y - destination.y);
    return { ...destination, moveAt: tick + Math.max(1, Math.ceil(remaining * stride)), step: { from, started: tick, direction } };
  }
  return { ...destination, moveAt: player.moveAt + stride, step: { from, started: tick, direction, corner: origin } };
}

function catchLateTurn(state: State, player: PlayerPosition & Pick<Player, 'speed'>, forward: Direction, direction: Direction, tick: number)
  : PlayerMove | undefined {
  const step = player.step;
  if (!step?.passedCenter || tick >= player.moveAt) return;

  const heading = DIRECTIONS[forward];
  const opening = { x: player.x - heading.x, y: player.y - heading.y };
  if (!same(step.from, opening)) return;

  const from = playerPosition(player, tick);
  const overshoot = distance(from, opening);
  // Only the corner behind this straight slide is eligible.
  if (overshoot > .67 || !canMove(state, opening, tick)) return;
  const destination = nextPoint(opening, direction);
  if (!canMove(state, destination, tick)) return;

  const stride = moveDelay(player);
  return { ...destination, moveAt: tick + stride + Math.ceil(overshoot * stride / 2),
    step: { from, started: tick, direction, corner: opening } };
}

export function steerPlayer(state: State, player: PlayerPosition & Pick<Player, 'speed' | 'bufferedTurn'>, input: Input, tick = state.tick)
  : { move?: PlayerMove; bufferedTurn?: BufferedTurn } {
  const forward = player.step?.direction;
  const queued = player.bufferedTurn && tick <= player.bufferedTurn.expires ? player.bufferedTurn : undefined;
  const followQueued = !input.alternate && queued && (!input.direction || input.direction === forward);
  const requested = input.turn ?? (followQueued ? queued.direction : input.direction);
  if (!requested) return {};

  const turn = planPlayerMove(state, player, requested, tick);
  if (turn) return { move: turn };

  const perpendicular = forward && Boolean(DIRECTIONS[forward].x) !== Boolean(DIRECTIONS[requested].x);
  if (perpendicular && (!input.alternate || input.turn === requested)) {
    const recovered = catchLateTurn(state, player, forward, requested, tick);
    if (recovered) return { move: recovered };
  }
  if (input.alternate) {
    if (canMove(state, nextPoint(player, requested), tick)) return {};
    // The preferred key stays held, so the next tick can try it again.
    const alternate = input.direction === requested ? input.alternate : input.direction;
    return { move: alternate && planPlayerMove(state, player, alternate, tick) };
  }

  const continuing = queued?.direction === requested;
  if (!perpendicular || (!continuing && tick > player.moveAt)) return {};
  const move = planPlayerMove(state, player, forward, tick);
  if (!move && tick >= player.moveAt) return {};

  // A tap can look ahead two tiles. A held turn stays queued while the player advances.
  const entered = input.turn === requested || input.direction === requested;
  const bufferedTurn = !continuing || entered ? { direction: requested, expires: tick + 2 * moveDelay(player) } : queued;
  return { move, bufferedTurn };
}

export function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function emit(state: State, kind: EventKind, point: Point) {
  state.events.push({ id: ++state.serial, tick: state.tick, kind, x: point.x, y: point.y });
  if (state.events.length > 28) state.events.shift();
}

export function cleanSettings(value: unknown): Settings {
  const raw = typeof value === 'object' && value !== null ? value as Partial<Settings> : {};
  return {
    mode: (['adventure', 'arena', 'challenge', 'expedition'] as const).find(mode => mode === raw.mode) ?? 'adventure',
    missionId: CAMPAIGN.find(mission => mission.id === raw.missionId)?.id ?? DEFAULT_SETTINGS.missionId,
    arena: REGIONS.find(region => region.id === raw.arena)?.id ?? 'roots',
    seed: Number.isSafeInteger(raw.seed) ? (raw.seed as number) >>> 0 : DEFAULT_SETTINGS.seed,
    teams: raw.teams === true,
    difficulty: (['easy', 'normal', 'hard'] as const).find(item => item === raw.difficulty) ?? 'normal',
    crates: (['light', 'normal', 'dense'] as const).find(item => item === raw.crates) ?? 'normal',
    fuse: raw.fuse === 'quick' ? 'quick' : 'classic'
  };
}

export function cleanSeat(id: string, critter: unknown, gadget: unknown): Seat {
  return {
    id,
    critter: typeof critter === 'string' && Object.hasOwn(CRITTERS, critter) ? critter as Critter : 'hare',
    gadget: typeof gadget === 'string' && Object.hasOwn(GADGETS, gadget) ? gadget as Gadget : 'standard'
  };
}

export function addArenaBots(seats: Seat[], total: number): Seat[] {
  const used = new Set(seats.map(seat => seat.critter));
  const bots = (['fox', 'frog', 'mole', 'owl', 'cat', 'hare'] as Critter[]).filter(critter => !used.has(critter));
  return [...seats, ...Array.from({ length: Math.max(0, Math.min(4, total) - seats.length) }, (_, i) => ({
    id: 'bot-' + i, critter: bots[i], gadget: 'standard' as const, bot: true
  }))];
}

export function createGame(settings: Settings, seats: Seat[], checkpoint?: Checkpoint): State {
  const arena = settings.mode === 'arena';
  const mission = missionFor(settings.missionId);
  const state: State = {
    settings, tiles: [], players: seats.slice(0, 4).map((seat, position) => ({
      ...seat, ...spawns[position], facing: 'down',
      team: settings.teams ? position % 2 : position,
      ...startingBuild, hp: 1, shield: false,
      moveAt: 0, safeUntil: 0, brainAt: 0
    })),
    bombs: [], flames: [], items: [], hidden: {}, enemies: [], targets: [], exit: { x: 13, y: 9 },
    stage: checkpoint?.stage ?? 0, stages: arena ? 1 : mission.chambers, tick: 0, elapsed: checkpoint?.elapsed ?? 0,
    limit: 0, score: checkpoint?.score ?? 0, discoveries: [...(checkpoint?.discoveries ?? [])],
    status: 'playing', round: 1, wins: [0, 0, 0, 0], winner: null, restartAt: 0, events: [], cues: [], serial: 0,
    checkpoint: { stage: 0, score: 0, discoveries: [], builds: [], elapsed: 0 }
  };
  for (const player of state.players) {
    const build = checkpoint?.builds.find(item => item.id === player.id);
    if (build) {
      const { spareHeart, ...upgrades } = build;
      Object.assign(player, upgrades, { hp: spareHeart ? 2 : 1 });
    }
  }
  loadChamber(state);
  return state;
}

function placeFloor(state: State, point: Point) {
  state.tiles[index(point)] = 'floor';
  delete state.hidden[index(point)];
}

function loadChamber(state: State) {
  const mission = missionFor(state.settings.missionId);
  const arena = state.settings.mode === 'arena';
  const feature = arena ? state.settings.arena : regionFor(mission.id).id;
  state.bombs = [];
  state.flames = [];
  state.cues = [];
  state.items = [];
  state.hidden = {};
  state.enemies = [];
  state.targets = [];
  state.carving = undefined;
  state.chainSupply = undefined;
  const timeLimit = mission.objective === 'escape' ? 110 + state.stage * 12 : 360;
  state.limit = state.tick + TICK_RATE * (arena ? 180 : state.settings.mode === 'challenge' ? Math.floor(timeLimit * .7) : timeLimit);
  const lesson = rootwarrenLesson(state.settings.mode, mission.id, state.stage);
  const origin = lesson ? loadRootwarrenLesson(state, lesson) : generateChamber(state, mission, feature, arena);
  for (const [position, player] of state.players.entries()) {
    if (arena || state.stage === 0) Object.assign(player, startingBuild);
    Object.assign(player, origin[position], {
      hp: !arena && player.hp === 2 ? 2 : 1, shield: player.gadget === 'shield', facing: 'right', moveAt: state.tick, step: undefined, bufferedTurn: undefined, bufferedBomb: undefined,
      safeUntil: state.tick + 18, brainAt: state.tick + (position + 1) * 2
    });
  }
  state.checkpoint = {
    stage: state.stage, score: state.score, discoveries: [...state.discoveries], elapsed: state.elapsed,
    builds: state.players.map(({ id, range, capacity, speed, hp }) => ({ id, range, capacity, speed, spareHeart: hp === 2 }))
  };
  emit(state, 'chamber', origin[0]);
}

function loadRootwarrenLesson(state: State, lesson: RootwarrenLesson): Point[] {
  const starts: Point[] = [];
  state.tiles = lesson.cells.map((symbol, cell) => {
    const point = { x: cell % WIDTH, y: Math.floor(cell / WIDTH) };
    const seat = 'abcd'.indexOf(symbol);
    if (seat >= 0) starts[seat] = point;
    if (symbol === 'E') state.exit = point;
    if (symbol === '+' || symbol === 'F') {
      state.hidden[cell] = { ...point, kind: symbol === '+' ? 'capacity' : 'range' };
      return 'crate';
    }
    if (symbol === 'K') state.targets.push({ ...point, done: false });
    if (symbol === 'M') addEnemy(state, point, 'moth', 1).next = state.tick + 30;
    if (symbol === 'R' && !state.discoveries.includes('roots:0')) {
      state.hidden[cell] = { ...point, kind: 'relic', relic: 'roots:0' };
      state.carving = { x: point.x - 1, y: point.y };
    }
    if (symbol === '#') return 'wall';
    if (symbol === 'G') return 'root';
    if (symbol === 'C' || symbol === 'K' || symbol === 'R') return 'crate';
    return 'floor';
  });
  if (lesson.gate) state.chainSupply = { x: lesson.gate.x - 2, y: lesson.gate.y };
  return starts;
}

function generateChamber(state: State, mission: Mission, feature: Feature, arena: boolean): Point[] {
  const regionalIndex = REGIONS.findIndex(region => region.id === feature);
  const finalBoss = !arena && mission.objective === 'boss' && state.stage === state.stages - 1;
  const random = rng(state.settings.seed ^ Math.imul(1 + state.stage, 374761393) ^ Math.imul(state.round, 1597334677));
  const density = arena ? { light: .24, normal: .40, dense: .56 }[state.settings.crates] : .36 + (state.stage % 3) * .07;
  const points = Array.from({ length: WIDTH * HEIGHT }, (_, i) => ({ x: i % WIDTH, y: Math.floor(i / WIDTH) }));
  state.tiles = points.map(point => {
    const { x, y } = point;
    if (x === 0 || x === WIDTH - 1 || y === 0 || y === HEIGHT - 1 || (x % 2 === 0 && y % 2 === 0)) return 'wall';
    if (random() > density) return 'floor';
    const chance = random();
    const kind: ItemKind | undefined = chance < .23 ? 'range' : chance < .42 ? 'capacity' : chance < .52 ? 'speed'
      : !arena && chance < .54 ? 'heart' : undefined;
    if (kind) state.hidden[index(point)] = { ...point, kind };
    return 'crate';
  });

  const origin = arena ? spawns : coSpawns;
  for (const point of origin) {
    placeFloor(state, point);
    for (const dir of directionList) {
      const adjacent = nextPoint(point, dir);
      if (tileAt(state, adjacent) !== 'wall') placeFloor(state, adjacent);
    }
  }

  applyTerrain(state, feature, arena, mission.id, finalBoss);
  const gateTrial = !arena && mission.id === 'roots-2' && state.stage === 1;
  if (gateTrial) {
    for (let y = 1; y < HEIGHT - 1; y++) {
      const point = { x: 7, y };
      placeFloor(state, point);
      state.tiles[index(point)] = y === 5 ? 'root' : 'wall';
    }
    for (let x = 2; x < 7; x++) placeFloor(state, { x, y: 5 });
    placeFloor(state, { x: 8, y: 5 });
    placeFloor(state, { x: 9, y: 5 });
    placeFloor(state, { x: 3, y: 4 });
  }

  if (!arena) {
    const end = state.stage % 2 === 0 ? { x: 13, y: 9 } : { x: 13, y: 1 };
    state.exit = end;
    placeFloor(state, end);
    const available = levelSlots.map(([x, y]) => ({ x, y }))
      .filter(point => distance(point, coSpawns[0]) >= 5 && distance(point, end) >= 2
        && tileAt(state, point) !== 'wall' && tileAt(state, point) !== 'root'
        && (!gateTrial || point.x >= 9));
    const choose = () => available.splice(Math.floor(random() * available.length), 1)[0];
    if (mission.objective === 'rescue' || mission.objective === 'relay' || !finalBoss && mission.objective === 'boss') {
      const count = 2 + Number(state.stage >= 2);
      for (let i = 0; i < count; i++) {
        const point = choose();
        state.targets.push({ ...point, done: false });
        placeFloor(state, point);
        if (mission.objective === 'rescue') state.tiles[index(point)] = 'crate';
      }
    }
    const count = finalBoss ? Math.min(1 + regionalIndex, 3) : Math.min(2 + regionalIndex + state.stage + Math.floor((state.players.length - 1) / 2), 7);
    for (let i = 0; i < count; i++) {
      const point = choose();
      if (!point) break;
      placeFloor(state, point);
      const kind = (['beetle', 'moth', 'crab'] as const)[(i + state.stage + regionalIndex) % 3];
      addEnemy(state, point, kind, 1 + Number(kind === 'crab'));
    }
    if (finalBoss) {
      const point = { x: 7, y: 5 };
      for (const tile of points) if (distance(tile, point) <= 3 && tileAt(state, tile) === 'crate') placeFloor(state, tile);
      placeFloor(state, point);
      addEnemy(state, point, 'boss', 4 + regionalIndex + Math.floor((state.players.length - 1) / 2));
    }
    const missionIndex = regionFor(mission.id).missions.indexOf(mission);
    if ((missionIndex === 0 && state.stage === 1) || (missionIndex === 2 && state.stage === 2)) {
      const relic = feature + ':' + Number(missionIndex === 2);
      const point = choose();
      if (point && !state.discoveries.includes(relic)) {
        state.tiles[index(point)] = 'crate';
        state.hidden[index(point)] = { ...point, kind: 'relic', relic };
        state.carving = directionList.map(direction => nextPoint(point, direction))
          .find(next => tileAt(state, next) === 'wall' && next.x > 0 && next.x < WIDTH - 1 && next.y > 0 && next.y < HEIGHT - 1) ?? point;
      }
    }
    if (gateTrial) {
      state.chainSupply = { x: 5, y: 5 };
      const cell = index(state.chainSupply);
      state.tiles[cell] = 'crate';
      state.hidden[cell] = { ...state.chainSupply, kind: 'capacity' };
    }
  }
  // Keep useful upgrades discoverable in existing crates.
  const spareCrates = points.filter(point => tileAt(state, point) === 'crate' && !state.hidden[index(point)]
    && !state.targets.some(target => same(target, point)));
  if (!arena) spareCrates.sort((a, b) => distance(a, origin[0]) - distance(b, origin[0]));
  for (const kind of ['range', 'capacity'] as const) {
    if (arena && Object.values(state.hidden).some(item => item.kind === kind)) continue;
    const point = arena ? spareCrates.splice(Math.floor(random() * spareCrates.length), 1)[0] : spareCrates.shift();
    if (point) state.hidden[index(point)] = { ...point, kind };
  }
  return origin;
}

function applyTerrain(state: State, feature: Feature, arena: boolean, missionId: string, boss: boolean) {
  const put = (x: number, y: number, tile: Tile) => {
    const point = { x, y };
    if (tileAt(state, point) === 'wall' || (arena ? spawns : coSpawns).some(spawn => distance(point, spawn) < 2)) return;
    state.tiles[index(point)] = tile;
    delete state.hidden[index(point)];
  };
  if (feature === 'roots') {
    const gates = missionId === 'roots-1' && !arena ? [[8, 5], [10, 7]] : [[7, 3], [7, 5], [7, 7], [10, 5]];
    if (!boss) for (const [x, y] of gates) put(x, y, 'root');
  }
  const openPosts: Partial<Record<Feature, number[][]>> = {
    reeds: [[4, 2], [6, 2], [6, 4], [10, 6], [10, 8], [12, 8]],
    ice: [[4, 4], [4, 6], [8, 4], [8, 6], [12, 4], [12, 6]],
    rails: [[4, 4], [4, 6], [8, 2], [8, 8], [12, 4], [12, 6]],
    vents: [[4, 6], [6, 4], [8, 6], [10, 4], [12, 8]],
    shutters: [[6, 4], [6, 6], [8, 4], [8, 6], [10, 4], [10, 6]]
  };
  for (const [x, y] of openPosts[feature] ?? []) placeFloor(state, { x, y });
  if (feature === 'reeds') for (const [x, y] of [[5, 2], [5, 3], [5, 6], [7, 3], [8, 5], [10, 3], [9, 7], [11, 6]]) put(x, y, 'reed');
  if (feature === 'ice') for (let x = 4; x < 13; x++) {
    put(x, 3, 'ice');
    put(x, 7, 'ice');
    if (x % 2 === 1) put(x, 5, 'ice');
  }
  if (feature === 'rails') for (let x = 1; x < 14; x++) {
    put(x, 5, 'rail');
    put(x, state.stage % 2 ? 3 : 7, 'rail');
  }
  if (feature === 'vents') for (const [x, y] of [[5, 3], [5, 7], [7, 5], [9, 3], [9, 7], [11, 5]]) put(x, y, 'vent');
  if (feature === 'shutters') for (const [x, y] of [[6, 3], [6, 7], [7, 4], [7, 6], [8, 3], [8, 7], [10, 5]]) put(x, y, 'shutter');
}

function addEnemy(state: State, point: Point, kind: EnemyKind, hp: number) {
  const enemy: Enemy = {
    ...point, id: ++state.serial, kind, hp, maxHp: hp, facing: 'down', phase: 'roam', home: point, followup: false,
    next: state.tick + (kind === 'boss' ? 45 : 120) + state.enemies.length * 11, until: 0, safeUntil: 0
  };
  state.enemies.push(enemy);
  return enemy;
}

export function hazardAt(state: State, point: Point, tick = state.tick): 'warn' | 'hit' | null {
  const tile = tileAt(state, point);
  if (state.settings.mode === 'arena') {
    const until = state.limit - tick;
    const depth = Math.min(point.x - 1, WIDTH - 2 - point.x, point.y - 1, HEIGHT - 2 - point.y);
    if (depth >= 0 && depth < 4) {
      const hitAt = (48 - depth * 10) * TICK_RATE;
      if (until < hitAt) return 'hit';
      if (until < hitAt + 75) return 'warn';
    }
  }
  if (tile === 'rail') {
    const phase = (tick + point.y * 26) % 210;
    if (phase > 165) return 'warn';
    if (phase < 47 && Math.abs(point.x - 1 - Math.floor(phase / 3)) <= 1) return 'hit';
  }
  let warning = false;
  for (const center of [point, ...directionList.map(direction => nextPoint(point, direction))]) {
    if (tileAt(state, center) !== 'vent' || !passable(state, point, tick)) continue;
    const phase = (tick + center.x * 8 + center.y * 7) % 185;
    if (phase >= 162) warning = true;
    if (phase < 17) return 'hit';
  }
  return warning ? 'warn' : null;
}

function blocksBlast(tile: Tile, point: Point, tick: number) {
  return tile === 'wall' || tile === 'reed' || tile === 'root' || (tile === 'shutter' && shutterClosed(point, tick));
}

export function blastPoints(state: State, bomb: Bomb, tick = state.tick, struckGates?: Set<number>): Point[] {
  if (!passable(state, bomb, tick)) return [];
  const affected: Point[] = [{ x: bomb.x, y: bomb.y }];
  for (const direction of bomb.direction ? [bomb.direction] : directionList) {
    let point: Point = bomb;
    for (let i = 0; i < bomb.range; i++) {
      point = nextPoint(point, direction);
      const tile = tileAt(state, point);
      if (blocksBlast(tile, point, tick)) {
        // Root gates react to a chain blast that reaches them within three tiles.
        if (tile === 'root' && i < 3) struckGates?.add(index(point));
        break;
      }
      affected.push(point);
      if (tile === 'crate') break;
    }
  }
  return affected;
}

function newBomb(state: State, player: Player): Bomb {
  const cell = playerCell(player, state.tick);
  return {
    id: state.serial + 1, owner: player.id, ...cell,
    range: player.range + (player.gadget === 'directional' ? ROOT_LANCE_BONUS : 0),
    direction: player.gadget === 'directional' ? player.facing : undefined,
    slide: tileAt(state, cell) === 'ice' ? player.facing : undefined,
    nextSlide: state.tick + 4, plantedAt: state.tick,
    end: state.tick + bombFuseFor(player.gadget, state.settings.fuse === 'quick')
  };
}

function explode(state: State) {
  const queue = state.bombs.filter(bomb => bomb.end <= state.tick || state.flames.some(flame => same(bomb, flame)));
  if (!queue.length) return;
  let chained = false;
  const struckGates = new Set<number>();
  const hitTiles = new Set<number>();
  while (queue.length) {
    const bomb = queue.shift()!;
    const position = state.bombs.indexOf(bomb);
    if (position < 0) continue;
    state.bombs.splice(position, 1);
    const points = blastPoints(state, bomb, state.tick, struckGates);
    const footprint = new Set(points.map(index));
    emit(state, 'blast', bomb);
    for (const point of points) {
      const cell = index(point);
      hitTiles.add(cell);
      let links = 0;
      for (const direction of directionList) {
        if (footprint.has(index(nextPoint(point, direction)))) links |= FLAME_LINKS[direction];
      }
      state.flames.push({ ...point, end: state.tick + 12, links, origin: same(point, bomb) });
      for (const other of state.bombs) if (same(other, point) && !queue.includes(other)) {
        queue.push(other);
        chained = true;
      }
      if (state.settings.mode !== 'arena' && missionFor(state.settings.missionId).objective !== 'rescue') {
        for (const target of state.targets) if (same(target, point) && !target.done) {
          target.done = true;
          state.score += 120;
          emit(state, 'relay', target);
        }
      }
    }
  }
  // Every bomb in the wave sees the same blockers. Only a later wave can use the cleared route.
  const revealed: Item[] = [];
  let firstBrokenCrate: Point | undefined;
  for (const cell of hitTiles) if (state.tiles[cell] === 'crate') {
    state.tiles[cell] = 'floor';
    const point = { x: cell % WIDTH, y: Math.floor(cell / WIDTH) };
    state.cues.push({ ...point, kind: 'crate', tick: state.tick });
    firstBrokenCrate ??= point;
    const loot = state.hidden[cell];
    if (loot) revealed.push(loot);
    delete state.hidden[cell];
    state.score += 10;
  }
  if (firstBrokenCrate) emit(state, 'crate-break', firstBrokenCrate);
  state.items = state.items.filter(item => !hitTiles.has(index(item))).concat(revealed);
  if (chained) for (const cell of struckGates) {
    state.tiles[cell] = 'floor';
    state.score += 60;
    const point = { x: cell % WIDTH, y: Math.floor(cell / WIDTH) };
    state.cues.push({ ...point, kind: 'gate', tick: state.tick });
    emit(state, 'gate', point);
  }
}

function slideBombs(state: State) {
  for (const bomb of state.bombs) if (bomb.slide && bomb.nextSlide <= state.tick) {
    const next = nextPoint(bomb, bomb.slide);
    if (canMove(state, next) && !state.players.some(player => player.hp > 0 && same(next, playerCell(player, state.tick)))) {
      Object.assign(bomb, next);
      bomb.nextSlide = state.tick + 4;
      if (tileAt(state, bomb) !== 'ice') bomb.slide = undefined;
    } else bomb.slide = undefined;
  }
}

function hurt(state: State, player: Player, cell: Point) {
  if (player.safeUntil > state.tick || player.hp <= 0) return false;
  player.safeUntil = state.tick + 42;
  if (player.shield) player.shield = false;
  else player.hp--;
  emit(state, player.hp === 0 ? 'knockout' : 'hurt', cell);
  if (player.hp === 0) state.cues.push({
    ...playerPosition(player, state.tick), kind: 'knockout', tick: state.tick, critter: player.critter, facing: player.facing
  });
  return true;
}

function facingToward(from: Point, to: Point): Direction {
  return Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
    ? to.x >= from.x ? 'right' : 'left'
    : to.y >= from.y ? 'down' : 'up';
}

function enemyStep(state: State, enemy: Enemy) {
  if (enemy.hp <= 0) return;
  if (state.flames.some(flame => same(flame, enemy)) && enemy.safeUntil <= state.tick && (enemy.kind !== 'boss' || enemy.phase === 'stunned')) {
    enemy.safeUntil = state.tick + 21;
    enemy.hp--;
    emit(state, 'hurt', enemy);
    if (enemy.hp === 0) {
      state.cues.push({ kind: 'enemy-defeat', x: enemy.x, y: enemy.y, tick: state.tick, enemy: enemy.kind });
      state.score += enemy.kind === 'boss' ? 800 : 90;
      return;
    }
  }
  const target = state.players.filter(player => player.hp > 0).sort((a, b) => distance(a, enemy) - distance(b, enemy))[0];
  if (!target || state.tick < enemy.next) return;
  const biome = enemy.kind === 'boss' ? regionFor(state.settings.missionId).id : undefined;
  if (enemy.phase === 'warn') {
    if (biome === 'vents') {
      for (const direction of directionList) for (let point = nextPoint(enemy, direction), i = 0; i < 3; i++, point = nextPoint(point, direction)) {
        if (!passable(state, point)) break;
        state.flames.push({ ...point, end: state.tick + 16 });
      }
      enemy.phase = 'stunned';
      enemy.next = state.tick + 138;
      emit(state, 'blast', enemy);
      return;
    }
    enemy.phase = 'charge';
    enemy.next = state.tick;
    enemy.until = state.tick + (biome === 'ice' ? 49 : enemy.kind === 'boss' ? 35 : enemy.kind === 'moth' ? 14 : 22);
    return;
  }
  if (enemy.phase === 'charge') {
    const point = nextPoint(enemy, enemy.facing);
    const bomb = state.bombs.find(item => same(item, point));
    if (bomb && enemy.kind !== 'moth') {
      const destination = nextPoint(point, enemy.facing);
      if (canMove(state, destination)) {
        const farther = nextPoint(destination, enemy.facing);
        Object.assign(bomb, biome === 'rails' && canMove(state, farther) ? farther : destination);
      }
    }
    if (state.tick >= enemy.until || !canMove(state, point)) {
      if (biome === 'shutters' && !enemy.followup) {
        enemy.followup = true;
        enemy.facing = facingToward(enemy, target);
        enemy.phase = 'warn';
        enemy.next = state.tick + 31;
        emit(state, 'warn', enemy);
        return;
      }
      enemy.followup = false;
      enemy.phase = 'stunned';
      enemy.next = state.tick + (enemy.kind === 'boss' ? 150 : 31);
    } else {
      if (biome === 'reeds' && tileAt(state, point) === 'reed') placeFloor(state, point);
      if (biome === 'ice' && tileAt(state, point) === 'floor' && !same(point, state.exit)) state.tiles[index(point)] = 'ice';
      Object.assign(enemy, point);
      enemy.next = state.tick + (enemy.kind === 'boss' ? 5 : 7);
    }
    return;
  }
  if (enemy.phase === 'stunned') enemy.phase = 'roam';
  const gap = distance(enemy, target);
  const aligned = enemy.x === target.x || enemy.y === target.y;
  const directions = directionList.filter(dir => canMove(state, nextPoint(enemy, dir)));
  const aim = facingToward(enemy, target);
  const chargeRange = enemy.kind === 'boss' ? 9 : enemy.kind === 'moth' ? 3 : 4;
  const canAttack = biome === 'vents' ? gap >= 1 && gap <= 5 : aligned && gap >= 1 && gap <= chargeRange && passable(state, nextPoint(enemy, aim));
  if (canAttack) {
    enemy.phase = 'warn';
    enemy.facing = aim;
    enemy.next = state.tick + (enemy.kind === 'boss' ? 35 : 24);
    emit(state, 'warn', enemy);
    return;
  }
  const goal = enemy.kind === 'crab' && gap > 4 ? state.targets.find(item => !item.done) ?? state.exit
    : enemy.kind !== 'boss' && gap > 7 ? enemy.home
    : enemy.kind === 'moth' ? nextPoint(target, target.facing) : target;
  const stride = enemy.kind === 'moth' ? 13 : enemy.kind === 'crab' ? 26 : 20;
  const risk = forecast(state);
  const queue: { point: Point; first: Direction; steps: number }[] = [];
  const seen = new Set([index(enemy)]);
  for (const direction of directions) {
    const point = nextPoint(enemy, direction);
    if (risk.safe(point, state.tick, state.tick + stride)) {
      queue.push({ point, first: direction, steps: 1 });
      seen.add(index(point));
    }
  }
  let best: Direction | undefined;
  let rating = -distance(enemy, goal) * 3;
  for (let i = 0; i < queue.length; i++) {
    const { point, first, steps } = queue[i];
    const value = -distance(point, goal) * 3 - steps * .45;
    if (value > rating) { rating = value; best = first; }
    if (steps === 8) continue;
    for (const direction of directionList) {
      const next = nextPoint(point, direction);
      if (!seen.has(index(next)) && canMove(state, next)) {
        seen.add(index(next));
        queue.push({ point: next, first, steps: steps + 1 });
      }
    }
  }
  if (best) {
    enemy.facing = best;
    Object.assign(enemy, nextPoint(enemy, best));
  }
  enemy.next = state.tick + (enemy.kind === 'moth' ? 13 : enemy.kind === 'crab' ? 26 : 20);
}

interface Risk { start: number; end: number }
function forecast(state: State) {
  const bombs = state.bombs;
  const ranges = bombs.map(bomb => {
    const origin = blastPoints(state, bomb, bomb.end);
    if (!bomb.slide) return origin;
    let projected: Point = bomb;
    for (let tick = bomb.nextSlide; tick <= bomb.end && tileAt(state, projected) === 'ice'; tick += 4) {
      const point = nextPoint(projected, bomb.slide);
      if (!passable(state, point, tick) || bombs.some(other => other !== bomb && same(other, point))) break;
      projected = point;
    }
    return same(projected, bomb) ? origin : [...origin, ...blastPoints(state, { ...bomb, ...projected }, bomb.end)];
  });
  const times = bombs.map(bomb => bomb.end);
  for (let pass = 0; pass < bombs.length; pass++) {
    let changed = false;
    for (const [i, points] of ranges.entries()) {
      for (const [j, bomb] of bombs.entries()) if (times[j] > times[i] && points.some(point => same(point, bomb))) {
        times[j] = times[i];
        changed = true;
      }
    }
    if (!changed) break;
  }
  const risk = new Map<number, Risk[]>();
  const add = (point: Point, value: Risk) => {
    const cell = index(point);
    const existing = risk.get(cell) ?? [];
    existing.push(value);
    risk.set(cell, existing);
  };
  for (const flame of state.flames) add(flame, { start: state.tick, end: flame.end });
  for (const [i, points] of ranges.entries()) for (const point of points) add(point, { start: times[i], end: times[i] + 12 });
  return {
    safe(point: Point, from: number, to: number) {
      return !(risk.get(index(point)) ?? []).some(window => window.start < to && window.end > from)
        && hazardAt(state, point, from) !== 'hit' && hazardAt(state, point, to) !== 'hit';
    }
  };
}

function arenaForecast(state: State, extra?: Bomb) {
  const risk = new Map<number, Risk[]>();
  const blocked = new Map<number, Risk[]>();
  const add = (map: Map<number, Risk[]>, point: Point, start: number, end: number) => {
    const cell = index(point);
    const intervals = map.get(cell) ?? [];
    intervals.push({ start, end });
    map.set(cell, intervals);
  };
  for (const flame of state.flames) add(risk, flame, state.tick, flame.end);
  let until = state.tick + 32;
  const placements = [...state.bombs, ...(extra ? [extra] : [])];
  if (placements.length) {
    // Replay visible bombs with the real wave rules. Hidden items, inputs and scores are irrelevant here.
    const sim = { ...state, tiles: state.tiles.slice(), bombs: placements.map(bomb => ({ ...bomb })),
      flames: state.flames.slice(), events: [], cues: [], items: [], targets: [], hidden: {} };
    const blast = () => {
      const before = sim.flames.length;
      explode(sim);
      for (const flame of sim.flames.slice(before)) {
        add(risk, flame, sim.tick, flame.end);
        until = Math.max(until, flame.end);
      }
    };
    for (const bomb of sim.bombs) add(blocked, bomb, sim.tick, sim.tick + 1);
    slideBombs(sim);
    blast();
    while (sim.bombs.length) {
      const next = Math.min(...sim.bombs.map(bomb => Math.min(bomb.end, bomb.slide ? bomb.nextSlide : Infinity)));
      for (const bomb of sim.bombs) add(blocked, bomb, sim.tick, next + 1);
      sim.tick = next;
      sim.flames = sim.flames.filter(flame => flame.end > next);
      slideBombs(sim);
      blast();
    }
  }
  const occupied = (map: Map<number, Risk[]>, point: Point, from: number, to: number) =>
    map.get(index(point))?.some(window => window.start < to && window.end > from) ?? false;
  const timedTerrain = state.settings.arena === 'rails' || state.settings.arena === 'vents';
  const terrain = new Map<number, boolean>();
  return {
    until,
    canEnter(point: Point, tick: number) {
      return passable(state, point, tick) && !occupied(blocked, point, tick, tick + 1);
    },
    safe(point: Point, from: number, to: number) {
      if (to <= from) return true;
      if (occupied(risk, point, from, to)) return false;
      if (!timedTerrain) return hazardAt(state, point, to - 1) !== 'hit';
      for (let tick = from; tick < to; tick++) {
        const key = tick * WIDTH * HEIGHT + index(point);
        let clear = terrain.get(key);
        if (clear === undefined) {
          clear = hazardAt(state, point, tick) !== 'hit';
          terrain.set(key, clear);
        }
        if (!clear) return false;
      }
      return true;
    }
  };
}

interface BotRoute { direction?: Direction; score: number }
function botRoute(state: State, player: Player, threat: ReturnType<typeof arenaForecast>, depth: number,
  evaluate: (point: Point, tick: number, depth: number) => number, stopAt = Infinity): BotRoute {
  const queue: { point: Point; first?: Direction; depth: number }[] = [{ point: player, depth: 0 }];
  const seen = new Set<number>();
  let best: BotRoute = { score: evaluate(player, state.tick, 0) };
  if (best.score >= stopAt) return best;
  const stride = moveDelay(player);
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    if (node.depth >= depth) continue;
    const depart = state.tick + node.depth * stride;
    const arrival = depart + stride;
    const count = node.depth + 1;
    for (const direction of directionList) {
      const point = nextPoint(node.point, direction);
      if (!threat.canEnter(point, depart)) continue;
      // Match playerCell at the halfway mark, including Math.round's tie toward the higher coordinate.
      const enter = depart + (direction === 'up' || direction === 'left' ? Math.floor(stride / 2) + 1 : Math.ceil(stride / 2));
      if (!threat.safe(node.point, Math.max(depart, player.safeUntil), enter)
        || !threat.safe(point, Math.max(enter, player.safeUntil), arrival + 1)) continue;
      const key = count * WIDTH * HEIGHT + index(point);
      if (seen.has(key)) continue;
      seen.add(key);
      const first = node.first ?? direction;
      queue.push({ point, first, depth: count });
      const score = evaluate(point, arrival, count);
      if (score >= stopAt) return { direction: first, score };
      if (score > best.score) best = { direction: first, score };
    }
  }
  return best;
}

export function botInput(state: State, player: Player, mayPlant = true): Input {
  const depth = state.settings.difficulty === 'easy' ? 4 : state.settings.difficulty === 'hard' ? 9 : 6;
  const escapeDepth = Math.max(5, depth);
  const threat = arenaForecast(state);
  const clear = (point: Point, at: number) => threat.safe(point, at, Math.max(at + 8, threat.until));
  if (!clear(player, state.tick)) {
    const escape = botRoute(state, player, threat, escapeDepth, (point, at, steps) =>
      clear(point, at) ? 100 - steps : steps, 100 - escapeDepth);
    if (escape.direction) return { direction: escape.direction };
    return {};
  }
  const opponents = state.players.filter(other => other.hp > 0 && other.team !== player.team);
  const opponent = opponents.sort((a, b) => distance(a, player) - distance(b, player))[0];
  const gap = opponent ? distance(opponent, player) : Infinity;
  if (mayPlant && state.bombs.filter(item => item.owner === player.id).length < capacityFor(player)) {
    const aims = player.gadget === 'directional' || tileAt(state, player) === 'ice' ? directionList : [player.facing];
    for (const facing of aims) {
      const bomb = newBomb(state, { ...player, facing });
      if (!canMove(state, bomb)) continue;
      const blast = blastPoints(state, bomb);
      const opensRoute = opponent && blast.some(point => tileAt(state, point) === 'crate'
        && (gap > 2 || distance(point, opponent) < gap));
      const pressuresOpponent = opponents.some(other => blast.some(point => same(point, other) || same(point, playerCell(other, state.tick))));
      if (!opensRoute && !pressuresOpponent) continue;
      const projected = arenaForecast(state, bomb);
      const escape = botRoute(state, player, projected, escapeDepth, (point, at, steps) =>
        projected.safe(point, at, Math.max(at + 8, projected.until)) ? 100 - steps : -Infinity, 100 - escapeDepth);
      if (escape.score > 0) return { bomb: true, direction: escape.direction, turn: facing };
    }
  }
  const item = state.items.filter(value => value.kind !== 'relic' && value.kind !== 'heart'
    && player[value.kind] < upgradeLimit[value.kind] && clear(value, state.tick))
    .sort((a, b) => distance(a, player) - distance(b, player))[0];
  const aim = item && distance(item, player) <= depth && gap > 2 ? item : opponent;
  if (!aim) return {};
  const approach = botRoute(state, player, threat, depth, (point, at, steps) =>
    (clear(point, at) ? 0 : -30) - distance(point, aim) * 3 - steps * .35);
  return { direction: approach.direction };
}

function handlePlayer(state: State, player: Player, input: Input) {
  if (player.hp <= 0) return;
  const facing = input.turn ?? input.direction;
  if (facing) player.facing = facing;
  const request = input.bomb ? { expires: state.tick + bombBufferTicks, facing: player.facing } : player.bufferedBomb;
  player.bufferedBomb = undefined;
  if (request && request.expires >= state.tick) {
    if (state.bombs.filter(bomb => bomb.owner === player.id).length < capacityFor(player)) {
      const bomb = newBomb(state, { ...player, facing: request.facing });
      if (canMove(state, bomb)) {
        emit(state, 'plant', bomb);
        state.bombs.push(bomb);
      } else if (!player.bot && player.step && player.moveAt > state.tick) {
        player.bufferedBomb = request;
      }
    }
  }
  if (player.bot) {
    const move = input.direction && planPlayerMove(state, player, input.direction);
    if (move) Object.assign(player, move);
  } else {
    const steering = steerPlayer(state, player, input);
    player.bufferedTurn = steering.bufferedTurn;
    if (steering.move) Object.assign(player, steering.move);
  }
}

function updateArena(state: State) {
  const active = new Set(state.players.filter(player => player.hp > 0).map(player => player.team));
  if (active.size > 1 && state.tick < state.limit) return;
  state.winner = active.size === 1 ? [...active][0] : null;
  if (state.winner !== null) state.wins[state.winner]++;
  const maximum = Math.max(...state.wins);
  if (maximum >= 2 || state.round >= 5) {
    state.status = 'cleared';
    const leaders = state.wins.flatMap((wins, team) => wins === maximum ? [team] : []);
    state.winner = leaders.length === 1 ? leaders[0] : null;
    emit(state, 'win', spawns[0]);
    return;
  }
  state.status = 'between';
  state.restartAt = state.tick + 80;
}

function updateCampaign(state: State) {
  if (state.players.every(player => player.hp <= 0) || state.tick >= state.limit) {
    state.status = 'failed';
    emit(state, 'lose', state.exit);
    return;
  }
  if (!exitOpen(state) || !state.players.some(player => player.hp > 0 && same(playerCell(player, state.tick), state.exit))) return;
  state.score += 400 + Math.min(360, Math.floor((state.limit - state.tick) / 30));
  if (state.stage + 1 >= state.stages) {
    state.status = 'cleared';
    emit(state, 'win', state.exit);
  } else {
    state.stage++;
    loadChamber(state);
  }
}

export function exitOpen(state: State) {
  const lesson = rootwarrenLesson(state.settings.mode, state.settings.missionId, state.stage);
  if (lesson?.kind === 'lure') return state.enemies.every(enemy => enemy.hp === 0);
  if (lesson?.gate) return tileAt(state, lesson.gate) !== 'root';
  return state.targets.every(target => target.done) && !state.enemies.some(enemy => enemy.kind === 'boss' && enemy.hp > 0);
}

export function tickGame(state: State, inputs: Record<string, Input> = {}) {
  if (state.status === 'cleared' || state.status === 'failed') return;
  state.tick++;
  if (state.cues.length) state.cues = state.cues.filter(cue => cue.tick + VISUAL_CUE_TICKS[cue.kind] > state.tick);
  if (state.status === 'between') {
    if (state.tick >= state.restartAt) {
      state.round++;
      state.status = 'playing';
      loadChamber(state);
    }
    return;
  }
  state.elapsed++;
  state.flames = state.flames.filter(flame => flame.end > state.tick);
  const previousPlayerCells = state.enemies.length ? state.players.map(player => index(playerCell(player, state.tick - 1))) : [];
  for (const player of state.players) {
    if (player.hp <= 0) continue;
    if (player.bot) {
      // Make every turn on time. Reaction delay limits attacks, never an escape already in progress.
      if (player.moveAt > state.tick) continue;
      const mayPlant = player.brainAt <= state.tick;
      const input = botInput(state, player, mayPlant);
      if (mayPlant) player.brainAt = state.tick + (state.settings.difficulty === 'hard' ? 4 : state.settings.difficulty === 'easy' ? 13 : 7);
      handlePlayer(state, player, input);
    } else {
      handlePlayer(state, player, inputs[player.id] ?? {});
    }
  }
  slideBombs(state);
  explode(state);
  const previousEnemyCells = state.enemies.map(index);
  for (const enemy of state.enemies) enemyStep(state, enemy);
  const rescue = state.settings.mode !== 'arena' && missionFor(state.settings.missionId).objective === 'rescue';
  for (const [i, player] of state.players.entries()) {
    if (player.hp <= 0) continue;
    const cell = playerCell(player, state.tick);
    const occupied = index(cell);
    // A head-on swap between ticks is contact even when actors end up in different cells.
    const contact = state.enemies.find((enemy, j) => enemy.hp > 0 && (index(enemy) === occupied
      || previousEnemyCells[j] === occupied && index(enemy) === previousPlayerCells[i]));
    if (contact || state.flames.some(flame => same(flame, cell)) || hazardAt(state, cell) === 'hit') {
      if (hurt(state, player, cell) && contact) contact.contactAt = state.tick;
    }
    if (player.hp <= 0) continue;
    const item = state.items.find(value => same(cell, value) && (value.kind !== 'heart' || player.hp === 1));
    if (item) {
      state.items.splice(state.items.indexOf(item), 1);
      if (item.kind === 'range' || item.kind === 'capacity' || item.kind === 'speed') {
        player[item.kind] = Math.min(upgradeLimit[item.kind], player[item.kind] + 1);
      }
      if (item.kind === 'heart') player.hp = 2;
      if (item.relic && !state.discoveries.includes(item.relic)) state.discoveries.push(item.relic);
      state.score += item.kind === 'relic' ? 350 : 40;
      emit(state, 'pickup', item);
    }
    if (rescue) {
      const target = state.targets.find(value => !value.done && same(value, cell) && tileAt(state, value) === 'floor');
      if (target) {
        target.done = true;
        state.score += 120;
        emit(state, 'rescue', target);
      }
    }
  }
  if (state.settings.mode === 'arena') updateArena(state);
  else {
    const supply = state.chainSupply;
    // A solo player can still open this gate if its required ammo was lost to a blast.
    if (supply && tileAt(state, { x: supply.x + 2, y: supply.y }) === 'root'
      && state.players.reduce((total, player) => total + (player.hp > 0 ? capacityFor(player) : 0), 0) === 1
      && ![...state.items, ...Object.values(state.hidden)].some(item => item.kind === 'capacity' && item.x < supply.x + 2)
      && !state.flames.some(flame => same(flame, supply)) && canMove(state, supply)) {
      state.items.push({ ...supply, kind: 'capacity' });
    }
    updateCampaign(state);
  }
}

export function snapshot(state: State): State {
  return { ...state, hidden: {}, players: state.players.map(({ bufferedBomb, ...player }) => player) };
}
