import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, mkdirSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { CRITTERS, GADGETS, TICK_RATE, campaignEntry, expeditionFor, levelFor } from './content.js';
import { DEFAULT_SETTINGS, DIRECTIONS, addArenaBots, cleanSeat, cleanSettings, createGame, snapshot, tickGame,
  type Checkpoint, type Direction, type Input, type Settings, type State } from './engine.js';
import { applyReward, blankProfile, parseReward, type Profile, type Reward } from './profile.js';
import type { Lobby, Member, ServerMessage } from './protocol.js';

const port = Number(process.env.PORT ?? 4317);
const host = process.env.HOST ?? '127.0.0.1';
const dbPath = resolve(process.env.BURROW_DB ?? 'data/burrow.sqlite');
const root = fileURLToPath(new URL('../public/', import.meta.url));
const GRACE = 60000;
const MISSION_BREAK = 4000;
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS rewards (profile TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (profile, id));
  CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, data TEXT NOT NULL, saved INTEGER NOT NULL);
`);
const selectProfile = db.prepare('SELECT data FROM profiles WHERE id = ?');
const saveProfile = db.prepare('INSERT INTO profiles VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data');
const addReward = db.prepare('INSERT OR IGNORE INTO rewards VALUES (?, ?)');
const selectRoom = db.prepare('SELECT data FROM rooms WHERE code = ? AND saved > ?');
const saveRoom = db.prepare('INSERT INTO rooms VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET data = excluded.data, saved = excluded.saved');
const deleteRoom = db.prepare('DELETE FROM rooms WHERE code = ?');
function profileFor(id: string): Profile {
  const row = selectProfile.get(id);
  return row ? JSON.parse(String(row.data)) as Profile : blankProfile();
}
function transact<T>(run: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = run();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
function award(id: string, rewards: Reward[]) {
  let profile = profileFor(id);
  for (const reward of rewards) if (addReward.run(id, reward.id).changes) profile = applyReward(profile, reward);
  if (rewards.length) saveProfile.run(id, JSON.stringify(profile));
  return profile;
}
function identity(token: unknown) {
  return typeof token === 'string' && /^[a-z0-9-]{64,90}$/i.test(token)
    ? createHash('sha256').update(token).digest('hex') : null;
}

interface SeatRecord {
  auth: string;
  member: Member;
  expires: number;
  joined: number;
}
interface LiveSeat extends SeatRecord {
  ws?: WebSocket;
  input: Input;
  inputAt: number;
  connectedAt: number;
  seq: number;
}
interface SavedRoom {
  code: string;
  host: string;
  seats: number;
  settings: Settings;
  members: SeatRecord[];
  resume?: Checkpoint;
  matchId: string;
  continuation?: { missionId: string; seed: number; startAt: number };
}
interface Room extends Omit<SavedRoom, 'members'> {
  members: Map<string, LiveSeat>;
  state?: State;
  lastActive: number;
  lastFrameTick?: number;
}
const rooms = new Map<string, Room>();
function persist(room: Room) {
  const members = Array.from(room.members.values(), ({ auth, member, expires, joined }) => ({ auth, member, expires, joined }));
  const stored: SavedRoom = { code: room.code, host: room.host, seats: room.seats, settings: room.settings, members, matchId: room.matchId,
    resume: room.resume, continuation: room.continuation };
  saveRoom.run(room.code, JSON.stringify(stored), Date.now());
}
function getRoom(code: string) {
  const active = rooms.get(code);
  if (active) return active;
  const row = selectRoom.get(code, Date.now() - 86400000);
  if (!row) return;
  const saved: SavedRoom = JSON.parse(String(row.data));
  const now = Date.now();
  const room: Room = { ...saved, members: new Map(saved.members.map(record => [
    record.auth, { ...record, expires: now + GRACE, member: { ...record.member, connected: false, ready: false }, input: {}, inputAt: 0, connectedAt: 0, seq: 0 }
  ])), lastActive: now };
  rooms.set(code, room);
  return room;
}
function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from(randomBytes(8), value => alphabet[value & 31]).join('');
  } while (getRoom(code));
  return code;
}
function roomInfo(room: Room): Lobby {
  const state = room.state;
  const members = [...room.members.values()].map(seat => seat.member);
  return {
    code: room.code, host: room.host, members,
    settings: room.settings, seats: room.seats, resume: Boolean(room.resume && !state),
    nextMission: room.continuation && { missionId: room.continuation.missionId, waitingForParty: members.some(member => !member.connected) },
    phase: !state ? 'lobby' : state.status === 'playing' || state.status === 'between' ? 'match' : 'result'
  };
}
function send(ws: WebSocket | undefined, message: ServerMessage) {
  if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < 524288) ws.send(JSON.stringify(message));
}
function announce(room: Room) {
  const lobby = roomInfo(room);
  for (const seat of room.members.values()) send(seat.ws, { type: 'lobby', lobby });
}
function frame(room: Room, only?: LiveSeat) {
  if (!room.state) return;
  const state = snapshot(room.state);
  // A finished match keeps its last tick. Rejoining should go straight to the result.
  if (only && (state.status === 'cleared' || state.status === 'failed')) state.cues = [];
  if (!only) room.lastFrameTick = state.tick;
  for (const seat of only ? [only] : room.members.values()) send(seat.ws, { type: 'frame', state, ack: seat.seq, matchId: room.matchId });
}
function finish(room: Room, state: State, now: number) {
  const mode = state.settings.mode;
  if (mode === 'arena' || state.status !== 'cleared') return;
  const reward: Reward = { id: 'online-' + room.matchId, missionId: state.settings.missionId, mode,
    discoveries: state.discoveries, score: state.score, seed: state.settings.seed };
  const next = mode === 'adventure' && campaignEntry(state.settings.missionId, 1);
  const profiles = transact(() => {
    const updates = [...room.members.values()]
      .filter(seat => state.players.some(player => player.id === seat.member.id))
      .map(seat => [seat, award(seat.auth, [reward])] as const);
    room.resume = undefined;
    room.continuation = next ? { ...next, startAt: now + MISSION_BREAK } : undefined;
    persist(room);
    return updates;
  });
  for (const [seat, profile] of profiles) send(seat.ws, { type: 'profile', profile });
}
function updateRoom(room: Room, now: number) {
  const state = room.state;
  const expired = [...room.members.values()].filter(seat => !seat.ws && seat.expires <= now);
  if (expired.length) {
    for (const seat of expired) {
      room.members.delete(seat.auth);
      const player = state?.players.find(player => player.id === seat.member.id);
      if (player) player.hp = 0;
    }
    if (!Array.from(room.members.values()).some(seat => seat.member.id === room.host)) {
      room.host = [...room.members.values()].sort((a, b) => Number(b.member.connected) - Number(a.member.connected) || a.connectedAt - b.connectedAt || a.joined - b.joined)[0]?.member.id ?? '';
    }
    if (room.members.size) persist(room);
    announce(room);
  }
  const connected = [...room.members.values()].filter(seat => seat.ws);
  if (!connected.length) {
    if (now - room.lastActive > GRACE) rooms.delete(room.code);
    return;
  }
  room.lastActive = now;
  if (room.continuation && now >= room.continuation.startAt && connected.length === room.members.size) {
    const { missionId, seed } = room.continuation;
    room.settings = { ...room.settings, missionId, seed };
    beginMatch(room, connected);
    return;
  }
  if (!state || state.status === 'cleared' || state.status === 'failed') return;
  const previous = state.stage;
  const previousRound = state.round;
  const inputs: Record<string, Input> = {};
  for (const seat of room.members.values()) {
    if (seat.ws && now - seat.inputAt <= 700) inputs[seat.member.id] = { ...seat.input };
    else {
      const player = state.players.find(player => player.id === seat.member.id);
      if (player) player.bufferedBomb = undefined;
    }
    seat.input.bomb = false;
    seat.input.turn = undefined;
  }
  tickGame(state, inputs);
  if (state.stage !== previous && state.settings.mode !== 'arena') {
    room.resume = state.checkpoint;
    persist(room);
  }
  if (state.status as string === 'cleared' || state.status as string === 'failed') {
    finish(room, state, now);
    announce(room);
    frame(room);
  } else if (state.tick - (room.lastFrameTick ?? 0) >= 2 || state.stage !== previous || state.round !== previousRound
    || state.players.some(player => !player.bot && player.step?.started === state.tick)) frame(room);
}

const permitted = (settings: Settings, seat: LiveSeat) =>
  settings.mode !== 'challenge' || profileFor(seat.auth).cleared.includes(settings.missionId);
const challengeLocked = 'Clear this mission to unlock its score challenge.';

function startMatch(room: Room, retry: boolean) {
  if (room.state && (room.state.status === 'playing' || room.state.status === 'between')) return 'A match is already in progress.';
  if (room.continuation) return 'The next mission will start automatically.';
  const hostSeat = [...room.members.values()].find(seat => seat.member.id === room.host);
  if (!hostSeat) return 'The host needs to rejoin.';
  if (!permitted(room.settings, hostSeat)) return challengeLocked;
  const resume = retry || !room.state ? room.resume : undefined;
  const connected = [...room.members.values()].filter(seat => seat.ws);
  if (!retry && !connected.every(seat => seat.member.ready)) return 'Everyone needs to be ready.';
  if (room.settings.mode !== 'arena' && room.members.size !== connected.length) return 'Wait for the remaining party to reconnect or for their seats to expire.';
  beginMatch(room, connected, resume);
}

function beginMatch(room: Room, connected: LiveSeat[], resume?: Checkpoint) {
  const usesArena = room.settings.mode === 'arena';
  if (room.settings.mode === 'expedition' && !resume) {
    const { seed, missionId } = expeditionFor(Date.now());
    room.settings = { ...room.settings, seed, missionId };
  }
  const roster = connected.map(({ member, auth }) => {
    const level = levelFor(profileFor(auth).xp);
    return cleanSeat(member.id, usesArena || CRITTERS[member.critter].unlock <= level ? member.critter : 'hare',
      usesArena || GADGETS[member.gadget].unlock <= level ? member.gadget : 'standard');
  });
  if (!resume) room.matchId = randomUUID();
  room.state = createGame(room.settings, usesArena ? addArenaBots(roster, room.settings.teams ? 4 : room.seats) : roster, resume);
  room.resume = usesArena ? undefined : room.state.checkpoint;
  room.continuation = undefined;
  for (const seat of room.members.values()) {
    seat.input = {};
    seat.inputAt = 0;
  }
  persist(room);
  announce(room);
  frame(room);
}

function sameOrigin(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (process.env.PUBLIC_ORIGIN) return origin === process.env.PUBLIC_ORIGIN;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json; charset=utf-8' };
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (path === '/health' && req.method === 'GET') return json(res, 200, { status: 'ok', service: 'burrow-brigade' });
  if (path === '/api/profile' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Origin mismatch' });
    try {
      let length = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 48000) {
          json(res, 413, { error: 'Sync request too large' });
          return;
        }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const id = identity(body?.token);
      if (!id || !Array.isArray(body?.rewards) || body.rewards.length > 150) return json(res, 400, { error: 'Invalid profile sync' });
      const rewards: Reward[] = [];
      for (const value of body.rewards) {
        const reward = parseReward(value);
        if (!reward || !reward.id.startsWith('local-')) return json(res, 400, { error: 'Invalid offline reward' });
        rewards.push(reward);
      }
      return json(res, 200, { profile: transact(() => award(id, rewards)) });
    } catch {
      return json(res, 400, { error: 'Invalid profile sync' });
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
  const file = path === '/' ? 'index.html' : path.slice(1);
  if (!/^[a-z\d._-]+$/i.test(file) || file.startsWith('.')) return json(res, 404, { error: 'Page not found' });
  const asset = resolve(root, file);
  try {
    const stats = statSync(asset);
    if (!stats.isFile() || !mime[extname(asset)]) return json(res, 404, { error: 'Page not found' });
    res.writeHead(200, { 'Content-Type': mime[extname(asset)], 'Content-Length': stats.size, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(asset);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch {
    json(res, 404, { error: 'Page not found' });
  }
});

const sockets = new WebSocketServer({
  noServer: true,
  maxPayload: 8192,
  perMessageDeflate: {
    serverNoContextTakeover: true,
    clientNoContextTakeover: true,
    threshold: 512,
    zlibDeflateOptions: { level: 1 }
  }
});
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/rooms' || !sameOrigin(req)) return socket.destroy();
  sockets.handleUpgrade(req, socket, head, ws => sockets.emit('connection', ws));
});
sockets.on('connection', (ws: WebSocket) => {
  let room: Room | undefined;
  let seat: LiveSeat | undefined;
  let burst = 0;
  let period = Date.now();
  let heartbeat = true;
  const enterTimeout = setTimeout(() => { if (!seat) ws.close(1008, 'Join timed out'); }, 8000);
  const ping = setInterval(() => {
    if (!heartbeat) return ws.terminate();
    heartbeat = false;
    ws.ping();
  }, 15000);
  ws.on('pong', () => { heartbeat = true; });
  ws.on('error', () => ws.terminate());
  const error = (message: string, fatal = false) => send(ws, { type: 'error', message, fatal });
  ws.on('message', (buffer, binary) => {
    const now = Date.now();
    if (now - period > 1000) { burst = 0; period = now; }
    if (++burst > 100 || binary) return ws.close(1008, 'Message limit');
    let packet: Record<string, unknown>;
    try { packet = JSON.parse(buffer.toString()); } catch { return error('Invalid room message.'); }
    if (!packet || typeof packet !== 'object') return error('Invalid room message.');
    if (packet.type === 'enter' && !seat) {
      const auth = identity(packet.token);
      if (!auth) return error('Invalid browser profile.', true);
      const code = typeof packet.code === 'string' ? packet.code.trim().toUpperCase() : '';
      if (code && !/^[A-HJ-NP-Z2-9]{8}$/.test(code)) return error('Enter an eight-character room code.', true);
      const target = code ? getRoom(code) : undefined;
      if (code && !target) return error('Room expired or unavailable.', true);
      if (!code && rooms.size >= 100) return error('The room limit is full. Try again shortly.', true);
      room = target ?? { code: makeCode(), host: '', seats: 4, settings: cleanSettings(packet.settings), members: new Map(), lastActive: now, matchId: randomUUID() };
      const existing = room.members.get(auth);
      const maximum = room.settings.mode === 'arena' && !room.settings.teams ? room.seats : 4;
      if (!existing && (room.state || room.members.size >= maximum)) return error('This room is full or already playing.', true);
      if (!existing && (room.resume || room.continuation)) return error('This campaign belongs to the players who started it.', true);
      if (existing) {
        existing.ws?.close(4001, 'Profile opened this room elsewhere');
        seat = existing;
      } else {
        const name = typeof packet.name === 'string' ? packet.name.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 20) : '';
        const id = randomUUID().slice(0, 8);
        seat = { auth, member: { id, name: name || 'Burrower', critter: 'hare', gadget: 'standard', ready: false, connected: true },
          expires: 0, joined: now, input: {}, inputAt: 0, connectedAt: now, seq: 0 };
        room.members.set(auth, seat);
        if (!room.host) room.host = id;
      }
      seat.ws = ws;
      seat.member.connected = true;
      seat.connectedAt = now;
      seat.seq = 0;
      seat.input = {};
      seat.inputAt = 0;
      rooms.set(room.code, room);
      persist(room);
      send(ws, { type: 'entered', id: seat.member.id });
      send(ws, { type: 'profile', profile: profileFor(auth) });
      announce(room);
      frame(room, seat);
      return;
    }
    if (!room || !seat || seat.ws !== ws) return error('Join a room first.');
    const isHost = room.host === seat.member.id;
    switch (packet.type) {
      case 'setup': {
        if (!isHost || room.state || room.resume || room.continuation) return error('Only the host can configure an unused lobby.');
        const settings = cleanSettings(packet.settings);
        if (!permitted(settings, seat)) return error(challengeLocked);
        const count = [2, 3, 4].includes(Number(packet.seats)) ? Number(packet.seats) : 4;
        if (settings.mode === 'arena' && !settings.teams && count < room.members.size) return error('Choose enough arena seats for everyone in the room.');
        room.settings = settings;
        room.seats = count;
        for (const item of room.members.values()) item.member.ready = false;
        persist(room);
        announce(room);
        break;
      }
      case 'loadout': {
        if (room.state || room.continuation) return;
        const pick = cleanSeat(seat.member.id, packet.critter, packet.gadget);
        const level = levelFor(profileFor(seat.auth).xp);
        if (room.settings.mode !== 'arena' && (CRITTERS[pick.critter].unlock > level || GADGETS[pick.gadget].unlock > level)) return error('That loadout is locked for this profile.');
        Object.assign(seat.member, { critter: pick.critter, gadget: pick.gadget, ready: false });
        persist(room);
        announce(room);
        break;
      }
      case 'ready':
        if (!room.state && !room.continuation && typeof packet.ready === 'boolean') {
          seat.member.ready = packet.ready;
          announce(room);
        }
        break;
      case 'start':
      case 'retry': {
        if (!isHost) return error('Only the host can start the mission.');
        if (packet.type === 'retry' && room.state?.status !== 'failed') return error('The mission can only be retried after a wipe.');
        const result = startMatch(room, packet.type === 'retry');
        if (result) error(result);
        break;
      }
      case 'lobby':
        if (!isHost || (!room.continuation && room.state?.status !== 'cleared' && room.state?.status !== 'failed')) {
          return error('Return to the lobby after the match ends.');
        }
        room.state = undefined;
        room.resume = undefined;
        room.continuation = undefined;
        for (const item of room.members.values()) item.member.ready = false;
        persist(room);
        announce(room);
        break;
      case 'input': {
        if (!room.state || !Number.isSafeInteger(packet.seq) || Number(packet.seq) <= seat.seq || Number(packet.seq) > seat.seq + 300) return;
        const { direction, alternate, turn } = packet;
        if ([direction, alternate, turn].some(value => value !== undefined && (typeof value !== 'string' || !Object.hasOwn(DIRECTIONS, value)))) {
          return error('Invalid movement input.');
        }
        if (packet.bomb !== undefined && typeof packet.bomb !== 'boolean') return error('Invalid bomb input.');
        seat.input = { direction: direction as Direction | undefined, alternate: alternate as Direction | undefined,
          turn: (turn as Direction | undefined) ?? seat.input.turn, bomb: seat.input.bomb || packet.bomb === true };
        seat.inputAt = now;
        seat.seq = Number(packet.seq);
        break;
      }
      case 'ping':
        if (typeof packet.time === 'number' && Number.isFinite(packet.time)) send(ws, { type: 'pong', time: packet.time });
        break;
      case 'leave':
        seat.expires = now - 1;
        seat.ws = undefined;
        seat.member.connected = false;
        ws.close(1000, 'Left room');
        if (room.members.size === 1) {
          rooms.delete(room.code);
          deleteRoom.run(room.code);
        }
        break;
      default: error('Unknown room action.');
    }
  });
  ws.on('close', () => {
    clearTimeout(enterTimeout);
    clearInterval(ping);
    if (!room || !seat || seat.ws !== ws) return;
    seat.ws = undefined;
    seat.input = {};
    seat.expires = Date.now() + GRACE;
    seat.member.connected = false;
    announce(room);
  });
});

const step = 1000 / TICK_RATE;
let deadline = performance.now() + step;
const interval = setInterval(() => {
  const time = performance.now();
  for (let i = 0; time >= deadline && i < 5; i++, deadline += step) {
    const now = Date.now();
    for (const room of rooms.values()) updateRoom(room, now);
  }
  if (time - deadline > step * 10) deadline = time + step;
}, 8);
const cleanup = setInterval(() => db.prepare('DELETE FROM rooms WHERE saved <= ?').run(Date.now() - 86400000), 3600000);
cleanup.unref();
server.listen(port, host, () => {
  const bound = server.address();
  console.log('Blastburrow listening on http://' + host + ':' + (bound && typeof bound !== 'string' ? bound.port : port));
});
function shutdown() {
  clearInterval(interval);
  clearInterval(cleanup);
  for (const ws of sockets.clients) ws.terminate();
  server.close(() => { db.close(); process.exit(0); });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
