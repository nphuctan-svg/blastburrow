import { ARENA_TEAMS, CAMPAIGN, CRITTERS, GADGETS, REGIONS, ROOT_LANCE_BONUS, TICK_RATE, bombFuseFor, campaignEntry, expeditionFor, levelFor, missionFor, regionFor,
  type Critter, type Gadget, type Mode } from './content.js';
import { DEFAULT_SETTINGS, VISUAL_CUE_TICKS, addArenaBots, capacityFor, createGame, exitOpen, passable, playerPosition, steerPlayer, tickGame,
  type BufferedTurn, type Direction, type Input, type Player, type PlayerMove, type Point, type Seat, type Settings, type State } from './engine.js';
import { avatarFor, gadgetArtFor, makeRenderer } from './art.js';
import { rootwarrenLesson } from './rootwarren.js';
import { createAudio } from './audio.js';
import { touchInput } from './touch.js';
import { commitClear, getCheckpoint, getControls, getOptions, getSlot, profileOf, randomKey, saveCheckpoint, saveControls, saveOptions, saveSlot,
  syncProfile, type Save, type Slot } from './storage.js';
import type { ClientMessage, Lobby, ServerMessage } from './protocol.js';
import type { Reward } from './profile.js';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const icon = (name: string) => '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
const esc = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const field = (label: string, input: string) => '<label class="field">' + label + input + '</label>';
const button = (id: string, label: string, style = 'secondary', disabled = false) =>
  '<button class="' + style + '" id="' + id + '"' + (disabled ? ' disabled' : '') + '>' + label + '</button>';
const listen = (id: string, fn: () => void) => el(id)?.addEventListener('click', fn);
const entries = Object.entries;
const value = (id: string) => el<HTMLInputElement>(id).value;
const options = (id: string, items: [string, string][], active: string) =>
  '<select id="' + id + '">' + items.map(([key, title]) => '<option value="' + key + '"' + (active === key ? ' selected' : '') + '>' + esc(title) + '</option>').join('') + '</select>';
const quantum = 1000 / TICK_RATE;
const inputEdgeInterval = 1000 / (TICK_RATE * 2);
const remoteBufferTicks = 1;
const correctionMs = 80;
const sameTile = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const formatClock = (ticks: number) => {
  const seconds = Math.max(0, Math.ceil(ticks / TICK_RATE));
  return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
};

const canvas = el<HTMLCanvasElement>('board');
const startButton = el<HTMLButtonElement>('start-btn');
const pauseButton = el<HTMLButtonElement>('pause-button');
const dialog = el<HTMLDialogElement>('dialog');
const touchControls = el('touch-controls');
const coarsePointer = matchMedia('(any-pointer: coarse)');
const render = makeRenderer(canvas);
const audio = createAudio();
type Action = Direction | 'bomb';
type Bindings = Record<Action, string>;
interface PredictedStep {
  move: PlayerMove; started: number; seq: number; expectedTick: number; confirmed: boolean;
}
const predictionTick = (prediction: PredictedStep, now: number) =>
  prediction.move.step.started + (now - prediction.started) / quantum;
interface PlayerFrame { tick: number; players: Player[] }
type Menu = 'online' | 'map' | 'loadout' | 'controls' | 'arena' | 'journal';

const defaultControls: Bindings[] = [
  { up: 'KeyW', left: 'KeyA', down: 'KeyS', right: 'KeyD', bomb: 'Space' },
  { up: 'ArrowUp', left: 'ArrowLeft', down: 'ArrowDown', right: 'ArrowRight', bomb: 'Enter' }
];
const actionLabels: Record<Action, string> = { up: 'Up', down: 'Down', left: 'Left', right: 'Right', bomb: 'Bomb' };
const keyLabel = (key: string) => ({ ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space',
  ShiftLeft: 'L Shift', ShiftRight: 'R Shift', Enter: 'Enter' })[key] ?? key.replace(/^Key|^Digit/, '');

const [firstSlot, secondSlot, storedControls, storedOptions, storedSave] = await Promise.all([
  getSlot(0), getSlot(1), getControls<Bindings[]>(), getOptions<{ arena: Partial<Settings>; total: number }>(), getCheckpoint()
]);
const slots = [firstSlot, secondSlot];
let bindings = storedControls ?? structuredClone(defaultControls);
let arenaOptions = { ...DEFAULT_SETTINGS, ...storedOptions?.arena, mode: 'arena' as const };
let arenaTotal = storedOptions?.total ?? 4;
let saved = storedSave ?? null;
const nextMission = CAMPAIGN.findIndex(mission => !profileOf(firstSlot).cleared.includes(mission.id));
let settings: Settings = saved?.settings ?? {
  ...DEFAULT_SETTINGS,
  missionId: CAMPAIGN[nextMission]?.id ?? DEFAULT_SETTINGS.missionId,
  seed: nextMission >= 0 ? 117 + nextMission * 109 : DEFAULT_SETTINGS.seed
};
let party = saved?.party ?? 1;
let runId = '';
let local = false;
let paused = false;
let state = createGame(settings, localSeats());
let dialogKind: Menu | null = null;
let loadoutSlot = 0;
let rebind: { player: number; action: Action } | null = null;
const keys = new Set<string>();
const directions = ['up', 'left', 'down', 'right'] as const;
let tapped: (Direction | undefined)[] = [];
let fired = [false, false];
let toastTimeout = 0;
let soundEvent = 0;
let refreshed = '';
let lastHud = '';
let lastOnlineId = '';
let pendingResult = false;
let accumulator = 0;
let finishedAt: number | undefined;
let playerVisuals = new Map<string, Point>();
let network: {
  ws?: WebSocket; resolvingRoute?: boolean; lobby?: Lobby; id?: string; code: string; name: string; seq: number;
  retryAt: number; expires: number; lastInput: number; lastEdge: number; intent: boolean; note: string; ping: number;
  received: number; renderTick: number; frames: PlayerFrame[]; predicted?: PredictedStep;
  correction?: { offset: Point; started: number };
  steering?: { seq: number; bufferedTurn?: BufferedTurn };
} = { code: '', name: '', seq: 0, expires: 0, retryAt: 0, lastInput: 0, lastEdge: 0, intent: false, note: '', ping: 0, received: 0, renderTick: 0, frames: [] };

function notice(message: string) {
  const box = el('toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => { box.hidden = true; }, 3600);
}
function localSeats() {
  const seats: Seat[] = slots.slice(0, party).map((slot, i) => {
    const arena = settings.mode === 'arena';
    const level = levelFor(profileOf(slot).xp);
    return { id: 'p' + (i + 1), critter: arena || CRITTERS[slot.critter].unlock <= level ? slot.critter : 'hare',
      gadget: arena || GADGETS[slot.gadget].unlock <= level ? slot.gadget : 'standard' };
  });
  return settings.mode === 'arena' ? addArenaBots(seats, settings.teams ? 4 : arenaTotal) : seats;
}
const playingOnline = () => network.lobby?.phase === 'match';
const lobbyHost = () => network.lobby?.host === network.id;
const controlled = () => network.id && network.lobby?.phase !== 'lobby' ? [network.id] : party === 2 ? ['p1', 'p2'] : ['p1'];
const active = () => local || Boolean(network.lobby && network.lobby.phase !== 'lobby');
const inProgress = () => state.status === 'playing' || state.status === 'between';
const acceptGameInput = () => active() && !paused && !dialog.open && !document.hidden && state.status === 'playing';
const onlineInputChanged = () => {
  if (playingOnline()) stepNetwork(performance.now(), true);
};
const touch = touchInput(el('touch-pad'), el<HTMLButtonElement>('touch-bomb'), acceptGameInput,
  direction => { tapped[0] = direction; }, () => { fired[0] = true; }, onlineInputChanged);
const clearInputs = () => {
  keys.clear();
  touch.clear();
  tapped = [];
  fired = [false, false];
  if (local) for (const player of state.players) {
    player.bufferedTurn = undefined;
    player.bufferedBomb = undefined;
  }
};
function resetPreview() {
  local = false;
  paused = false;
  accumulator = 0;
  finishedAt = undefined;
  soundEvent = 0;
  clearInputs();
  state = createGame(settings, localSeats());
  refresh(true);
}
function updateMode(mode: Mode) {
  if (network.lobby) return showMenu('online');
  if (local && inProgress()) {
    notice('Use Save & leave in the pause menu to switch modes.');
    return;
  }
  if (mode === 'arena') settings = { ...arenaOptions };
  else if (mode === 'expedition') settings = { ...DEFAULT_SETTINGS, mode, ...expeditionFor(Date.now()) };
  else {
    const current = settings.mode === 'adventure' || settings.mode === 'challenge' ? settings.missionId : DEFAULT_SETTINGS.missionId;
    settings = { ...DEFAULT_SETTINGS, mode, missionId: current };
  }
  resetPreview();
}
function selectMission(id: string, mode: Mode = 'adventure') {
  if (active() && inProgress()) return notice('Pause and leave the current mission first.');
  const entry = campaignEntry(id);
  if (network.lobby || !entry || mode === 'challenge' && !profileOf(firstSlot).cleared.includes(id)) return;
  settings = { ...DEFAULT_SETTINGS, mode, ...entry };
  resetPreview();
  if (dialog.open) dialog.close();
}
function recordCheckpoint() {
  if (state.settings.mode === 'arena') return;
  saved = { settings: state.settings, checkpoint: state.checkpoint, runId, party, slots: slots.slice(0, party).map(slot => slot.id) };
  void saveCheckpoint(saved).catch(() => notice('Could not save the checkpoint.'));
}
function beginLocal(resume?: Save) {
  if (network.lobby) return showMenu('online');
  const mission = resume?.settings ?? settings;
  if (mission.mode === 'challenge' && !profileOf(firstSlot).cleared.includes(mission.missionId)) return notice('Clear this mission to unlock its score challenge.');
  if (resume) {
    settings = resume.settings;
    party = resume.party;
  }
  runId = resume?.runId ?? randomKey();
  local = true;
  paused = false;
  accumulator = 0;
  finishedAt = undefined;
  soundEvent = 0;
  clearInputs();
  state = createGame(settings, localSeats(), resume?.checkpoint);
  recordCheckpoint();
  el('board-frame').focus({ preventScroll: true });
  refresh(true);
}
async function recordResult() {
  const mode = state.settings.mode;
  if (mode === 'arena' || state.status !== 'cleared') return;
  const reward: Reward = { id: 'local-' + runId, mode, missionId: state.settings.missionId, discoveries: state.discoveries,
    score: state.score, seed: state.settings.seed };
  pendingResult = true;
  try {
    if (profileSync) await profileSync;
    await commitClear(slots.slice(0, party), reward);
    saved = null;
    if (navigator.onLine) void syncAll();
  } catch {
    notice('Progress is in memory. The browser could not write the save.');
  } finally {
    pendingResult = false;
    refresh(true);
  }
}
let profileSync: Promise<void> | undefined;
function syncAll(): Promise<void> {
  if (profileSync) return profileSync;
  profileSync = Promise.all(slots.map(syncProfile)).then(() => refresh(true)).finally(() => { profileSync = undefined; });
  return profileSync;
}

function nextMissionMessage(next: NonNullable<Lobby['nextMission']>) {
  const name = missionFor(next.missionId).name;
  return next.waitingForParty ? 'Waiting for the party to reconnect before starting ' + name + '.' : 'Starting ' + name + ' shortly.';
}

function arenaTeamHud(players: Player[], yours: string[]) {
  return ARENA_TEAMS.map((team, index) => {
    const members = players.filter(player => player.team === index);
    const seat = yours.findIndex(id => members.some(player => player.id === id));
    const label = !yours.length ? team.name : seat < 0 ? 'Rivals' : yours.length === 1 ? 'You' : 'P' + (seat + 1);
    const alive = members.filter(player => player.hp > 0).length;
    const side = seat < 0 ? '' : yours.length === 1 ? 'your team, ' : 'player ' + (seat + 1) + ', ';
    const description = team.name + ' team, ' + side
      + alive + ' of ' + members.length + ' still in the round';
    return '<span class="team-stat" role="img" aria-label="' + description + '" title="' + description + '"><span class="team-pips" aria-hidden="true" style="color:'
      + team.color + '">' + members.map(player => '<span class="team-pip ' + team.shape + (player.hp > 0 ? '' : ' out') + '"></span>').join('')
      + '</span><span aria-hidden="true">' + label + '</span></span>';
  }).join('');
}

function overlay(showingDefeat: boolean) {
  const target = el('board-overlay');
  if (!active() || showingDefeat || !paused && state.status === 'playing' && !(network.lobby && network.note)) {
    target.hidden = true;
    return;
  }
  let heading = '';
  let description = '';
  let actions = '';
  if (network.lobby && network.note && state.status === 'playing') {
    heading = 'Reconnecting';
    description = network.note;
    actions = button('overlay-leave', 'Leave room');
  } else if (paused) {
    heading = 'Mission paused';
    description = state.settings.mode === 'arena' ? 'Ready for another round?' : 'You can resume from the start of this chamber.';
    actions = button('overlay-resume', 'Resume', 'primary') + button('overlay-leave', state.settings.mode === 'arena' ? 'Leave arena' : 'Save &amp; leave');
  } else if (state.status === 'between') {
    const winner = state.players.find(player => player.team === state.winner);
    heading = state.winner === null ? 'Round drawn' : state.settings.teams ? ARENA_TEAMS[state.winner].name + ' team wins the round' : CRITTERS[winner?.critter ?? 'hare'].name + ' wins the round';
    description = 'The next round starts in a moment.';
  } else if (state.settings.mode === 'arena') {
    const winner = state.players.find(player => player.team === state.winner);
    heading = state.winner === null ? 'Match drawn' : state.settings.teams ? ARENA_TEAMS[state.winner].name + ' team wins' : CRITTERS[winner?.critter ?? 'hare'].name + ' wins';
    description = 'Rounds played · ' + state.round;
    actions = network.lobby ? button('overlay-room', 'Room', 'primary') : button('overlay-retry', 'Rematch', 'primary') + button('overlay-leave', 'Leave arena');
  } else if (state.status === 'failed') {
    heading = state.tick >= state.limit ? 'Time ran out' : 'Party wiped';
    description = 'Retry from the start of chamber ' + (state.stage + 1) + '.';
    actions = button('overlay-retry', 'Retry checkpoint', 'primary', Boolean(network.lobby && !lobbyHost()))
      + button(network.lobby ? 'overlay-room' : 'overlay-leave', network.lobby ? 'Room' : 'Save &amp; leave');
  } else {
    const finale = state.settings.mode === 'adventure' && state.settings.missionId === CAMPAIGN.at(-1)?.id;
    heading = finale ? 'The burrows are safe!' : 'Mission cleared!';
    const relics = state.discoveries.length;
    description = (finale ? 'The Kilnkeeper has fallen. ' : '') + state.score.toLocaleString() + ' points' + (relics ? ' · ' + relics + (relics === 1 ? ' discovery' : ' discoveries') : '');
    const next = campaignEntry(state.settings.missionId, 1);
    if (network.lobby?.nextMission) description += '. ' + nextMissionMessage(network.lobby.nextMission);
    actions = network.lobby ? button('overlay-room', 'Room', 'primary')
      : (next && settings.mode === 'adventure' ? button('overlay-next', 'Next mission', 'primary', pendingResult) : '') + button('overlay-leave', 'Back to trail');
  }
  target.hidden = false;
  target.innerHTML = '<div class="overlay-inner"><h2>' + esc(heading) + '</h2><p>' + esc(description) + '</p><div class="overlay-actions">' + actions + '</div></div>';
  listen('overlay-resume', togglePause);
  listen('overlay-leave', () => network.lobby ? leaveRoom() : resetPreview());
  listen('overlay-room', () => showMenu('online'));
  listen('overlay-retry', () => network.lobby ? send({ type: 'retry' }) : beginLocal(state.status === 'failed' ? saved ?? undefined : undefined));
  listen('overlay-next', () => {
    const next = campaignEntry(settings.missionId, 1);
    if (next) selectMission(next.missionId);
  });
}
const challengeMode = () => state.settings.mode === 'challenge' || state.settings.mode === 'expedition';
function refresh(force = false) {
  const displayed = state.settings;
  const mission = missionFor(displayed.missionId);
  const region = displayed.mode === 'arena' ? REGIONS.find(item => item.id === displayed.arena) ?? REGIONS[0] : regionFor(mission.id);
  const profile = profileOf(firstSlot);
  const yours = controlled();
  const currentPlayer = state.players.find(player => player.id === yours[0]);
  const otherPlayer = party === 2 && !network.lobby ? state.players.find(player => player.id === 'p2') : undefined;
  const match = displayed.mode === 'arena';
  const teamArena = match && displayed.teams;
  const online = network.lobby;
  const captured = state.targets.filter(target => target.done).length;
  const boss = state.enemies.find(enemy => enemy.kind === 'boss');
  const hearts = (name: string, hp: number, color = '') => '<span class="hearts"' + (color ? ' style="color:' + color + '"' : '')
    + ' aria-label="' + name + ', ' + hp + (hp === 1 ? ' heart' : ' hearts') + '">'
    + (hp === 0 ? '♡' : '♥'.repeat(hp)) + '</span>';
  const hud = teamArena ? arenaTeamHud(state.players, active() ? yours : [])
    : match ? state.players.map(player => '<span style="color:' + CRITTERS[player.critter].color + '">' + (player.hp ? '◆' : '◇') + '</span>').join('')
    : hearts('Player one', currentPlayer?.hp ?? 0) + (otherPlayer ? hearts('Player two', otherPlayer.hp, '#cbb1e2') : '');
  const hudMarkup = hud + '<span class="hud-divider"></span><span id="hud-clock">' + formatClock(state.limit - state.tick) + '</span>';
  if (hudMarkup !== lastHud) {
    el('board-stats').innerHTML = hudMarkup;
    lastHud = hudMarkup;
  }
  const open = exitOpen(state);
  const lesson = rootwarrenLesson(displayed.mode, displayed.missionId, state.stage);
  const showingDefeat = active() && state.status !== 'playing' && visibleCues().some(cue => cue.kind === 'knockout' || cue.kind === 'enemy-defeat');
  const signature = JSON.stringify([displayed, state.stage, state.round, captured, open, state.status, boss?.hp, currentPlayer?.hp, currentPlayer?.capacity, currentPlayer?.range, currentPlayer?.speed, currentPlayer?.gadget,
    party, paused, local, profile, firstSlot.critter, firstSlot.gadget, online?.phase, online?.code, online?.members.length, network.note, state.winner, state.wins, (challengeMode() ? state.score : 0), bindings, saved?.runId, pendingResult, showingDefeat]);
  if (!force && signature === refreshed) return;
  refreshed = signature;
  const inGame = active() && inProgress();
  const playLayout = inGame || showingDefeat;
  document.body.classList.toggle('touch-playing', playLayout);
  // Reserve the side columns on phones in landscape until the knockout finishes.
  touchControls.style.visibility = playLayout && !inGame ? 'hidden' : '';
  if (touchControls.hidden === playLayout) {
    touchControls.hidden = !playLayout;
    if (inGame && coarsePointer.matches && (window.scrollX || window.scrollY)) window.scrollTo(0, 0);
  }
  if (!inGame) touch.clear();
  const expedition = displayed.mode === 'expedition';
  const challenge = displayed.mode === 'challenge';
  el('mission-title').textContent = match ? region.name + ' Arena' : expedition ? 'The Weekly Expedition' : mission.name;
  el('eyebrow').textContent = match ? 'Battle arena' : expedition ? 'Expeditions' : challenge ? 'Score challenge' : region.name;
  el('area').textContent = match ? region.name : expedition ? mission.name : region.area;
  el('mission-subtitle').textContent = match ? (displayed.teams ? 'Two teams. Survive the blast and win two rounds.' : 'Outlast the other critters and win two rounds.') : lesson?.briefing ?? mission.briefing;
  el('hero-emblem').setAttribute('href', '#i-' + (match ? 'cross' : expedition ? 'compass' : 'sprout'));
  for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
    const selected = tab.dataset.mode === (challenge ? 'adventure' : displayed.mode);
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-pressed', String(selected));
  }
  for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-count]')) {
    tab.classList.toggle('selected', Number(tab.dataset.count) === party && !playingOnline());
    tab.setAttribute('aria-pressed', String(tab.classList.contains('selected')));
    tab.disabled = Boolean(active() && inProgress() || online);
  }
  el('local-party').hidden = Boolean(online);
  el('online-party').hidden = !online;
  if (online) el('online-party').innerHTML = icon('users') + ' ' + online.members.length + (online.members.length === 1 ? ' player' : ' players') + ' · Online';
  const onlineLabel = online ? 'Room ' + online.code : 'Play Online';
  el('online-button').setAttribute('aria-label', onlineLabel);
  el('online-button').innerHTML = '<span class="presence"></span>' + icon('users') + '<span>' + esc(onlineLabel) + '</span>';
  el('chamber-label').textContent = match ? 'Round ' + state.round : 'Chamber ' + (state.stage + 1) + ' of ' + state.stages;
  pauseButton.disabled = !local || state.status !== 'playing';
  const finishing = showingDefeat && !inGame;
  startButton.disabled = finishing || !online && local && state.status === 'between';
  const footerLabel = online ? 'Room lobby' : local && state.status === 'between' ? 'Next round' : local && (state.status === 'playing' || finishing) ? paused ? 'Resume' : 'Pause' : local && state.status === 'failed' ? 'Retry checkpoint'
    : local && state.status === 'cleared' ? match ? 'Rematch' : 'Back to trail' : match ? 'Start match' : expedition ? 'Start expedition' : 'Start mission';
  startButton.innerHTML = icon(footerLabel === 'Pause' ? 'pause' : 'play') + '<span>' + footerLabel + '</span>';
  const controls = bindings[0];
  el('game-controls').innerHTML = icon('keys') + [controls.up, controls.left, controls.down, controls.right].map(key => '<kbd>' + esc(keyLabel(key)) + '</kbd>').join('')
    + '<span class="key-label">Move</span><kbd>' + esc(keyLabel(controls.bomb)) + '</kbd><span class="key-label">Bomb</span>'
    + '<button class="text-btn" id="controls-button">' + (party === 2 ? 'P2 &amp; controls' : 'Controls') + '</button>';
  listen('controls-button', () => showMenu('controls'));

  el('objective-kicker').textContent = match ? (displayed.teams ? 'Team battle' : 'Free-for-all')
    : lesson?.title ?? (mission.objective === 'boss' ? 'Boss mission' : mission.objective[0].toUpperCase() + mission.objective.slice(1) + ' mission');
  const row = (label: string, data: string, muted = false) => '<div class="objective-row"><span>' + label + '</span><b' + (muted ? ' class="muted"' : '') + '>' + data + '</b></div>';
  const kitObjective = mission.objective === 'rescue';
  const main = boss ? row('Boss health', boss.hp + ' / ' + boss.maxHp)
    : lesson?.kind === 'lure' ? row('Blast the moth', open ? 'Cleared' : 'Active')
    : lesson?.kind === 'chain' ? row('Open the root gate', open ? 'Open' : 'Sealed', !open)
    : state.targets.length ? row(kitObjective ? (state.targets.length === 1 ? 'Rescue the kit' : 'Rescue the kits') : 'Activate the relays', captured + ' / ' + state.targets.length) : '';
  const bots = state.players.filter(player => player.bot).length;
  el('objective-content').innerHTML = match
    ? row('Rounds to win', '2') + (teamArena ? row('Bots', String(bots)) : row('Opponents', bots + ' bots'))
    : main + row('Reach the burrow exit', open ? 'Open' : 'Locked', !open);
  if (challengeMode()) el('objective-content').insertAdjacentHTML('beforeend', row('Score', state.score.toLocaleString()));
  if (state.carving && !state.discoveries.some(id => id.startsWith(region.id + ':'))) {
    el('objective-content').insertAdjacentHTML('beforeend', row('A relic carving is nearby', '✦'));
  }
  if (active() && currentPlayer && currentPlayer.hp === 0 && inProgress() && currentPlayer.team !== state.winner) {
    el('objective-content').insertAdjacentHTML('beforeend', row('You’re down', match ? 'Next round' : 'Next chamber', true));
  }
  if (active() && currentPlayer) el('objective-content').insertAdjacentHTML('beforeend',
    row('Bombs · range · speed', capacityFor(currentPlayer) + ' · ' + currentPlayer.range + ' · ' + (1 + currentPlayer.speed)));
  el('route-heading').textContent = match ? 'Arena rules' : expedition ? 'Expedition route' : 'Burrow trail';
  el('route-kicker').textContent = match ? region.name : expedition ? region.name + ' · weekly seed' : region.name;
  el('map-button').innerHTML = (match ? 'Customize' : 'World map') + ' ' + icon('chevron');
  if (match) {
    const standings = active() ? state.players.filter((player, i) => state.players.findIndex(other => other.team === player.team) === i)
      .map(player => row(teamArena ? ARENA_TEAMS[player.team].name + ' team' : CRITTERS[player.critter].name, state.wins[player.team] + ' rounds')).join('') : '';
    el('route-content').innerHTML = standings + row('Bot difficulty', displayed.difficulty) + row('Crates', displayed.crates) + row('Fuse speed', displayed.fuse);
  } else if (expedition) {
    el('route-content').innerHTML = '<p class="objective-detail">' + esc(region.mechanic) + '</p>'
      + row('Seed', String(displayed.seed)) + row('Personal best', String(profile.scores['expedition:' + displayed.seed] ?? '—'));
  } else {
    el('route-content').innerHTML = '<div class="trail">' + region.missions.map((item, i) => {
      const cleared = profile.cleared.includes(item.id);
      return '<button class="trail-step' + (item.id === mission.id ? ' current' : '') + '" data-mission="' + item.id + '"'
        + (active() && inProgress() || online ? ' disabled' : '') + '><span class="trail-index">0' + (i + 1)
        + '</span><span class="trail-name">' + esc(item.name) + '</span>' + icon(cleared ? 'check' : 'chevron') + '</button>';
    }).join('') + '</div>';
    for (const item of document.querySelectorAll<HTMLButtonElement>('.trail-step')) item.onclick = () => selectMission(item.dataset.mission!);
    if (saved && !active() && !online && saved.settings.missionId === mission.id) {
      el('route-content').insertAdjacentHTML('beforeend', button('resume-save', 'Resume chamber ' + (saved.checkpoint.stage + 1), 'text-btn'));
      listen('resume-save', () => { if (saved) beginLocal(saved); });
    }
  }
  const level = levelFor(profile.xp);
  const xp = level === 20 ? 100 : profile.xp % 100;
  const equippedGadget = currentPlayer?.gadget ?? firstSlot.gadget;
  el('profile-content').innerHTML = '<img class="avatar" alt="" src="' + avatarFor(firstSlot.critter) + '"><div><div class="profile-name">'
    + CRITTERS[firstSlot.critter].name + '</div><div class="profile-meta">Level ' + level + ' · '
    + '<span class="equipped-gadget"><img alt="" src="' + gadgetArtFor(equippedGadget).icon + '">' + GADGETS[equippedGadget].name + '</span></div></div>'
    + '<button class="icon-button" id="loadout" title="Loadout" aria-label="Loadout">' + icon('settings') + '</button>';
  listen('loadout', () => { loadoutSlot = 0; showMenu('loadout'); });
  el('xp-fill').style.width = xp + '%';
  el('xp-track').setAttribute('aria-valuenow', String(xp));
  el('xp-label').textContent = level === 20 ? 'Max level · ' + profile.xp + ' XP' : xp + ' / 100 XP';
  el('tip-line').lastElementChild!.textContent = lesson?.hint ?? region.mechanic;
  overlay(showingDefeat);
}

function togglePause() {
  if (!local || state.status !== 'playing') return;
  paused = !paused;
  clearInputs();
  if (!paused) el('board-frame').focus({ preventScroll: true });
  refresh(true);
}
function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else if (document.fullscreenEnabled) void el('board-frame').requestFullscreen().catch(() => notice('Fullscreen is unavailable.'));
}
function showMenu(which: Menu) {
  dialogKind = which;
  clearInputs();
  paintMenu();
  if (!dialog.open) dialog.showModal();
}
function menu(title: string, html: string) {
  el('dialog-title').textContent = title;
  el('dialog-content').innerHTML = html;
}

function gadgetCard(id: Gadget, pick: Gadget, level: number, arena: boolean, quick: boolean) {
  const gadget = GADGETS[id];
  const locked = !arena && gadget.unlock > level;
  const selected = pick === id && !locked;
  const fuse = (bombFuseFor(id, quick) / TICK_RATE).toFixed(1) + ' s fuse';
  const facts = id === 'shield' ? ['−1 bomb slot', 'At least 1 slot']
    : id === 'directional' ? [fuse, '+' + ROOT_LANCE_BONUS + ' tiles of reach'] : [fuse];
  const status = locked ? 'Level ' + gadget.unlock : selected ? 'Selected' : '';
  return '<button class="option-card gadget-card' + (selected ? ' active' : '') + '" data-gadget="' + id + '" aria-pressed="' + selected + '"'
    + (locked ? ' disabled' : '') + '><img class="gadget-diagram" src="' + gadgetArtFor(id).diagram + '" alt="" width="160" height="54">'
    + '<span class="gadget-title"><strong>' + gadget.name + '</strong>' + (status ? '<span class="gadget-status">' + status + '</span>' : '') + '</span>'
    + '<span class="gadget-effect">' + gadget.detail + '</span><span class="gadget-facts">'
    + facts.map(fact => '<span>' + fact + '</span>').join('') + '</span></button>';
}
function paintMenu() {
  const profile = profileOf(firstSlot);
  if (dialogKind === 'online') return paintOnline();
  if (dialogKind === 'map') {
    menu('World map', '<div class="dialog-grid">' + REGIONS.map(region => {
      const open = region.missions.find(mission => !profile.cleared.includes(mission.id)) ?? region.missions[0];
      return '<button class="option-card' + (region.id === regionFor(settings.missionId).id ? ' active' : '') + '" data-region-mission="' + open.id + '">'
        + '<strong>' + esc(region.name) + '</strong><small>' + esc(region.mechanic)
        + '</small><small>' + region.missions.filter(mission => profile.cleared.includes(mission.id)).length + ' / 4 missions</small></button>';
    }).join('') + '</div>');
    for (const item of dialog.querySelectorAll<HTMLButtonElement>('[data-region-mission]')) item.onclick = () => selectMission(item.dataset.regionMission!);
    return;
  }
  if (dialogKind === 'controls') {
    menu('Keyboard controls', '<p class="dialog-copy">Choose an action, then press a new key. Each action needs its own key.</p><div class="dialog-grid">'
      + bindings.map((set, p) => '<section><h3 class="dialog-section">Player ' + (p + 1) + '</h3>' + entries(set).map(([action, key]) =>
        '<div class="objective-row"><span>' + actionLabels[action as Action] + '</span><button class="secondary" data-key="' + p + ':' + action + '">'
        + (rebind?.player === p && rebind.action === action ? 'Press a key…' : esc(keyLabel(key))) + '</button></div>').join('') + '</section>').join('')
      + '</div><hr class="divider">' + button('reset-keys', 'Reset defaults'));
    for (const item of dialog.querySelectorAll<HTMLButtonElement>('[data-key]')) item.onclick = () => {
      const [player, action] = item.dataset.key!.split(':');
      rebind = { player: Number(player), action: action as Action };
      paintMenu();
    };
    listen('reset-keys', () => {
      bindings = structuredClone(defaultControls);
      rebind = null;
      void saveControls(bindings);
      paintMenu();
      refresh(true);
    });
    return;
  }
  if (dialogKind === 'loadout') {
    const slot = slots[loadoutSlot];
    const rules = network.lobby?.settings ?? (active() ? state.settings : settings);
    const inArena = rules.mode === 'arena';
    const level = levelFor(profileOf(slot).xp);
    const gadget = inArena || GADGETS[slot.gadget].unlock <= level ? slot.gadget : 'standard';
    menu('Loadout', '<p class="dialog-copy">Level ' + level + ' · ' + profileOf(slot).xp + ' XP</p>' + (party === 2 && !network.lobby ? '<div class="dialog-row">' + button('load-one', 'Player 1', loadoutSlot === 0 ? 'primary' : 'secondary')
      + button('load-two', 'Player 2', loadoutSlot === 1 ? 'primary' : 'secondary') + '</div>' : '')
      + '<h3 class="dialog-section gadget-heading">Gadgets</h3>'
      + (active() && inProgress() ? '<p class="gadget-next">Loadout changes apply to the next match or mission.</p>' : '')
      + '<div class="dialog-grid gadget-grid">' + (Object.keys(GADGETS) as Gadget[]).map(id => gadgetCard(id, gadget, level, inArena, rules.fuse === 'quick')).join('')
      + '</div><h3 class="dialog-section">Animals</h3>'
      + '<div class="dialog-grid">' + entries(CRITTERS).map(([id, critter]) =>
        '<button class="option-card critter' + (slot.critter === id ? ' active' : '') + '" data-critter="' + id + '"' + (!inArena && level < critter.unlock ? ' disabled' : '')
        + '><img class="avatar" src="' + avatarFor(id as Critter) + '" alt=""><span><strong>' + critter.name + '</strong><small>'
        + critter.species + (!inArena && level < critter.unlock ? ' · Level ' + critter.unlock : '') + '</small></span></button>').join('')
      + '</div>');
    const choose = () => {
      void saveSlot(slot);
      if (network.lobby?.phase === 'lobby') send({ type: 'loadout', critter: slot.critter, gadget: slot.gadget });
      if (!active()) resetPreview();
      else refresh(true);
      paintMenu();
    };
    listen('load-one', () => { loadoutSlot = 0; paintMenu(); });
    listen('load-two', () => { loadoutSlot = 1; paintMenu(); });
    for (const item of dialog.querySelectorAll<HTMLButtonElement>('[data-critter]')) item.onclick = () => { slot.critter = item.dataset.critter as Critter; choose(); };
    for (const item of dialog.querySelectorAll<HTMLButtonElement>('[data-gadget]')) item.onclick = () => { slot.gadget = item.dataset.gadget as Gadget; choose(); };
    return;
  }
  if (dialogKind === 'journal') {
    menu('Field journal', '<p class="dialog-copy">' + profile.cleared.length + ' / ' + CAMPAIGN.length
      + ' missions cleared · ' + profile.discoveries.length + ' / 12 discoveries</p><div class="dialog-grid">'
      + REGIONS.map(region => '<div class="option-card"><strong>' + region.name + '</strong>'
        + region.discoveries.map((name, i) => '<small>' + (profile.discoveries.includes(region.id + ':' + i) ? '✦ ' + esc(name) : '◇ Undiscovered') + '</small>').join('')
        + '</div>').join('') + '</div><h3 class="dialog-section">Score challenges</h3><div class="trail">'
      + CAMPAIGN.filter(mission => profile.cleared.includes(mission.id)).map(mission =>
        '<button class="trail-step" data-challenge="' + mission.id + '"><span class="trail-name">' + esc(mission.name) + '</span><span>'
        + (profile.scores['challenge:' + mission.id] ?? 'Play') + '</span></button>').join('')
      + (profile.cleared.length ? '' : '<p class="dialog-copy">Clear a mission to unlock its score challenge.</p>') + '</div>');
    for (const item of dialog.querySelectorAll<HTMLButtonElement>('[data-challenge]')) item.onclick = () => selectMission(item.dataset.challenge!, 'challenge');
    return;
  }
  if (dialogKind === 'arena') {
    menu('Arena setup', '<div class="dialog-grid">' + arenaFields(settings, arenaTotal) + '</div><hr class="divider">' + button('save-arena', 'Apply rules', 'primary'));
    listen('save-arena', () => {
      if (active() && inProgress()) return notice('Set rules between matches.');
      arenaOptions = { ...readArena(settings), mode: 'arena' };
      arenaTotal = Number(value('set-total'));
      void saveOptions({ arena: arenaOptions, total: arenaTotal });
      settings = { ...arenaOptions };
      resetPreview();
      dialog.close();
    });
  }
}
function arenaFields(current: Settings, count: number) {
  return field('Arena', options('set-arena', REGIONS.map(region => [region.id, region.name]), current.arena))
    + field('Contestants', options('set-total', [['2', '2'], ['3', '3'], ['4', '4']], String(count)))
    + field('Teams', options('set-teams', [['free', 'Free-for-all'], ['teams', '2v2']], current.teams ? 'teams' : 'free'))
    + field('Bots', options('set-difficulty', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], current.difficulty))
    + field('Crate density', options('set-crates', [['light', 'Light'], ['normal', 'Normal'], ['dense', 'Dense']], current.crates))
    + field('Fuse', options('set-fuse', [['classic', 'Classic'], ['quick', 'Quick']], current.fuse));
}
function readArena(current: Settings): Settings {
  return { ...current, mode: 'arena', arena: value('set-arena') as Settings['arena'], teams: value('set-teams') === 'teams',
    difficulty: value('set-difficulty') as Settings['difficulty'], crates: value('set-crates') as Settings['crates'], fuse: value('set-fuse') as Settings['fuse'] };
}

function send(message: ClientMessage) {
  if (network.ws?.readyState === WebSocket.OPEN) network.ws.send(JSON.stringify(message));
}
async function alternateRoomEndpoint() {
  if (location.protocol !== 'https:') return;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch('/room-connection.json', { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return;
    const { url } = await response.json();
    const endpoint = new URL(url);
    if (endpoint.protocol === 'wss:' && endpoint.href === endpoint.origin + '/rooms') return endpoint.href;
  } catch {
    // The original room address also works when discovery is unavailable.
  } finally {
    window.clearTimeout(timeout);
  }
}
async function connect(code: string, name: string, reconnect = false) {
  if (!navigator.onLine) { notice('Reconnect to the internet to join a room.'); return; }
  if (network.resolvingRoute || network.ws && network.ws.readyState < WebSocket.CLOSING) return;
  network.code = code;
  network.name = name;
  network.intent = true;
  network.note = reconnect ? 'Waiting for the room. Your seat is held for 60 seconds.' : 'Connecting…';
  const attempt = network;
  attempt.resolvingRoute = true;
  if (dialogKind === 'online') paintOnline();
  const fallback = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/rooms';
  const endpoint = await alternateRoomEndpoint();
  if (network !== attempt) return;
  attempt.resolvingRoute = false;
  if (!network.intent) return;
  openRoomSocket(endpoint ?? fallback, fallback, code, name);
}
function openRoomSocket(endpoint: string, fallback: string, code: string, name: string) {
  const ws = new WebSocket(endpoint);
  network.ws = ws;
  let responded = false;
  let firstFrame = true;
  const timeout = endpoint === fallback ? undefined : window.setTimeout(() => ws.close(), 2000);
  ws.onopen = () => {
    if (network.ws !== ws) return;
    network.seq = 0;
    network.predicted = undefined;
    network.correction = undefined;
    network.steering = undefined;
    send({ type: 'enter', code, name, token: firstSlot.token, settings });
  };
  ws.onmessage = event => {
    if (network.ws !== ws) return;
    const message: ServerMessage = JSON.parse(String(event.data));
    if (!responded) {
      responded = true;
      window.clearTimeout(timeout);
    }
    if (message.type === 'entered') network.id = message.id;
    else if (message.type === 'lobby') {
      const was = network.lobby;
      network.lobby = message.lobby;
      network.code = message.lobby.code;
      network.expires = 0;
      network.note = '';
      const url = new URL(location.href);
      url.searchParams.set('room', network.code);
      if (url.href !== location.href) history.replaceState(null, '', url);
      sessionStorage.setItem('burrow-room', network.code);
      if (!was && message.lobby.phase === 'lobby' && !message.lobby.resume && !message.lobby.nextMission) {
        send({ type: 'loadout', critter: firstSlot.critter, gadget: firstSlot.gadget });
      }
      if (message.lobby.phase === 'lobby') {
        settings = message.lobby.settings;
        if (active() || !was || was.phase !== 'lobby' || JSON.stringify(settings) !== JSON.stringify(state.settings)) resetPreview();
        if (!dialog.open || dialogKind === 'online') showMenu('online');
      } else if (message.lobby.phase === 'match' && was?.phase !== 'match' && dialogKind === 'online' && dialog.open) dialog.close();
      else if (dialogKind === 'online') paintOnline();
      refresh(true);
    } else if (message.type === 'frame') {
      const newRun = lastOnlineId !== message.matchId || state.tick > message.state.tick;
      if (newRun || state.stage !== message.state.stage || state.round !== message.state.round) {
        lastOnlineId = message.matchId;
        if (newRun) {
          soundEvent = 0;
          clearInputs();
        }
        network.predicted = undefined;
        network.correction = undefined;
        network.steering = undefined;
        network.frames = [];
        network.renderTick = message.state.tick;
      }
      local = false;
      state = message.state;
      network.received = performance.now();
      network.frames.push({ tick: state.tick, players: state.players });
      if (network.frames.length > 8) network.frames.shift();
      const yours = state.players.find(player => player.id === network.id);
      const prediction = network.predicted;
      if (network.steering && message.ack >= network.steering.seq) network.steering = undefined;
      if (prediction && yours) {
        const acknowledged = message.ack >= prediction.seq;
        if (sameTile(prediction.move, yours)) {
          if (acknowledged) prediction.confirmed = true;
        } else if (prediction.confirmed || (acknowledged && state.tick > prediction.expectedTick)) {
          network.predicted = undefined;
          const drawn = playerVisuals.get(yours.id);
          if (drawn) {
            const authoritative = playerPosition(yours, state.tick);
            const offset = { x: drawn.x - authoritative.x, y: drawn.y - authoritative.y };
            const gap = Math.hypot(offset.x, offset.y);
            network.correction = gap > .02 && gap <= 1.25 ? { offset, started: network.received } : undefined;
          }
        }
      }
      // A reconnect starts with a catch-up snapshot. Its event history has already happened.
      if (firstFrame && state.tick > 0) soundEvent = Math.max(soundEvent, state.events.at(-1)?.id ?? 0);
      else playEvents();
      firstFrame = false;
    } else if (message.type === 'profile') {
      if (message.profile.xp >= firstSlot.base.xp) firstSlot.base = message.profile;
      void saveSlot(firstSlot);
      refresh(true);
    } else if (message.type === 'pong') network.ping = Math.round(performance.now() - message.time);
    else if (message.type === 'error') {
      notice(message.message);
      if (message.fatal) {
        network.intent = false;
        network.note = message.message;
        ws.close();
        if (dialogKind === 'online') paintOnline();
      }
    }
  };
  ws.onclose = event => {
    window.clearTimeout(timeout);
    if (network.ws !== ws) return;
    network.ws = undefined;
    if (!responded && endpoint !== fallback && network.intent) {
      openRoomSocket(fallback, fallback, code, name);
      return;
    }
    if (event.code === 4001) {
      network.intent = false;
      network.note = 'This profile joined from another tab.';
    }
    if (network.intent && network.code && network.lobby) {
      network.expires ||= Date.now() + 60000;
      network.retryAt = Date.now() + 1000;
      network.note = 'Waiting for the room. Your seat is held for 60 seconds.';
    } else if (network.intent) {
      network.intent = false;
      network.note = 'Could not connect to the room server.';
    }
    refresh(true);
    if (dialogKind === 'online' && dialog.open) paintOnline();
  };
}
function leaveRoom() {
  send({ type: 'leave' });
  network.intent = false;
  const socket = network.ws;
  network = { code: '', name: '', seq: 0, expires: 0, retryAt: 0, lastInput: 0, lastEdge: 0, intent: false, note: '', ping: 0, received: 0, renderTick: 0, frames: [] };
  socket?.close();
  sessionStorage.removeItem('burrow-room');
  const url = new URL(location.href);
  url.searchParams.delete('room');
  history.replaceState(null, '', url);
  if (dialog.open) dialog.close();
  resetPreview();
}
function paintOnline() {
  const lobby = network.lobby;
  if (!lobby) {
    const code = new URL(location.href).searchParams.get('room') ?? '';
    const pending = Boolean(network.ws || network.resolvingRoute);
    menu('Play online', '<p class="dialog-copy">Create a private room for up to four players, or join a friend’s room.</p><div class="dialog-row">'
      + field('Your name', '<input id="online-name" maxlength="20" value="' + esc(network.name || firstSlot.name) + '">') + '</div><div class="dialog-row">'
      + field('Room code', '<input id="join-code" maxlength="8" placeholder="Eight characters" value="' + esc(code.slice(0, 8)) + '" autocomplete="off">')
      + button('join-room', 'Join room', 'secondary', pending) + button('create-room', 'Create room', 'primary', pending)
      + '</div>' + (network.note ? '<p class="dialog-copy">' + esc(network.note) + '</p>' : ''));
    const go = async (join: boolean) => {
      if (local && state.status === 'playing') return notice('Save and leave the local mission first.');
      const target = join ? value('join-code').trim().toUpperCase() : '';
      if (join && !/^[A-HJ-NP-Z2-9]{8}$/.test(target)) return notice('Enter the eight-character room code.');
      const name = value('online-name').trim() || 'Burrower';
      firstSlot.name = name;
      await saveSlot(firstSlot).catch(() => {});
      await syncProfile(firstSlot);
      void connect(target, name);
    };
    listen('join-room', () => void go(true));
    listen('create-room', () => void go(false));
    return;
  }
  const mine = lobby.members.find(member => member.id === network.id);
  const host = lobbyHost();
  const inLobby = lobby.phase === 'lobby' && !lobby.nextMission;
  const current = lobby.settings;
  const profile = profileOf(firstSlot);
  const roomMode = el<HTMLSelectElement>('room-mode');
  const proposedMode = roomMode?.value ?? current.mode;
  const roster = lobby.members.map(member => '<div class="room-member"><span>' + esc(member.name)
    + (member.id === lobby.host ? ' · Host' : '') + (member.id === network.id ? ' · You' : '') + '</span><b>'
    + (member.connected ? member.ready ? 'Ready' : lobby.phase === 'match' ? 'Playing' : 'In lobby' : 'Reconnecting') + '</b></div>').join('');
  menu('Private room', '<div class="dialog-row"><span class="room-code">' + esc(lobby.code) + '</span>'
    + button('copy-link', icon('copy') + ' Copy invite') + '</div>'
    + (network.note ? '<p class="dialog-copy">' + esc(network.note) + '</p>' : '')
    + (lobby.nextMission ? '<p class="dialog-copy">' + esc(nextMissionMessage(lobby.nextMission)) + '</p>' : '')
    + '<div class="room-members">' + roster + '</div>'
    + '<p class="dialog-copy">' + esc(current.mode === 'arena' ? 'Arena · ' + (REGIONS.find(region => region.id === current.arena)?.name ?? current.arena)
      : (current.mode === 'expedition' ? 'Weekly expedition' : missionFor(current.missionId).name)) + (lobby.resume ? ' · Saved checkpoint' : '')
    + (network.ping ? ' · ' + network.ping + ' ms' : '') + '</p>'
    + (inLobby && host && !lobby.resume ? '<div class="dialog-row">' + field('Mode', options('room-mode', [
      ['adventure', 'Adventure'], ['arena', 'Arena'], ['expedition', 'Weekly expedition'], ['challenge', 'Score challenge']], proposedMode))
      + (proposedMode !== 'arena' && proposedMode !== 'expedition' ? field('Mission', options('room-mission',
        CAMPAIGN.filter(mission => proposedMode !== 'challenge' || profile.cleared.includes(mission.id)).map(mission => [mission.id, mission.name]), current.missionId)) : '')
      + button('apply-room', 'Apply', 'secondary', proposedMode === 'challenge' && profile.cleared.length === 0) + '</div>' + (proposedMode === 'arena' ? '<div class="dialog-grid">' + arenaFields(current, lobby.seats) + '</div>' : '')
      + '<hr class="divider">' : '')
    + '<div class="dialog-row">'
    + (inLobby ? button('room-loadout', 'Loadout') + button('room-ready', mine?.ready ? 'Unready' : 'Ready', 'secondary')
      + (host ? button('room-start', lobby.resume ? 'Resume checkpoint' : 'Start match', 'primary', !lobby.members.filter(member => member.connected).every(member => member.ready)) : '')
      : host && (lobby.phase === 'result' || lobby.nextMission) ? button('room-return', 'Return to lobby', 'primary') : '')
    + button('room-leave', 'Leave room') + '</div>');
  listen('copy-link', () => {
    if (navigator.clipboard) void navigator.clipboard.writeText(location.href).then(() => notice('Invite link copied.')).catch(() => notice('Copy the link from your address bar.'));
    else notice('Copy the link from your address bar.');
  });
  el('room-mode')?.addEventListener('change', paintOnline);
  listen('apply-room', () => {
    const mode = value('room-mode') as Mode;
    const missionId = el('room-mission') ? value('room-mission') : current.missionId;
    const next = mode === 'arena' && el('set-arena') ? readArena(current) : { ...current, mode, missionId };
    if (mode === 'expedition') Object.assign(next, expeditionFor(Date.now()));
    else if (mode !== 'arena') Object.assign(next, campaignEntry(next.missionId));
    send({ type: 'setup', settings: next, seats: el('set-total') ? Number(value('set-total')) : arenaTotal });
  });
  listen('room-loadout', () => { loadoutSlot = 0; showMenu('loadout'); });
  listen('room-ready', () => send({ type: 'ready', ready: !mine?.ready }));
  listen('room-start', () => send({ type: 'start' }));
  listen('room-return', () => send({ type: 'lobby' }));
  listen('room-leave', leaveRoom);
}

for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) tab.onclick = () => updateMode(tab.dataset.mode as Mode);
for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-count]')) tab.onclick = () => {
  party = Number(tab.dataset.count);
  resetPreview();
};
listen('brand', () => updateMode('adventure'));
listen('online-button', () => showMenu('online'));
listen('online-party', () => showMenu('online'));
listen('map-button', () => showMenu(network.lobby && settings.mode === 'arena' ? 'online' : settings.mode === 'arena' ? 'arena' : 'map'));
listen('journal-button', () => showMenu('journal'));
listen('dialog-close', () => dialog.close());
listen('pause-button', togglePause);
el('fullscreen').hidden = !document.fullscreenEnabled;
listen('fullscreen', toggleFullscreen);
listen('sound-button', () => {
  const on = audio.toggle();
  el('sound-button').setAttribute('aria-pressed', String(on));
  el('sound-button').innerHTML = icon(on ? 'sound' : 'mute');
});
startButton.onclick = () => {
  if (network.lobby) return showMenu('online');
  if (pendingResult || local && state.status === 'between') return;
  if (local && state.status === 'playing') return togglePause();
  if (local && state.status === 'failed') return beginLocal(saved ?? undefined);
  if (local && state.status === 'cleared' && settings.mode !== 'arena') return resetPreview();
  beginLocal();
};
dialog.addEventListener('close', () => {
  dialogKind = null;
  rebind = null;
  clearInputs();
  if (active() && !coarsePointer.matches) el('board-frame').focus({ preventScroll: true });
});
window.addEventListener('blur', clearInputs);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearInputs(); });
window.addEventListener('online', () => { if (!pendingResult) void syncAll(); });
window.addEventListener('keydown', event => {
  if (rebind) {
    event.preventDefault();
    if (event.code === 'Escape') { rebind = null; paintMenu(); return; }
    if (/^(F\d+|Meta|Control|Alt|Tab|Escape)/.test(event.code)) return notice('Choose a letter, arrow, or another ordinary key.');
    if (bindings.some((set, p) => entries(set).some(([name, key]) => key === event.code && (p !== rebind!.player || name !== rebind!.action)))) return notice('That key is already assigned.');
    bindings[rebind.player][rebind.action] = event.code;
    rebind = null;
    void saveControls(bindings);
    paintMenu();
    refresh(true);
    return;
  }
  if (dialog.open || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.code === 'KeyF' && !bindings.some(set => Object.values(set).includes('KeyF'))) { event.preventDefault(); toggleFullscreen(); return; }
  if (event.code === 'Escape' && !document.fullscreenElement) { togglePause(); return; }
  if (!acceptGameInput()) return;
  const matching = bindings.findIndex(set => Object.values(set).includes(event.code));
  if (matching === -1 || matching === 1 && (party === 1 || playingOnline())) return;
  event.preventDefault();
  if (!keys.has(event.code)) {
    const set = bindings[matching];
    if (event.code === set.bomb) fired[matching] = true;
    else tapped[matching] = directions.find(direction => set[direction] === event.code);
    keys.add(event.code);
    onlineInputChanged();
  }
});
window.addEventListener('keyup', event => {
  if (keys.delete(event.code)) onlineInputChanged();
});

function inputFor(index: number, any = true): Input {
  if (document.hidden || dialog.open || !any) return {};
  const set = bindings[index];
  const pressed = Array.from(keys).reverse();
  const held = pressed.map(key => directions.find(test => set[test] === key));
  const touchHeld = index === 0 ? touch.held() : [];
  const [direction, alternate] = new Set([...touchHeld, ...held.filter((key): key is Direction => key !== undefined)]);
  const turn = tapped[index];
  const bomb = fired[index];
  tapped[index] = undefined;
  fired[index] = false;
  return { direction, alternate, turn, bomb };
}
function playEvents() {
  let knockoutTick: number | undefined;
  for (const event of state.events) if (event.id > soundEvent) {
    soundEvent = event.id;
    if (event.kind === 'knockout') {
      if (knockoutTick === event.tick) continue;
      knockoutTick = event.tick;
    }
    audio.play(event.kind, knockoutTick !== undefined && knockoutTick === event.tick ? .58 : 0);
  }
}

function stepLocal() {
  if (!local || paused || dialog.open) return;
  const stage = state.stage;
  const status = state.status;
  const inputs = { p1: inputFor(0), p2: inputFor(1, party === 2) };
  tickGame(state, inputs);
  if (state.stage !== stage) recordCheckpoint();
  if (state.status === 'cleared' && status !== 'cleared') void recordResult();
  playEvents();
}
function stepNetwork(now: number, edge = false) {
  if (!edge && network.intent && !network.ws && network.expires) {
    if (Date.now() > network.expires) {
      network.intent = false;
      network.note = 'The room could not be reached. Rejoin with the invite link.';
      refresh(true);
    } else if (Date.now() >= network.retryAt && navigator.onLine) void connect(network.code, network.name, true);
  }
  if (!playingOnline() || !inProgress() || !network.frames.length || network.ws?.readyState !== WebSocket.OPEN) return;
  if (edge) {
    // Send control changes without waiting for the next animation frame.
    if (now - network.lastEdge < inputEdgeInterval) return;
    network.lastEdge = now;
    network.lastInput = now;
  } else {
    const sinceInput = now - network.lastInput;
    if (sinceInput < quantum) return;
    network.lastInput = now - sinceInput % quantum;
  }
  const input = inputFor(0);
  send({ type: 'input', seq: ++network.seq, ...input });
  const player = state.players.find(value => value.id === network.id);
  const prediction = network.predicted;
  if (!player?.hp || now - network.received >= 700) return;

  const estimate = state.tick + Math.min(4, (now - network.received) / quantum);
  const tick = prediction ? predictionTick(prediction, now) : estimate;
  if (prediction && !prediction.confirmed && tick >= prediction.move.moveAt) return;

  const base = { ...player, ...prediction?.move,
    bufferedTurn: network.steering ? network.steering.bufferedTurn : player.bufferedTurn };
  const { move, bufferedTurn } = steerPlayer(state, base, input, tick);
  if (bufferedTurn !== base.bufferedTurn) network.steering = { seq: network.seq, bufferedTurn };
  if (move) {
    network.predicted = {
      move, started: now, seq: network.seq, expectedTick: state.tick + 2, confirmed: false
    };
  }
}
window.setInterval(() => { if (network.lobby) send({ type: 'ping', time: performance.now() }); }, 3000);

declare global {
  interface Window { advanceTime: (ms: number) => void; render_game_to_text: () => string; __vt_pending?: Set<unknown> }
}
const debug = window;
let manual = Boolean(debug.__vt_pending);
let time = performance.now();
let lastDrawnState: State | undefined;
function cueTick(now = performance.now()) {
  let tick = state.tick;
  if (local) {
    // Let the last cue finish even though a final result has stopped the simulation.
    const elapsed = finishedAt === undefined ? accumulator : (manual ? time : now) - finishedAt;
    tick += Math.max(0, elapsed) / quantum;
  } else if (network.frames.length) {
    const elapsed = Math.max(0, now - network.received) / quantum;
    tick += inProgress() ? Math.min(4, elapsed) : elapsed;
  }
  return tick;
}
function visibleCues(tick = cueTick()) {
  return (state.cues ?? []).flatMap(cue => {
    const age = (tick - cue.tick) / VISUAL_CUE_TICKS[cue.kind];
    return age >= 0 && age < 1 ? [{ ...cue, age }] : [];
  });
}
function advanceLocal(ms: number, now: number) {
  if (!local || paused || dialog.open || !inProgress()) return;
  accumulator += ms;
  while (accumulator + .001 >= quantum && inProgress()) {
    accumulator -= quantum;
    stepLocal();
  }
  if (!inProgress()) {
    finishedAt = now - Math.max(0, accumulator);
    accumulator = 0;
  }
  accumulator = Math.max(0, accumulator);
}
function draw(now: number) {
  lastDrawnState = state;
  playerVisuals = new Map();
  let visualTick = state.tick;
  const onlineFrames = network.frames;
  if (network.lobby?.phase === 'match' && onlineFrames.length) {
    const estimate = state.tick + Math.min(4, Math.max(0, (now - network.received) / quantum));
    visualTick = estimate;
    // Snapshots contain the full timed slide, so remote motion only needs one tick of lead time for turns.
    network.renderTick = Math.max(network.renderTick, estimate - remoteBufferTicks);
    const sampleTick = network.renderTick;
    const upper = onlineFrames.findIndex(frame => frame.tick > sampleTick);
    const after = onlineFrames[upper];
    const before = onlineFrames[upper === -1 ? onlineFrames.length - 1 : Math.max(0, upper - 1)];
    for (const player of state.players) {
      const newer = after?.players.find(value => value.id === player.id);
      const sample = newer?.step && newer.step.started <= sampleTick
        ? newer : before.players.find(value => value.id === player.id) ?? player;
      let position = playerPosition(sample, sampleTick);
      if (player.id === network.id) {
        const prediction = network.predicted;
        position = prediction
          ? playerPosition(prediction.move, predictionTick(prediction, now))
          : playerPosition(player, estimate);
        if (network.correction) {
          // Decay only the visual error. New turns keep steering the base position during the blend.
          const amount = Math.max(0, 1 - (now - network.correction.started) / correctionMs);
          const adjusted = { x: position.x + network.correction.offset.x * amount, y: position.y + network.correction.offset.y * amount };
          const cell = { x: Math.round(adjusted.x), y: Math.round(adjusted.y) };
          if (amount === 0 || !passable(state, cell)) {
            network.correction = undefined;
          } else position = adjusted;
        }
      }
      playerVisuals.set(player.id, position);
    }
  } else {
    visualTick = state.tick + (inProgress() ? accumulator / quantum : 1);
    for (const player of state.players) playerVisuals.set(player.id, playerPosition(player, visualTick));
  }
  const effectsAt = cueTick(now);
  render(state, manual ? time : now, !active(), controlled(), playerVisuals, visualTick, effectsAt, visibleCues(effectsAt));
}
debug.advanceTime = (ms: number) => {
  manual = true;
  const elapsed = Math.max(0, Math.min(120000, ms));
  time += elapsed;
  advanceLocal(elapsed, time);
  refresh();
  draw(performance.now());
};
debug.render_game_to_text = () => JSON.stringify({
  coordinates: 'Tile grid, top-left origin; x right, y down',
  mode: state.settings.mode, mission: state.settings.missionId, seed: state.settings.seed,
  active: active(), online: Boolean(network.lobby), phase: network.lobby?.phase, room: network.lobby?.code,
  you: controlled(), paused, status: state.status, tick: state.tick, chamber: state.stage + 1,
  chambers: state.stages, round: state.round, wins: state.wins, winner: state.winner, score: state.score,
  timeLeft: state.limit - state.tick, tiles: state.tiles, players: state.players,
  playerVisuals: Object.fromEntries(playerVisuals), bombs: state.bombs, flames: state.flames, items: state.items, enemies: state.enemies.filter(item => item.hp), targets: state.targets,
  exit: { ...state.exit, open: exitOpen(state) }, discoveries: state.discoveries, visualCues: visibleCues(),
  profiles: slots.map(slot => ({ ...profileOf(slot), pending: slot.pending.length }))
});
function display(now: number) {
  if (!manual) {
    advanceLocal(Math.max(0, Math.min(115, now - time)), now);
    time = now;
  }
  const frameTime = performance.now();
  stepNetwork(frameTime);
  refresh();
  // A covered menu preview only needs repainting when its board changes.
  if (!dialog.open || active() || state !== lastDrawnState) draw(performance.now());
  requestAnimationFrame(display);
}
refresh(true);
requestAnimationFrame(display);
if (navigator.onLine) void syncAll();
if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});
const invite = new URL(location.href).searchParams.get('room');
if (invite) {
  showMenu('online');
  if (invite === sessionStorage.getItem('burrow-room')) void syncProfile(firstSlot).then(() => connect(invite, firstSlot.name));
}
