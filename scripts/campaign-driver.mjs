import { GADGETS, missionFor } from '../dist/shared/content.js';
import { DIRECTIONS, blastPoints, canMove, capacityFor, exitOpen, hazardAt, index, moveDelay, nextPoint, playerCell, tickGame, tileAt } from '../dist/shared/engine.js';

const dirs = Object.keys(DIRECTIONS);
const same = (a, b) => a.x === b.x && a.y === b.y;
const gap = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function shortest(game, from, goal, { crates = true, avoid = () => 0 } = {}) {
  const queue = [{ point: from, cost: 0, path: [] }];
  const costs = new Map([[index(from), 0]]);
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const node = queue.shift();
    if (goal(node.point, node.path)) return node.path;
    for (const dir of dirs) {
      const next = nextPoint(node.point, dir);
      const tile = tileAt(game, next);
      const penalty = avoid(next, node.path.length);
      if (tile === 'wall' || tile === 'root' || tile === 'crate' && !crates || penalty === Infinity) continue;
      if (game.bombs.some(bomb => same(next, bomb))) continue;
      const cost = node.cost + (tile === 'crate' ? 9 : 1) + penalty;
      if ((costs.get(index(next)) ?? Infinity) <= cost) continue;
      costs.set(index(next), cost);
      queue.push({ point: next, cost, path: [...node.path, dir] });
    }
  }
  return [];
}

export function openingChambers() {
  const move = (direction, tiles = 1, bomb = false) => ({ direction, ticks: tiles * 6, bomb });
  const settle = { ticks: 85 };
  return [
    // Break the kit's crate and use the nook one tile above the blast lane.
    [move('down', 2), move('right', 2), move('down', 2), move('right', 2), move('down', 2), move('right'),
      move('left', 1, true), move('up'), settle, move('down'), move('right', 8), move('down'), { direction: 'down', ticks: 4 }],
    // Lure the moth from the far end of the lane and turn out of the blast.
    [move('down', 2), move('right', 5), move('left', 1, true), move('up'), settle,
      move('up'), move('left', 3), { direction: 'up', ticks: 5 }],
    // Break the supply crate, then plant at the two adjacent marks.
    [move('right', 2), move('down', 2), move('up', 1, true), move('left'), settle, move('right'), move('down', 2),
      move('right', 3), move('left', 1, true), move('left', 2, true),
      move('up'), settle, move('down'), move('right', 8), move('down', 2), move('right'), { direction: 'down', ticks: 4 }]
  ];
}

export function runOpeningRoute(game) {
  const actions = openingChambers().flat();
  for (const action of actions) for (let tick = 0; tick < action.ticks; tick++) {
    tickGame(game, { p1: { direction: action.direction, bomb: action.bomb && tick === 0 } });
  }
  return { game, actions, status: game.status, tick: game.tick };
}

export function driveCampaign(game, limit = 4000, { online = false } = {}) {
  const actions = [];
  const player = () => game.players.find(seat => seat.id === 'p1');
  const lessons = game.settings.missionId === 'roots-1' && ['adventure', 'challenge'].includes(game.settings.mode);
  if (lessons && !online && game.stage === 0 && player()?.gadget === 'standard') return runOpeningRoute(game);
  const directed = (direction, bomb = false, ticks = moveDelay(player())) => {
    const choices = [direction, ...dirs.filter(dir => dir !== direction), ...(direction ? [undefined] : [])];
    let best = -Infinity;
    let input = direction;
    for (const option of choices) {
      const trial = structuredClone(game);
      for (let i = 0; i < ticks + 2; i++) tickGame(trial, { p1: { direction: i < ticks ? option : undefined, bomb: bomb && i === 0 } });
      const result = trial.players[0];
      const danger = trial.enemies.filter(enemy => enemy.hp && enemy.phase === 'warn')
        .some(enemy => (enemy.x === result.x || enemy.y === result.y) && gap(enemy, result) <= 5);
      const score = (trial.stage > game.stage || trial.status === 'cleared' ? 1000 : 0) + 30 * result.hp
        + 4 * Number(option === direction) - 4 * Number(danger);
      if (score > best) { best = score; input = option; }
      if (option === direction && result.hp >= player().hp && !danger) break;
    }
    actions.push({ direction: input, bomb, ticks });
    for (let i = 0; i < ticks; i++) tickGame(game, { p1: { direction: input, bomb: bomb && i === 0 } });
  };
  const plant = direction => {
    const pilot = player();
    if (same(playerCell(pilot, game.tick + 1), pilot)) directed(direction, true);
    else directed(undefined, false, 1);
  };
  for (let i = 0; i < limit && game.status === 'playing'; i++) {
    const p = player();
    if (!p.hp) break;
    const live = game.enemies.filter(enemy => enemy.hp);
    const boss = live.find(enemy => enemy.kind === 'boss');
    const warning = new Set();
    for (const enemy of live) {
      if (online && !boss) break;
      if (enemy.phase !== 'warn' && enemy.phase !== 'charge') continue;
      let cell = enemy;
      for (let tile = 0; tile < (enemy.kind === 'boss' ? 8 : 4); tile++) {
        cell = nextPoint(cell, enemy.facing);
        if (['wall', 'root', 'crate'].includes(tileAt(game, cell))) break;
        warning.add(index(cell));
      }
    }
    const risk = (point, steps) => {
      const stride = moveDelay(p);
      const arrival = game.tick + steps * stride;
      const hazard = hazardAt(game, point, arrival);
      if (hazard === 'hit') return 6;
      if (hazard === 'warn' && hazardAt(game, point, arrival + stride + 2) === 'hit') return 18;
      if (game.flames.some(flame => same(flame, point) && flame.end >= game.tick + 1 + steps * moveDelay(p))) return 9;
      if (warning.has(index(point))) return 6;
      return live.some(enemy => enemy.phase !== 'stunned' && same(enemy, point)) ? 9 : 0;
    };
    if (boss && (warning.has(index(p)) || boss.phase === 'charge' && gap(p, boss) <= 1)) {
      const evasive = shortest(game, p, point => !same(point, p) && !risk(point, 1), { crates: false, avoid: risk });
      if (evasive.length) { directed(evasive[0]); continue; }
    }
    const planned = game.bombs.filter(bomb => bomb.owner === p.id);
    const gate = Boolean(game.chainSupply && tileAt(game, { x: 7, y: 5 }) === 'root');
    const placement = { x: 6, y: 5 };
    const ammo2 = { x: 5, y: 5 };
    const inDanger = point => game.bombs.some(bomb => blastPoints(game, bomb).some(cell => same(point, cell)));

    if (gate && p.capacity >= 2) {
      if (!planned.length && same(p, placement)) {
        plant('left');
        continue;
      }
      if (planned.length === 1 && same(planned[0], placement) && p.y === ammo2.y && p.x > ammo2.x) {
        directed('left');
        continue;
      }
      if (planned.length === 1 && same(planned[0], placement) && same(p, ammo2)) {
        plant('left');
        continue;
      }
    }
    if (planned.length) {
      const escape = shortest(game, p, point => !inDanger(point) && !risk(point, 1), { crates: false, avoid: risk });
      if (escape[0]) directed(escape[0]);
      else directed(undefined, false, Math.max(1, Math.min(7, planned[0].end - game.tick + 1)));
      continue;
    }
    let goal = exitOpen(game) ? game.exit : game.targets.filter(target => !target.done).sort((a, b) => gap(a, p) - gap(b, p))[0];
    if (gate) goal = placement;
    if (boss) goal = boss;
    if (!goal && lessons && game.stage === 1) goal = live[0];
    if (!goal) break;
    const chase = shortest(game, p, point => same(point, goal), { avoid: risk });
    const path = chase[0];
    const crate = path && tileAt(game, nextPoint(p, path)) === 'crate';
    const targetReached = same(p, goal);
    const blast = blastPoints(game, { ...p, end: game.tick + 72, direction: undefined });
    const objective = missionFor(game.settings.missionId).objective;
    const relay = objective === 'relay' || objective === 'boss';
    const hitTarget = relay && !gate && !exitOpen(game) && !boss && blast.some(point => same(point, goal));
    const hitBoss = boss && boss.phase === 'stunned' && game.tick + GADGETS[p.gadget].fuse + 2 <= boss.next && blast.some(point => same(point, boss));
    const hitEnemy = !boss && live.some(enemy => blast.some(point => same(point, enemy)) && gap(p, enemy) >= 2);
    if (crate || hitTarget || hitBoss || (hitEnemy && i % 9 === 0)) {
      const retreat = shortest(game, p, point => !blast.some(cell => same(point, cell)) && !risk(point, 1), { crates: false, avoid: risk });
      if (retreat.length) { plant(retreat[0]); continue; }
    }
    if (path && !crate) {
      if (boss && boss.phase === 'warn' && gap(p, boss) < 7) {
        const side = dirs.find(dir => {
          const next = nextPoint(p, dir);
          return next.x !== boss.x && next.y !== boss.y && canMove(game, next) && risk(next, 0) === 0;
        });
        if (side) { directed(side); continue; }
      }
      directed(path);
    } else if (targetReached || !path) {
      if (boss && boss.phase !== 'stunned' || !path && !targetReached) {
        const fallback = dirs.find(dir => canMove(game, nextPoint(p, dir)) && risk(nextPoint(p, dir), 0) === 0);
        if (fallback) { directed(fallback); continue; }
      }
      directed(undefined, false, 8);
    } else {
      directed(undefined, false, 6);
    }
  }
  return { actions, status: game.status, tick: game.tick, game };
}

export async function replayInputs(page, actions) {
  for (let from = 0; from < actions.length; from += 50) {
    await page.evaluate(burst => {
      const key = { up: 'KeyW', left: 'KeyA', down: 'KeyS', right: 'KeyD' };
      const emit = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, cancelable: true }));
      for (const action of burst) {
        if (action.direction) emit('keydown', key[action.direction]);
        if (action.bomb) { emit('keydown', 'Space'); emit('keyup', 'Space'); }
        window.advanceTime(action.ticks * 1000 / 30);
        if (action.direction) emit('keyup', key[action.direction]);
      }
    }, actions.slice(from, from + 50));
  }
}
