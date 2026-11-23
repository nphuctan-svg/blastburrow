import assert from 'node:assert/strict';
import test from 'node:test';
import { runOpeningRoute } from './campaign-driver.mjs';
import { CAMPAIGN, GADGETS, REGIONS, expeditionFor } from '../dist/shared/content.js';
import { DEFAULT_SETTINGS as settings, DIRECTIONS, FLAME_LINKS, VISUAL_CUE_TICKS, addArenaBots, blastPoints, botInput, capacityFor, createGame,
  exitOpen, hazardAt, index, nextPoint, playerPosition, shutterClosed, snapshot, tickGame, tileAt } from '../dist/shared/engine.js';

const seat = { id: 'p1', critter: 'hare', gadget: 'standard' };
const second = { id: 'p2', critter: 'fox', gadget: 'standard' };
const dirs = Object.keys(DIRECTIONS);
const bomb = (x, y, end = 1, range = 2) => ({ id: x * 15 + y, x, y, end, range, nextSlide: 0, owner: 'p1' });
const step = (game, count, input = {}) => { for (let i = 0; i < count; i++) tickGame(game, input); };
const blankBoard = () => {
  const game = createGame(settings, [seat]);
  game.tiles = game.tiles.map((_, i) => i % 15 === 0 || i % 15 === 14 || i < 15 || i >= 150 ? 'wall' : 'floor');
  Object.assign(game, { enemies: [], targets: [], items: [], hidden: {} });
  return game;
};
const point = (x, y) => ({ x, y });
const enemyAt = (x, y, phase = 'roam') => ({
  ...point(x, y), id: 99, kind: 'moth', hp: 1, maxHp: 1, facing: 'left', phase,
  next: 999, until: 999, safeUntil: 0, home: point(x, y), followup: false
});

test('players can walk through each other head-on', () => {
  const game = blankBoard();
  const [player] = game.players;
  const other = { ...player, ...second, ...point(2, 1) };
  game.players.push(other);
  tickGame(game, { p1: { direction: 'right' }, p2: { direction: 'left' } });
  assert.deepEqual([player.x, other.x], [2, 1]);
  step(game, 3);
  assert.deepEqual(playerPosition(player, game.tick), playerPosition(other, game.tick));
  step(game, 3);
  assert.deepEqual(playerPosition(player, game.tick), point(2, 1));
  assert.deepEqual(playerPosition(other, game.tick), point(1, 1));
});

test('a bomb tap blocked during a slide plants once on the next legal tile', () => {
  const game = blankBoard();
  const [player] = game.players;
  player.gadget = 'directional';
  tickGame(game, { p1: { direction: 'right' } });
  game.bombs = [{ ...bomb(1, 1, 90), owner: 'p2' }];
  tickGame(game, { p1: { bomb: true } });
  assert.equal(game.bombs.length, 1);
  assert.ok(player.bufferedBomb);
  assert.equal(snapshot(game).players[0].bufferedBomb, undefined);
  tickGame(game, { p1: { turn: 'down' } });
  step(game, 2);
  const planted = game.bombs.find(bomb => bomb.owner === player.id);
  assert.ok(planted);
  assert.deepEqual({ x: planted.x, y: planted.y, direction: planted.direction }, { x: 2, y: 1, direction: 'right' });
  assert.equal(player.bufferedBomb, undefined);
  step(game, 6);
  assert.equal(game.bombs.filter(bomb => bomb.owner === player.id).length, 1);
});

test('bomb presses at capacity are discarded instead of firing when a slot opens', () => {
  const game = blankBoard();
  const [player] = game.players;
  game.bombs = [bomb(4, 1, 3, 1)];
  tickGame(game, { p1: { direction: 'right' } });
  tickGame(game, { p1: { bomb: true } });
  assert.equal(player.bufferedBomb, undefined);
  step(game, 5);
  assert.equal(game.bombs.length, 0);
});

test('touching a living enemy knocks out an unprotected player in every phase', () => {
  for (const phase of ['roam', 'warn', 'charge', 'stunned']) {
    const game = blankBoard();
    const [player] = game.players;
    player.safeUntil = 0;
    game.enemies = [enemyAt(2, 1, phase)];
    tickGame(game, { p1: { direction: 'right' } });
    step(game, 2);
    assert.equal(player.hp, 1, phase);
    tickGame(game);
    assert.equal(player.hp, 0, phase);
    assert.equal(game.enemies[0].contactAt, game.tick);
    assert.deepEqual(game.cues.find(cue => cue.kind === 'knockout'), {
      ...point(1.5, 1), kind: 'knockout', tick: game.tick, critter: 'hare', facing: 'right'
    });
  }
});

test('a player and an enemy cannot swap tiles head-on without contact', () => {
  const game = blankBoard();
  const [player] = game.players;
  player.safeUntil = 0;
  const enemy = { ...enemyAt(2, 1, 'charge'), next: 4 };
  game.enemies = [enemy];
  tickGame(game, { p1: { direction: 'right' } });
  step(game, 2);
  assert.equal(player.hp, 1);
  tickGame(game);
  assert.deepEqual(point(enemy.x, enemy.y), point(1, 1));
  assert.equal(player.hp, 0);
  assert.equal(snapshot(game).enemies[0].contactAt, game.tick);
});

test('a spare heart or shield absorbs enemy contact and a defeated enemy does no damage', () => {
  for (const [hp, shield, enemyHp] of [[2, false, 1], [1, true, 1], [1, false, 0]]) {
    const game = blankBoard();
    const [player] = game.players;
    Object.assign(player, { hp, shield, safeUntil: 0 });
    game.enemies = [{ ...enemyAt(1, 1), hp: enemyHp }];
    step(game, 2);
    assert.equal(player.hp, 1);
    assert.equal(player.shield, false);
    assert.equal(game.events.filter(event => event.kind === 'hurt').length, enemyHp);
  }
});

test('players can share a tile, and a planted bomb still blocks the next tile', () => {
  const game = blankBoard();
  const [player] = game.players;
  const other = { ...player, ...second, ...point(3, 1) };
  game.players.push(other);
  tickGame(game, { p1: { direction: 'right' }, p2: { direction: 'left' } });
  step(game, 6);
  assert.deepEqual(playerPosition(player, game.tick), point(2, 1));
  assert.deepEqual(playerPosition(other, game.tick), point(2, 1));
  game.bombs = [bomb(3, 1, 72)];
  tickGame(game, { p1: { direction: 'right' }, p2: { direction: 'right' } });
  assert.deepEqual([player.x, other.x], [2, 2]);
});

test('fuse, four-way propagation, solid walls, crates, chaining and root gate', () => {
  const game = blankBoard();
  game.tiles[index(point(3, 2))] = 'wall';
  game.tiles[index(point(3, 4))] = 'crate';
  game.tiles[index(point(7, 3))] = 'root';
  game.bombs = [bomb(3, 3), bomb(5, 3, 90)];
  tickGame(game);
  assert.equal(game.bombs.length, 0);
  assert.equal(tileAt(game, point(7, 3)), 'floor');
  assert.equal(tileAt(game, point(3, 4)), 'floor');
  assert.ok(!game.flames.some(p => p.x === 3 && (p.y <= 2 || p.y === 5)));
  assert.ok(game.events.some(e => e.kind === 'gate'));
  assert.deepEqual(game.cues, [
    { ...point(3, 4), kind: 'crate', tick: 1 }, { ...point(7, 3), kind: 'gate', tick: 1 }
  ]);
  assert.ok(game.flames.some(p => p.x === 6 && p.y === 3));
  step(game, 12);
  assert.equal(game.flames.length, 0);
});

test('each blast arm stops at walls, crates, reeds, root gates and closed shutters', () => {
  const standard = bomb(7, 5, 1, 3);
  const arms = Object.fromEntries(dirs.map(direction => {
    const first = nextPoint(standard, direction);
    const second = nextPoint(first, direction);
    return [direction, [first, second, nextPoint(second, direction)]];
  }));
  const fullBlast = [point(7, 5), ...dirs.flatMap(direction => arms[direction])];
  const ticks = Array.from({ length: 150 }, (_, tick) => tick);
  for (const tile of ['wall', 'crate', 'reed', 'root', 'shutter']) {
    for (const blocked of dirs) {
      const game = blankBoard();
      const obstacle = arms[blocked][1];
      game.tiles[index(obstacle)] = tile;
      const stoppedAt = tile === 'crate' ? 2 : 1;
      const expected = [point(7, 5), ...dirs.flatMap(direction =>
        direction === blocked ? arms[direction].slice(0, stoppedAt) : arms[direction])];
      const closedTick = ticks.find(tick => shutterClosed(obstacle, tick));
      assert.notEqual(closedTick, undefined);
      assert.deepEqual(blastPoints(game, standard, closedTick), expected, tile + ' to the ' + blocked);
      if (tile === 'shutter') {
        const openTick = ticks.find(tick => !shutterClosed(obstacle, tick));
        assert.notEqual(openTick, undefined);
        assert.deepEqual(blastPoints(game, standard, openTick), fullBlast, 'open shutter to the ' + blocked);
      }
    }
  }
});

test('adjacent bombs cannot burn through a crate in the same blast wave', () => {
  for (const end of [1, 90]) {
    const game = blankBoard();
    const crate = point(5, 3);
    const beyond = point(6, 3);
    game.tiles[index(crate)] = 'crate';
    game.hidden[index(crate)] = { ...crate, kind: 'heart' };
    game.items = [{ ...beyond, kind: 'speed' }];
    game.bombs = [bomb(3, 3), bomb(4, 3, end), bomb(beyond.x, beyond.y, 120)];
    tickGame(game);
    assert.deepEqual(game.bombs.map(({ x, y }) => point(x, y)), [beyond]);
    assert.equal(tileAt(game, crate), 'floor');
    assert.ok(game.flames.some(flame => index(flame) === index(crate)));
    assert.ok(!game.flames.some(flame => index(flame) === index(beyond)));
    assert.deepEqual(game.items, [{ ...beyond, kind: 'speed' }, { ...crate, kind: 'heart' }]);
    assert.equal(game.score, 10);
    step(game, 12);
    game.bombs.push(bomb(4, 3, game.tick + 1));
    tickGame(game);
    assert.ok(game.flames.some(flame => index(flame) === index(beyond)), 'a later wave can use the cleared route');
  }
});

test('a 24-bomb chain cannot cross a crate or stone wall partition', () => {
  for (const blocker of ['crate', 'wall']) {
    const game = blankBoard();
    for (let x = 1; x < 14; x++) game.tiles[index(point(x, 5))] = blocker;
    for (let x = 2; x <= 7; x++) for (let y = 1; y <= 4; y++) {
      game.bombs.push(bomb(x, y, x === 2 && y === 1 ? 1 : 90, 3));
    }
    game.bombs.push(bomb(4, 6, 120));
    tickGame(game);
    assert.equal(game.events.filter(event => event.kind === 'blast').length, 24);
    assert.equal(game.events.filter(event => event.kind === 'crate-break').length, Number(blocker === 'crate'));
    assert.equal(game.flames.some(flame => flame.y === 5), blocker === 'crate');
    assert.ok(game.flames.every(flame => flame.y <= 5));
    assert.deepEqual(game.bombs.map(({ x, y }) => point(x, y)), [point(4, 6)]);
  }
});

test('a stone partition shields a root gate from a nearby chain', () => {
  const game = blankBoard();
  for (let y = 1; y < 10; y++) game.tiles[index(point(5, y))] = 'wall';
  const gate = point(6, 3);
  game.tiles[index(gate)] = 'root';
  game.bombs = [bomb(3, 3), bomb(4, 3, 90, 3)];
  tickGame(game);
  assert.equal(game.bombs.length, 0);
  assert.ok(game.flames.every(flame => flame.x < 5));
  assert.equal(tileAt(game, gate), 'root');
});

test('a bomb placed on an open shutter is contained if it closes before the fuse ends', () => {
  const game = blankBoard();
  const shutter = point(7, 5);
  game.tick = 99;
  game.tiles[index(shutter)] = 'shutter';
  Object.assign(game.players[0], shutter);
  tickGame(game, { p1: { bomb: true } });
  const [planted] = game.bombs;
  assert.ok(planted);
  assert.equal(shutterClosed(shutter, game.tick), false);
  assert.equal(shutterClosed(shutter, planted.end), true);
  game.bombs.push(bomb(7, 6, planted.end + 50));
  step(game, planted.end - game.tick);
  assert.deepEqual(game.flames, []);
  assert.deepEqual(game.bombs.map(({ x, y }) => point(x, y)), [point(7, 6)]);
});

test('player glides across the full movement interval and joins the next step at the tile center', () => {
  const game = blankBoard();
  const [player] = game.players;
  tickGame(game, { p1: { direction: 'right' } });
  assert.equal(player.x, 2);
  assert.deepEqual(playerPosition(player, game.tick), point(1, 1));
  assert.deepEqual(playerPosition(player, game.tick + 1.5), point(1.25, 1));
  assert.deepEqual(playerPosition(player, game.tick + 4.5), point(1.75, 1));
  const arrival = player.moveAt;
  step(game, 6, { p1: { direction: 'right' } });
  assert.equal(player.x, 3);
  assert.deepEqual(playerPosition(player, arrival), point(2, 1));
  game.tiles[index(point(4, 1))] = 'wall';
  step(game, 12, { p1: { direction: 'right' } });
  assert.deepEqual(playerPosition(player, game.tick), point(3, 1));
});

test('an early turn curves around a solid post and plants bombs on the nearest grid cell', () => {
  const game = blankBoard();
  const [player] = game.players;
  game.tiles[index(point(1, 2))] = 'wall';
  tickGame(game, { p1: { direction: 'right' } });
  const straightEnd = player.moveAt;
  const turnStart = playerPosition(player, game.tick + 1);
  tickGame(game, { p1: { direction: 'down' } });
  assert.deepEqual(player.step.corner, point(2, 1));
  assert.deepEqual(playerPosition(player, game.tick), turnStart);
  const beforeStraightEnd = playerPosition(player, straightEnd - 1);
  assert.ok(beforeStraightEnd.x < 2 && beforeStraightEnd.y > 1);
  for (let at = game.tick; at <= player.moveAt; at += .125) {
    const visual = playerPosition(player, at);
    const cell = point(Math.round(visual.x), Math.round(visual.y));
    assert.notEqual(tileAt(game, cell), 'wall');
  }
  step(game, 2);
  tickGame(game, { p1: { bomb: true } });
  assert.deepEqual(point(game.bombs[0].x, game.bombs[0].y), point(2, 1));
  assert.deepEqual(point(player.x, player.y), point(2, 2));
});

test('a blocked corner stays on its slide and reversing retraces the open lane', () => {
  const game = blankBoard();
  const [player] = game.players;
  game.bombs = [bomb(2, 2, 90)];
  tickGame(game, { p1: { direction: 'right' } });
  const straight = player.step;
  tickGame(game, { p1: { direction: 'down' } });
  assert.equal(player.step, straight);
  const reversalStart = playerPosition(player, game.tick + 1);
  tickGame(game, { p1: { direction: 'left' } });
  assert.deepEqual(playerPosition(player, game.tick), reversalStart);
  const beforeArrival = playerPosition(player, game.tick + .5);
  assert.ok(beforeArrival.x > 1 && beforeArrival.x < reversalStart.x);
  assert.deepEqual(playerPosition(player, player.moveAt), point(1, 1));
});

test('an early tap carries the player to the first open corner', () => {
  const game = blankBoard();
  const [player] = game.players;
  game.tiles[index(point(2, 2))] = 'wall';
  tickGame(game, { p1: { direction: 'right' } });
  tickGame(game, { p1: { direction: 'right', turn: 'down' } });
  assert.equal(player.bufferedTurn.direction, 'down');
  step(game, 5, { p1: { direction: 'right' } });
  assert.deepEqual(point(player.x, player.y), point(3, 1));
  tickGame(game);
  assert.deepEqual(player.step.corner, point(3, 1));
  assert.deepEqual(point(player.x, player.y), point(3, 2));
  assert.equal(player.bufferedTurn, undefined);
  step(game, 25);
  assert.deepEqual(point(player.x, player.y), point(3, 2));
});

test('held turns find a farther opening while stale taps expire and new taps can cancel', () => {
  const setup = () => {
    const game = blankBoard();
    for (let x = 2; x < 6; x++) game.tiles[index(point(x, 2))] = 'wall';
    tickGame(game, { p1: { direction: 'right' } });
    return game;
  };
  const held = setup();
  step(held, 26, { p1: { direction: 'down' } });
  assert.deepEqual(point(held.players[0].x, held.players[0].y), point(6, 2));
  const tapped = setup();
  tickGame(tapped, { p1: { turn: 'down' } });
  step(tapped, 30);
  assert.deepEqual(point(tapped.players[0].x, tapped.players[0].y), point(4, 1));
  assert.equal(tapped.players[0].bufferedTurn, undefined);
  const canceled = setup();
  tickGame(canceled, { p1: { turn: 'down' } });
  tickGame(canceled, { p1: { turn: 'right' } });
  step(canceled, 10);
  assert.deepEqual(point(canceled.players[0].x, canceled.players[0].y), point(2, 1));
});

const missedCorner = (after = 2) => {
  const game = blankBoard();
  game.tiles[index(point(3, 2))] = 'wall';
  step(game, 7 + after, { p1: { direction: 'right' } });
  return game;
};

test('a late turn curves back into the opening and keeps planted bombs on the grid', () => {
  const game = missedCorner();
  const [player] = game.players;
  const before = playerPosition(player, game.tick + 1);
  assert.deepEqual(before, point(2.5, 1));
  tickGame(game, { p1: { turn: 'down' } });
  assert.deepEqual(player.step.corner, point(2, 1));
  assert.deepEqual(playerPosition(player, game.tick), before);
  const turning = playerPosition(player, game.tick + 2);
  assert.ok(turning.x < before.x && turning.y > 1);
  for (let at = game.tick; at <= player.moveAt; at += .125) {
    const visual = playerPosition(player, at);
    assert.notEqual(tileAt(game, point(Math.round(visual.x), Math.round(visual.y))), 'wall');
  }
  tickGame(game, { p1: { bomb: true } });
  assert.deepEqual(point(game.bombs[0].x, game.bombs[0].y), point(2, 1));
});

test('late turns respect blocked openings, the recovery limit, and the next open corner', () => {
  for (const cell of [point(2, 1), point(2, 2)]) {
    const game = missedCorner();
    game.bombs.push(bomb(cell.x, cell.y, 90));
    tickGame(game, { p1: { turn: 'down' } });
    assert.equal(game.players[0].step.direction, 'right');
  }
  const tooLate = missedCorner(4);
  tickGame(tooLate, { p1: { turn: 'down' } });
  assert.equal(tooLate.players[0].step.direction, 'right');
  const ahead = missedCorner();
  ahead.tiles[index(point(3, 2))] = 'floor';
  tickGame(ahead, { p1: { turn: 'down' } });
  assert.deepEqual(ahead.players[0].step.corner, point(3, 1));
});

test('two held directions move from rest along the open lane, then take the preferred turn', () => {
  const game = blankBoard();
  game.tiles[index(point(1, 2))] = 'wall';
  game.tiles[index(point(2, 2))] = 'wall';
  const input = { p1: { direction: 'down', alternate: 'right' } };
  tickGame(game, input);
  const [player] = game.players;
  assert.deepEqual(point(player.x, player.y), point(2, 1));
  assert.equal(player.step.direction, 'right');
  step(game, 6, input);
  assert.deepEqual(point(player.x, player.y), point(3, 1));
  tickGame(game, input);
  assert.deepEqual(player.step.corner, point(3, 1));
  assert.deepEqual(point(player.x, player.y), point(3, 2));
  assert.equal(player.step.direction, 'down');
});

test('a held alternate waits until the preferred lane is blocked, and releasing a turn cancels it', () => {
  const game = blankBoard();
  step(game, 8, { p1: { direction: 'right', alternate: 'down' } });
  const [player] = game.players;
  assert.deepEqual(point(player.x, player.y), point(3, 1));
  game.tiles[index(point(4, 1))] = 'wall';
  tickGame(game, { p1: { direction: 'right', alternate: 'down' } });
  assert.deepEqual(point(player.x, player.y), point(3, 2));

  const released = blankBoard();
  released.tiles[index(point(1, 2))] = 'wall';
  released.tiles[index(point(2, 2))] = 'wall';
  tickGame(released, { p1: { direction: 'down', alternate: 'right' } });
  step(released, 9, { p1: { direction: 'right' } });
  assert.deepEqual(point(released.players[0].x, released.players[0].y), point(3, 1));
});

test('damage follows the visible occupied tile while entering or leaving a blast', () => {
  const entering = blankBoard();
  entering.players[0].safeUntil = 0;
  entering.flames = [{ ...point(2, 1), end: 12 }];
  tickGame(entering, { p1: { direction: 'right' } });
  assert.equal(entering.players[0].x, 2);
  assert.deepEqual(playerPosition(entering.players[0], entering.tick), point(1, 1));
  step(entering, 2);
  assert.equal(entering.players[0].hp, 1);
  tickGame(entering);
  assert.equal(entering.players[0].hp, 0);
  const hit = entering.events.find(event => event.kind === 'knockout');
  assert.deepEqual(point(hit.x, hit.y), point(2, 1));

  const stillInside = blankBoard();
  stillInside.players[0].safeUntil = 0;
  stillInside.flames = [{ ...point(1, 1), end: 12 }];
  tickGame(stillInside, { p1: { direction: 'right' } });
  assert.equal(stillInside.players[0].hp, 0);

  const clear = blankBoard();
  clear.players[0].safeUntil = 0;
  tickGame(clear, { p1: { direction: 'right' } });
  step(clear, 2);
  clear.flames = [{ ...point(1, 1), end: 12 }];
  tickGame(clear);
  assert.equal(clear.players[0].hp, 1);
});

test('a curved slide collects loot at the occupied elbow before entering its destination', () => {
  const game = blankBoard();
  game.items = [{ ...point(2, 1), kind: 'capacity' }, { ...point(2, 2), kind: 'range' }];
  tickGame(game, { p1: { direction: 'right' } });
  tickGame(game, { p1: { direction: 'down' } });
  const [player] = game.players;
  assert.equal(player.y, 2);
  assert.equal(player.capacity, 1);
  assert.equal(player.range, 1);
  step(game, 4);
  assert.equal(player.capacity, 2);
  assert.equal(player.range, 1);
  step(game, 6);
  assert.equal(player.range, 2);
  assert.equal(game.items.length, 0);
});

test('blast shape uses connected tiles, capped ends, and the actual directional footprint', () => {
  const game = blankBoard();
  game.tiles[index(point(4, 2))] = 'wall';
  game.tiles[index(point(6, 3))] = 'crate';
  game.bombs = [bomb(4, 3, 1, 3)];
  tickGame(game);
  const flameAt = (x, y) => game.flames.find(flame => flame.x === x && flame.y === y);
  assert.equal(flameAt(4, 3).origin, true);
  assert.equal(flameAt(4, 3).links, FLAME_LINKS.left | FLAME_LINKS.right | FLAME_LINKS.down);
  assert.equal(flameAt(5, 3).links, FLAME_LINKS.left | FLAME_LINKS.right);
  assert.equal(flameAt(6, 3).links, FLAME_LINKS.left);
  assert.equal(flameAt(7, 3), undefined);
  assert.equal(flameAt(4, 2), undefined);

  const directional = blankBoard();
  directional.bombs = [{ ...bomb(4, 3), direction: 'right' }];
  tickGame(directional);
  assert.equal(directional.flames[0].links, FLAME_LINKS.right);
  assert.equal(directional.flames.at(-1).links, FLAME_LINKS.left);
  assert.ok(directional.flames.every(flame => flame.y === 3));
});

test('one starting heart, one spare, and rarer campaign drops', () => {
  const game = blankBoard();
  const [player] = game.players;
  assert.equal(player.hp, 1);
  game.items = [{ ...point(1, 1), kind: 'heart' }, { ...point(1, 1), kind: 'heart' }];
  tickGame(game);
  assert.equal(player.hp, 2);
  tickGame(game);
  assert.equal(game.items.length, 1);
  Object.assign(player, point(3, 3), { safeUntil: 0 });
  game.flames = [{ ...point(3, 3), end: 20 }];
  tickGame(game);
  assert.equal(player.hp, 1);
  assert.equal(game.status, 'playing');
  step(game, 42);
  game.flames = [{ ...point(3, 3), end: game.tick + 2 }];
  tickGame(game);
  assert.equal(player.hp, 0);
  assert.equal(game.status, 'failed');

  let hearts = 0;
  let crates = 0;
  for (let seed = 0; seed < 80; seed++) {
    const map = createGame({ ...settings, seed, missionId: 'roots-2' }, [seat]);
    hearts += Object.values(map.hidden).filter(item => item.kind === 'heart').length;
    crates += map.tiles.filter(tile => tile === 'crate').length;
    const arena = createGame({ ...settings, seed, mode: 'arena' }, [seat, second]);
    assert.ok(!Object.values(arena.hidden).some(item => item.kind === 'heart'));
  }
  assert.ok(hearts > 0 && hearts / crates < .04, 'heart drop rate: ' + hearts + ' / ' + crates);
});

test('blasts destroy exposed pickups and preserve drops uncovered by the same chain', () => {
  const game = blankBoard();
  const crate = point(5, 4);
  game.tiles[index(crate)] = 'crate';
  game.hidden[index(crate)] = { ...crate, kind: 'relic', relic: 'roots:0' };
  game.items = [{ ...point(3, 2), kind: 'heart' }, { ...point(5, 1), kind: 'range' }, { ...point(1, 6), kind: 'speed' }];
  game.bombs = [bomb(3, 3, 1, 3), bomb(5, 3, 81, 3), bomb(5, 5, 1, 2)];
  tickGame(game);
  assert.equal(game.bombs.length, 0);
  assert.deepEqual(game.items.map(item => item.kind), ['speed', 'relic']);
  assert.deepEqual(game.cues, [{ ...crate, kind: 'crate', tick: 1 }]);
  assert.deepEqual(game.events.filter(event => event.kind === 'crate-break').map(({ id, ...event }) => event),
    [{ ...crate, kind: 'crate-break', tick: 1 }]);
  step(game, 12);
  game.bombs = [bomb(5, 3, game.tick + 1)];
  tickGame(game);
  assert.deepEqual(game.items.map(item => item.kind), ['speed']);
});

test('defeat cues mark only lethal hits, preserve the player pose, and expire', () => {
  const game = blankBoard();
  const [player] = game.players;
  game.players.push({ ...player, ...second, ...point(11, 7) });
  Object.assign(player, { hp: 2, shield: true, safeUntil: 0 });
  game.flames = [{ ...point(1, 1), end: 10 }];
  tickGame(game);
  assert.equal(player.shield, false);
  assert.equal(player.hp, 2);
  player.safeUntil = 0;
  tickGame(game);
  assert.equal(player.hp, 1);
  assert.deepEqual(game.cues, []);
  assert.deepEqual(game.events.slice(1).map(event => event.kind), ['hurt', 'hurt']);

  tickGame(game, { p1: { direction: 'right' } });
  player.safeUntil = 0;
  const tick = game.tick + 1;
  const position = playerPosition(player, tick);
  assert.ok(position.x > 1 && position.x < 2);
  tickGame(game);
  assert.equal(player.hp, 0);
  const cue = { ...position, tick, kind: 'knockout', critter: 'hare', facing: 'right' };
  assert.deepEqual(snapshot(game).cues, [cue]);
  assert.deepEqual(snapshot(game).events.slice(1).map(event => event.kind), ['hurt', 'hurt', 'knockout']);
  step(game, VISUAL_CUE_TICKS.knockout - 1);
  assert.deepEqual(game.cues, [cue]);
  tickGame(game);
  assert.deepEqual(game.cues, []);
});

test('a defeated enemy emits one cue and retry starts with a clean board', () => {
  const game = createGame({ ...settings, missionId: 'roots-2' }, [seat],
    { stage: 1, score: 0, discoveries: [], builds: [], elapsed: 0 });
  const [enemy] = game.enemies;
  game.flames = [{ x: enemy.x, y: enemy.y, end: 10 }];
  step(game, 2);
  assert.equal(enemy.hp, 0);
  assert.deepEqual(game.cues, [{ x: enemy.x, y: enemy.y, tick: 1, kind: 'enemy-defeat', enemy: enemy.kind }]);
  assert.deepEqual(createGame(game.settings, [seat], game.checkpoint).cues, []);
});

test('the chain gate replenishes required ammo after players destroy its supplies', () => {
  const game = createGame({ ...settings, missionId: 'roots-2' }, [seat],
    { stage: 1, score: 0, discoveries: [], builds: [], elapsed: 0 });
  const supply = point(5, 5);
  const cell = index(supply);
  assert.deepEqual(game.items, []);
  assert.equal(game.hidden[cell]?.kind, 'capacity');
  assert.equal(tileAt(game, supply), 'crate');
  // Isolate the recovery behavior from other randomly buried ammo.
  game.hidden = { [cell]: game.hidden[cell] };
  tickGame(game);
  assert.deepEqual(game.items, []);
  game.bombs = [bomb(4, 5, game.tick + 1, 1)];
  tickGame(game);
  assert.deepEqual(game.items, [{ ...supply, kind: 'capacity' }]);
  step(game, 12);
  game.bombs = [bomb(4, 5, game.tick + 1, 1)];
  tickGame(game);
  assert.ok(!game.items.some(item => item.kind === 'capacity' && item.x < 7));
  assert.equal(tileAt(game, point(7, 5)), 'root');
  step(game, 12);
  assert.ok(game.items.some(item => item.kind === 'capacity' && item.x === 5 && item.y === 5));
});

test('fresh matches start at range one and uncover pickups by breaking crates', () => {
  for (const mode of ['adventure', 'challenge', 'expedition', 'arena']) {
    const game = createGame({ ...settings, mode }, [seat, second]);
    assert.ok(game.players.every(player => player.range === 1));
    assert.deepEqual(game.items, []);
    assert.ok(Object.values(game.hidden).some(item => item.kind === 'range'));
    assert.ok(Object.values(game.hidden).every(item => tileAt(game, item) === 'crate'));
  }

  const game = createGame(settings, [seat]);
  const [player] = game.players;
  const upgrade = point(1, 4);
  assert.equal(game.hidden[index(upgrade)].kind, 'range');
  Object.assign(player, point(1, 3));
  tickGame(game, { p1: { bomb: true } });
  const [charge] = game.bombs;
  assert.equal(charge.range, 1);
  Object.assign(player, point(3, 3));
  step(game, charge.end - game.tick);
  assert.deepEqual(game.items, [{ ...upgrade, kind: 'range' }]);
  step(game, 12);
  Object.assign(player, upgrade);
  tickGame(game);
  assert.equal(player.range, 2);
  assert.deepEqual(game.items, []);

  const arena = createGame({ ...settings, mode: 'arena' }, [seat, second]);
  arena.players[0].range = 5;
  arena.players[1].hp = 0;
  tickGame(arena);
  step(arena, arena.restartAt - arena.tick);
  assert.equal(arena.round, 2);
  assert.ok(arena.players.every(player => player.range === 1));
  assert.deepEqual(arena.items, []);
});

test('gadget timings, directional advantage, shield cost and pickup reset', () => {
  const standard = createGame(settings, [seat]);
  const long = createGame(settings, [{ ...seat, gadget: 'long' }]);
  const narrow = createGame(settings, [{ ...seat, gadget: 'directional' }]);
  for (const game of [standard, long, narrow]) tickGame(game, { p1: { bomb: true, direction: 'right' } });
  assert.equal(standard.bombs[0].plantedAt, standard.tick);
  assert.equal(long.bombs[0].end - standard.bombs[0].end, GADGETS.long.fuse - GADGETS.standard.fuse);
  assert.equal(narrow.bombs[0].range, standard.bombs[0].range + 2);
  assert.equal(narrow.bombs[0].direction, 'right');
  assert.equal(blastPoints(narrow, narrow.bombs[0]).filter(p => p.y !== 1).length, 0);
  const shield = createGame(settings, [{ ...seat, gadget: 'shield' }]);
  shield.players[0].capacity = 4;
  assert.equal(capacityFor(shield.players[0]), 3);
  shield.players[0].safeUntil = 0;
  shield.flames.push({ ...point(1, 1), end: 10 });
  tickGame(shield);
  assert.equal(shield.players[0].hp, 1);
  assert.equal(shield.players[0].shield, false);
  assert.equal(createGame(settings, [seat]).players[0].capacity, 1);
});

test('rescue targets, chamber carryover and safe retries', () => {
  const game = createGame(settings, [seat, second]);
  for (const kit of game.targets) {
    assert.equal(tileAt(game, kit), 'crate');
    tickGame(game);
    assert.equal(kit.done, false);
    game.tiles[index(kit)] = 'floor';
    Object.assign(game.players[0], kit);
    tickGame(game);
    assert.equal(kit.done, true);
  }
  assert.equal(exitOpen(game), true);
  game.players[0].capacity = 3;
  game.players[0].range = 2;
  game.players[0].hp = 2;
  Object.assign(game.players[0], game.exit);
  tickGame(game);
  assert.equal(game.stage, 1);
  assert.equal(game.checkpoint.builds[0].capacity, 3);
  game.players.forEach(player => { player.hp = 0; });
  tickGame(game);
  assert.equal(game.status, 'failed');
  const retry = createGame(settings, [seat, second], game.checkpoint);
  assert.equal(retry.stage, 1);
  assert.equal(retry.players[0].capacity, 3);
  assert.equal(retry.players[0].range, 2);
  assert.equal(retry.players[0].hp, 2);
  assert.equal(retry.players[1].hp, 1);
  assert.equal(retry.tick, 0);
});

test('the authored opening teaches three gated skills and clears with 1, 2, or 4 seats', () => {
  for (const seats of [[seat], [seat, second], [seat, second, { ...seat, id: 'p3' }, { ...second, id: 'p4' }]]) {
    const game = createGame(settings, seats);
    assert.equal(exitOpen(game), false);
    assert.equal(game.targets.length, 1);
    assert.deepEqual(point(game.targets[0].x, game.targets[0].y), point(7, 7));
    const result = runOpeningRoute(game);
    assert.equal(result.status, 'cleared');
    assert.equal(game.stage, 2);
    assert.equal(tileAt(game, point(7, 5)), 'floor');
    assert.ok(game.players.every(player => player.hp === 1));
  }

  const lure = createGame(settings, [seat], { stage: 1, score: 0, discoveries: [], builds: [], elapsed: 0 });
  assert.equal(lure.enemies[0].kind, 'moth');
  assert.ok(!blastPoints(lure, bomb(6, 5)).some(cell => cell.x === lure.enemies[0].x && cell.y === lure.enemies[0].y));
  Object.assign(lure.players[0], lure.exit);
  tickGame(lure);
  assert.equal(lure.stage, 1);
  assert.equal(exitOpen(lure), false);

  const chain = createGame(settings, [seat], { stage: 2, score: 0, discoveries: [], builds: [], elapsed: 0 });
  chain.bombs = [bomb(6, 5)];
  tickGame(chain);
  assert.equal(tileAt(chain, point(7, 5)), 'root');
  assert.equal(exitOpen(chain), false);

  const shield = createGame(settings, [{ ...seat, gadget: 'shield' }], { stage: 2, score: 0, discoveries: [], builds: [], elapsed: 0 });
  shield.bombs = [bomb(3, 4, 1, 1)];
  step(shield, 13);
  Object.assign(shield.players[0], point(3, 5));
  tickGame(shield);
  assert.equal(capacityFor(shield.players[0]), 1);
  assert.ok(shield.items.some(item => item.kind === 'capacity' && item.x === 5 && item.y === 5));
  Object.assign(shield.players[0], point(5, 5));
  tickGame(shield);
  assert.equal(capacityFor(shield.players[0]), 2);
});

test('boss warnings resolve to a real charge and only a stunned boss takes damage', () => {
  const game = createGame({ ...settings, missionId: 'roots-4' }, [seat],
    { stage: 2, score: 0, discoveries: [], builds: [], elapsed: 0 });
  const boss = game.enemies.find(enemy => enemy.kind === 'boss');
  const hp = boss.hp;
  game.enemies = [boss];
  Object.assign(game.players[0], point(3, 5));
  boss.next = 1;
  tickGame(game);
  assert.equal(boss.phase, 'warn');
  assert.ok(boss.next - game.tick >= 30);
  game.flames.push({ x: boss.x, y: boss.y, end: 20 });
  step(game, 5);
  assert.equal(boss.hp, hp);
  game.tiles[index(point(3, 4))] = 'floor';
  tickGame(game, { p1: { direction: 'up' } });
  for (let i = 0; i < 100 && boss.phase !== 'stunned'; i++) tickGame(game);
  assert.equal(boss.phase, 'stunned');
  game.flames.push({ x: boss.x, y: boss.y, end: game.tick + 4 });
  tickGame(game);
  assert.equal(boss.hp, hp - 1);
});

test('regional hazards change movement or blast propagation', () => {
  const game = blankBoard();
  game.tiles[index(point(5, 5))] = 'reed';
  const blast = blastPoints(game, bomb(4, 5, 1, 6));
  assert.ok(!blast.some(cell => cell.y === 5 && cell.x >= 5));
  game.tiles[index(point(2, 1))] = 'ice';
  Object.assign(game.players[0], point(2, 1));
  tickGame(game, { p1: { direction: 'right', bomb: true } });
  step(game, 4);
  assert.deepEqual([game.bombs[0].x, game.bombs[0].y], [2, 1]);
  // Clear the slide lane before placing the next bomb.
  Object.assign(game.players[0], point(2, 1));
  game.bombs.length = 0;
  game.players[0].moveAt = 0;
  tickGame(game, { p1: { direction: 'right', bomb: true } });
  Object.assign(game.players[0], point(3, 2));
  step(game, 4);
  assert.equal(game.bombs[0].x, 3);
  const rail = point(2, 5);
  game.tiles[index(rail)] = 'rail';
  assert.equal(hazardAt(game, rail, 53), 'warn');
  assert.equal(hazardAt(game, rail, 83), 'hit');
  const vent = point(8, 5);
  game.tiles[index(vent)] = 'vent';
  assert.equal(hazardAt(game, vent, 67), 'warn');
  assert.equal(hazardAt(game, point(9, 5), 86), 'hit');
  const gate = point(6, 5);
  game.tiles[index(gate)] = 'shutter';
  assert.equal(shutterClosed(gate, 1), true);
  assert.ok(!blastPoints(game, bomb(5, 5), 1).some(cell => cell.x === 6));
});

test('every campaign chamber has enough objectives, connected routes and its boss', () => {
  const reach = (game, allowRoot) => {
    const queue = [game.players[0]];
    const seen = new Set([index(game.players[0])]);
    for (let i = 0; i < queue.length; i++) for (const dir of dirs) {
      const next = nextPoint(queue[i], dir);
      const tile = tileAt(game, next);
      if (tile !== 'wall' && (allowRoot || tile !== 'root') && !seen.has(index(next))) {
        queue.push(next);
        seen.add(index(next));
      }
    }
    return seen;
  };
  let rooms = 0;
  const relics = new Set();
  for (const [i, mission] of CAMPAIGN.entries()) {
    for (let stage = 0; stage < mission.chambers; stage++) {
      for (const count of [1, 2, 4]) {
        const game = createGame({ ...settings, missionId: mission.id, seed: 117 + i * 109 },
          [seat, second, { ...seat, id: 'p3' }, { ...second, id: 'p4' }].slice(0, count),
          { stage, score: 0, discoveries: [], builds: [], elapsed: 0 });
        const gateTrial = Boolean(game.chainSupply);
        const connected = reach(game, gateTrial);
        assert.deepEqual(game.items, []);
        assert.ok(connected.has(index(game.exit)), mission.id + ' at stage ' + stage + ' exit');
        game.targets.forEach(target => assert.ok(connected.has(index(target)), mission.id + ' target'));
        assert.ok(game.players.every(player => tileAt(game, player) === 'floor'));
        assert.equal(Boolean(game.enemies.find(enemy => enemy.kind === 'boss')), mission.objective === 'boss' && stage === mission.chambers - 1);
        if (gateTrial) {
          assert.ok(!reach(game, false).has(index(game.exit)));
          assert.ok(Object.values(game.hidden).some(item => item.kind === 'capacity' && reach(game, false).has(index(item))));
        }
        for (const item of Object.values(game.hidden)) if (item.relic) {
          relics.add(item.relic);
          assert.ok(connected.has(index(item)));
        }
      }
      rooms++;
    }
  }
  assert.equal(rooms, 78);
  assert.equal(relics.size, 12);
  assert.equal(REGIONS.length, 6);
});

test('arena bots pick an escape, plant safely, seek opponents and fight seeded matches', () => {
  const game = blankBoard();
  game.settings = { ...settings, mode: 'arena', difficulty: 'hard' };
  game.players[0].bot = true;
  Object.assign(game.players[0], point(3, 3));
  game.players.push({ ...game.players[0], id: 'p2', team: 1, x: 4, y: 3 });
  game.bombs = [bomb(3, 3, 24)];
  assert.ok(botInput(game, game.players[0]).direction);
  game.bombs = [];
  assert.equal(botInput(game, game.players[0]).bomb, true);
  game.players[1].x = 9;
  assert.equal(botInput(game, game.players[0]).direction, 'right');
  const match = createGame({ ...game.settings, seed: 312, arena: 'reeds' }, addArenaBots([{ ...seat, bot: true }], 4));
  step(match, 30 * 180 * 5 + 500);
  assert.equal(match.status, 'cleared');
  assert.ok(match.round >= 2 && match.round <= 5);
  assert.ok(match.elapsed > 100);
  const thisWeek = Date.UTC(2026, 10, 18);
  assert.deepEqual(expeditionFor(thisWeek), expeditionFor(thisWeek + 86400000));
  assert.notEqual(expeditionFor(thisWeek).seed, expeditionFor(thisWeek + 7 * 86400000).seed);
});

test('an easy Arena bot plants while leaving and takes the escape turn before its attack timer', () => {
  const game = blankBoard();
  game.settings = { ...settings, mode: 'arena', difficulty: 'easy', fuse: 'quick' };
  game.tiles.fill('wall');
  for (const cell of [point(3, 3), point(4, 3), point(3, 4), point(4, 4)]) game.tiles[index(cell)] = 'floor';
  const [bot] = game.players;
  Object.assign(bot, point(3, 3), { bot: true, range: 2, brainAt: 0 });
  game.players.push({ ...bot, ...second, ...point(4, 3), bot: false, team: 1 });
  tickGame(game);
  assert.equal(game.bombs.length, 1);
  assert.deepEqual(point(bot.x, bot.y), point(3, 4));
  step(game, 6);
  assert.ok(game.tick < bot.brainAt);
  assert.deepEqual(point(bot.x, bot.y), point(4, 4));
  step(game, 47);
  assert.equal(bot.hp, 1);
  assert.equal(game.players[1].hp, 0);
});

test('Arena bots reject a bomb in a sealed lane and preserve the aim of a directional escape shot', () => {
  const game = blankBoard();
  game.settings = { ...settings, mode: 'arena' };
  game.tiles.fill('wall');
  for (const cell of [point(3, 3), point(4, 3), point(5, 3)]) game.tiles[index(cell)] = 'floor';
  const [bot] = game.players;
  Object.assign(bot, point(3, 3), { bot: true, range: 3, brainAt: 0 });
  game.players.push({ ...bot, ...second, ...point(5, 3), bot: false, team: 1 });
  assert.ok(!botInput(game, bot).bomb);
  game.tiles[index(point(3, 4))] = 'floor';
  bot.gadget = 'directional';
  tickGame(game);
  assert.equal(game.bombs[0].direction, 'right');
  assert.deepEqual(point(bot.x, bot.y), point(3, 4));
});
