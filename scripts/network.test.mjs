import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { WebSocket } from 'ws';
import { DEFAULT_SETTINGS as settings, nextPoint } from '../dist/shared/engine.js';

const token = () => randomBytes(36).toString('hex');
async function serverFor(database, port = 0) {
  const processEnv = { ...process.env, HOST: '127.0.0.1', PORT: String(port), BURROW_DB: database };
  delete processEnv.PUBLIC_ORIGIN;
  const child = spawn(process.execPath, ['dist/server/server.js'], { env: processEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', buffer => { errors += String(buffer); });
  const address = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not bind: ' + errors)), 5000);
    child.on('exit', () => { clearTimeout(timeout); reject(new Error(errors)); });
    child.stdout.on('data', buffer => {
      const match = String(buffer).match(/https?:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
  });
  const stop = async () => {
    if (child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  };
  return { port: address, url: 'http://127.0.0.1:' + address, stop };
}

async function joinRoom(server, code, auth = token(), name = 'Pip') {
  const socket = new WebSocket('ws://127.0.0.1:' + server.port + '/rooms', { origin: server.url });
  const frames = [];
  socket.on('message', data => {
    frames.push(JSON.parse(String(data)));
    if (frames.length > 3000) frames.shift();
  });
  socket.on('error', () => {});
  await once(socket, 'open');
  const send = packet => socket.send(JSON.stringify(packet));
  send({ type: 'enter', code, token: auth, settings, name });
  return {
    auth, socket, send,
    async expect(type, predicate = () => true) {
      for (let i = 0; i < 500; i++) {
        const found = frames.findLast(frame => frame.type === type && predicate(frame));
        if (found) return found;
        await delay(10);
      }
      throw new Error('No ' + type + ' message. Last results: ' + JSON.stringify(frames.slice(-3).map(frame => [frame.type, frame.message ?? frame.lobby?.phase])));
    }
  };
}

test('a new online profile can select and start the final Adventure mission', async t => {
  const server = await serverFor(':memory:');
  t.after(server.stop);
  const host = await joinRoom(server);
  t.after(() => host.socket.terminate());
  const { profile } = await host.expect('profile');
  assert.deepEqual(profile.cleared, []);
  host.send({ type: 'setup', seats: 4, settings: { ...settings, missionId: 'shutters-4' } });
  await host.expect('lobby', ({ lobby }) => lobby.settings.missionId === 'shutters-4');
  host.send({ type: 'ready', ready: true });
  host.send({ type: 'start' });
  await host.expect('frame', ({ state }) => state.settings.missionId === 'shutters-4');
});

test('human movement is broadcast on its first simulation tick between regular snapshots', async t => {
  const server = await serverFor(':memory:');
  t.after(server.stop);
  const host = await joinRoom(server);
  t.after(() => host.socket.terminate());
  assert.equal(host.socket.extensions, 'permessage-deflate');
  const { id } = await host.expect('entered');
  host.send({ type: 'ready', ready: true });
  await host.expect('lobby', ({ lobby }) => lobby.members[0].ready);
  let idleTick;
  let firstMove;
  host.socket.on('message', raw => {
    const message = JSON.parse(String(raw));
    if (message.type !== 'frame' || message.state.tick < 2) return;
    if (idleTick === undefined) {
      idleTick = message.state.tick;
      host.send({ type: 'input', seq: 1, turn: 'right' });
    } else if (!firstMove) {
      const player = message.state.players.find(player => player.id === id);
      if (player?.step) firstMove = { tick: message.state.tick, started: player.step.started };
    }
  });
  host.send({ type: 'start' });
  await host.expect('frame', ({ state }) => state.players.some(player => player.id === id && player.step));
  assert.equal(firstMove.tick, firstMove.started);
});

test('an Adventure clear saves both rewards and carries the party to the next mission after a restart', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'burrow-continuation-'));
  const database = join(folder, 'profiles.sqlite');
  let server = await serverFor(database);
  const peers = [];
  t.after(async () => {
    for (const peer of peers) peer.socket.terminate();
    await server.stop();
    await rm(folder, { recursive: true, force: true });
  });
  const addPeer = async (code, auth) => {
    const peer = await joinRoom(server, code, auth);
    peers.push(peer);
    const { id } = await peer.expect('entered');
    return { ...peer, id };
  };
  let host = await addPeer();
  const { lobby: { code } } = await host.expect('lobby');
  let guest = await addPeer(code);
  await server.stop();
  const db = new DatabaseSync(database);
  try {
    // Play the final tutorial chamber from a saved checkpoint so the test can focus on clearing and continuing.
    const checkpoint = { stage: 2, score: 1520, discoveries: [], builds: [], elapsed: 335 };
    db.prepare("UPDATE rooms SET data = json_set(data, '$.resume', json(?)) WHERE code = ?").run(JSON.stringify(checkpoint), code);
  } finally {
    db.close();
  }
  server = await serverFor(database, server.port);
  [host, guest] = await Promise.all([addPeer(code, host.auth), addPeer(code, guest.auth)]);
  host.send({ type: 'ready', ready: true });
  guest.send({ type: 'ready', ready: true });
  await host.expect('lobby', ({ lobby }) => lobby.resume && lobby.members.every(member => member.ready));
  host.send({ type: 'start' });
  const started = await host.expect('frame', ({ state }) => state.stage === 2);
  let point = started.state.players.find(player => player.id === host.id);
  let seq = 0;
  const move = async (direction, distance = 1, bomb = false) => {
    for (let i = 0; i < distance; i++) {
      point = nextPoint(point, direction);
      host.send({ type: 'input', seq: ++seq, turn: direction, bomb: bomb && i === 0 });
      await host.expect('frame', ({ state, ack }) => ack === seq && state.players.some(player =>
        player.id === host.id && player.hp > 0 && player.x === point.x && player.y === point.y && state.tick >= player.moveAt));
    }
  };
  await move('right', 2);
  await move('down', 2);
  await move('up', 1, true);
  await move('left');
  const { state: { tick: firstBlast } } = await host.expect('frame', ({ state }) => state.flames.some(flame => flame.x === 3 && flame.y === 4));
  await host.expect('frame', ({ state }) => state.tick > firstBlast && !state.flames.length);
  await move('right');
  await move('down', 2);
  await move('right', 3);
  await move('left', 1, true);
  await move('left', 2, true);
  await move('up');
  await host.expect('frame', ({ state }) => state.tiles[5 * 15 + 7] === 'floor' && !state.flames.length);
  await move('down');
  await move('right', 8);
  await move('down', 2);
  await move('right');
  host.send({ type: 'input', seq: ++seq, turn: 'down' });
  const finished = await host.expect('frame', ({ state }) => state.status === 'cleared');
  assert.equal(finished.matchId, started.matchId);
  for (const peer of [host, guest]) {
    const { profile } = await peer.expect('profile', ({ profile }) => profile.cleared.includes('roots-1'));
    assert.equal(profile.xp, 100);
    const { lobby } = await peer.expect('lobby', ({ lobby }) => lobby.phase === 'result' && lobby.nextMission);
    assert.deepEqual(lobby.nextMission, { missionId: 'roots-2', waitingForParty: false });
  }

  await server.stop();
  server = await serverFor(database, server.port);
  host = await addPeer(code, host.auth);
  const { lobby } = await host.expect('lobby', ({ lobby }) => lobby.nextMission?.waitingForParty);
  assert.deepEqual(lobby.nextMission, { missionId: 'roots-2', waitingForParty: true });
  let launched = false;
  host.socket.on('message', raw => { if (JSON.parse(raw).type === 'frame') launched = true; });
  await delay(4100);
  assert.equal(launched, false);

  guest = await addPeer(code, guest.auth);
  for (const peer of [host, guest]) {
    const { state, matchId } = await peer.expect('frame', ({ state }) => state.settings.missionId === 'roots-2');
    assert.notEqual(matchId, started.matchId);
    assert.equal(state.settings.seed, 226);
    assert.equal(state.stage, 0);
    assert.equal(state.score, 0);
    assert.deepEqual(state.players.map(player => player.id), [host.id, guest.id]);
    assert.ok(state.players.every(player => player.range === 1 && player.capacity === 1));
    const { profile } = await peer.expect('profile');
    assert.equal(profile.xp, 100);
    assert.deepEqual(profile.cleared, ['roots-1']);
  }
});

test('private invite, four seats, authoritative input, reconnect, migration, checkpoint restart and duplicate rewards', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'burrow-test-'));
  const database = join(folder, 'profiles.sqlite');
  let server = await serverFor(database);
  const peers = [];
  t.after(async () => {
    for (const peer of peers) peer.socket.terminate();
    await server.stop();
    await rm(folder, { recursive: true, force: true });
  });
  const add = async (code, auth, name) => {
    const peer = await joinRoom(server, code, auth, name);
    peers.push(peer);
    return peer;
  };

  const host = await add(undefined, undefined, 'Host');
  const { lobby: created } = await host.expect('lobby');
  const code = created.code;
  const [guest, third, fourth] = await Promise.all(['Bramble', 'Moss', 'Button'].map(name => add(code, undefined, name)));
  const four = await host.expect('lobby', frame => frame.lobby.members.length === 4);
  assert.equal(four.lobby.code, code);
  const fifth = await add(code, undefined, 'Overflow');
  assert.match((await fifth.expect('error', value => value.fatal)).message, /full/);
  const guestId = (await guest.expect('entered')).id;
  const hostId = (await host.expect('entered')).id;
  guest.send({ type: 'start' });
  assert.match((await guest.expect('error')).message, /host/);
  for (const peer of [host, guest, third, fourth]) peer.send({ type: 'ready', ready: true });
  await host.expect('lobby', frame => frame.lobby.members.every(member => member.ready));
  host.send({ type: 'start' });
  const started = await host.expect('frame', frame => frame.state.players.length === 4);
  assert.equal(started.state.stage, 0);
  assert.ok(started.state.players.every(player => player.range === 1));
  assert.deepEqual(started.state.items, []);
  assert.deepEqual(started.state.hidden, {});
  guest.send({ type: 'input', seq: 1, direction: 'diagonal', bomb: true });
  assert.match((await guest.expect('error', frame => /movement/.test(frame.message))).message, /movement/);
  guest.send({ type: 'input', seq: 1, direction: 'right', bomb: 'true' });
  assert.match((await guest.expect('error', frame => /bomb/.test(frame.message))).message, /bomb/);
  const initial = started.state.players.find(item => item.id === guestId);
  await delay(150);
  guest.send({ type: 'input', seq: 1, direction: 'right', bomb: true });
  const progressed = await host.expect('frame', frame => frame.state.bombs.some(bomb => bomb.owner === guestId));
  assert.ok(progressed.state.players.find(item => item.id === guestId).x > initial.x);
  const before = (await guest.expect('frame', frame => frame.ack === 1)).state.tick;
  const close = once(guest.socket, 'close');
  guest.socket.terminate();
  await close;
  await host.expect('lobby', frame => frame.lobby.members.some(member => member.id === guestId && !member.connected));
  const returning = await add(code, guest.auth, 'Bramble');
  assert.equal((await returning.expect('entered')).id, guestId);
  assert.ok((await returning.expect('frame', value => value.state.tick > before)).state.tick > before);

  const beforeCrash = await host.expect('frame', message => message.state.tick > 20);
  await server.stop();
  server = await serverFor(database, server.port);
  const rejoined = await Promise.all([host, guest, third, fourth].map(peer => add(code, peer.auth)));
  const [newHost] = rejoined;
  assert.equal((await newHost.expect('entered')).id, hostId);
  await newHost.expect('lobby', frame => frame.lobby.resume && frame.lobby.members.every(member => member.connected));
  for (const peer of rejoined) peer.send({ type: 'ready', ready: true });
  await newHost.expect('lobby', frame => frame.lobby.members.every(member => member.ready));
  newHost.send({ type: 'start' });
  const restored = await newHost.expect('frame');
  assert.equal(restored.state.stage, beforeCrash.state.checkpoint.stage);
  assert.equal(restored.matchId, beforeCrash.matchId);
  newHost.send({ type: 'leave' });
  const transferred = await rejoined[1].expect('lobby', frame => frame.lobby.host !== hostId && frame.lobby.members.length === 3);
  assert.ok([guestId, (await rejoined[2].expect('entered')).id, (await rejoined[3].expect('entered')).id].includes(transferred.lobby.host));

  const reward = { id: 'local-' + randomBytes(16).toString('hex'), missionId: 'roots-1', mode: 'adventure', discoveries: ['roots:0'], score: 840, seed: 117 };
  const post = async rewards => {
    const response = await fetch(server.url + '/api/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: host.auth, rewards }) });
    return [response.status, await response.json()];
  };
  const first = await post([reward, reward]);
  const retry = await post([reward]);
  assert.deepEqual(first, retry);
  assert.equal(first[1].profile.xp, 145);
  assert.equal((await post([{ ...reward, id: 'online-' + randomBytes(16).toString('hex') }]))[0], 400);
});
