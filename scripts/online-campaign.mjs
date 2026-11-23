import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { campaignEntry, missionFor } from '../dist/shared/content.js';
import { moveDelay, nextPoint } from '../dist/shared/engine.js';
import { driveCampaign, openingChambers } from './campaign-driver.mjs';

const base = process.env.BURROW_TEST_URL ?? 'http://127.0.0.1:4317';
const browsers = await Promise.all([chromium.launch(), chromium.launch()]);
const output = 'qa/online-campaign';
await mkdir(output, { recursive: true });
const firstMission = Math.max(1, Math.min(4, Number(process.env.BURROW_ONLINE_FROM) || 1));
const lastMission = Math.max(firstMission, Math.min(4, Number(process.env.BURROW_ONLINE_TO) || 4));
const viewport = { width: 1440, height: 900 };
const errors = [];
const prepare = async browser => {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  return page;
};
const key = { up: 'w', down: 's', left: 'a', right: 'd' };
const stats = page => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const changedCell = (a, b) => a.x !== b.x || a.y !== b.y;
const getPlayer = state => state.players.find(player => player.id === 'p1');
let frame;
let hostId;
let guestId;
let sequence = 0;
const subscribers = new Set();
function signal() {
  sequence++;
  for (const notify of subscribers) notify();
  subscribers.clear();
}
async function nextFrame(seen, timeout = 650) {
  if (sequence > seen) return;
  await new Promise(resolve => {
    const done = () => { clearTimeout(timer); subscribers.delete(done); resolve(); };
    const timer = setTimeout(done, timeout);
    subscribers.add(done);
  });
}
function track(socket) {
  socket.on('framereceived', ({ payload }) => {
    const received = JSON.parse(String(payload));
    if (received.type === 'entered') hostId = received.id;
    if (received.type === 'frame') { frame = received.state; signal(); }
  });
}
async function driveOpening(page) {
  const chambers = openingChambers();
  const pilot = () => frame.players.find(player => player.id === hostId);
  for (let stage = frame.stage; stage < chambers.length; stage++) {
    const waitFor = async condition => {
      const deadline = Date.now() + 5000;
      while (frame.stage === stage && frame.status === 'playing' && !condition()) {
        assert.ok(Date.now() < deadline, 'Opening route stalled at chamber ' + (stage + 1) + ', tick ' + frame.tick);
        await nextFrame(sequence);
      }
    };
    for (const action of chambers[stage]) {
      if (frame.stage !== stage || frame.status !== 'playing') break;
      if (!action.direction) {
        const end = frame.tick + action.ticks;
        await waitFor(() => frame.tick >= end);
        continue;
      }
      let target = pilot();
      const tiles = Math.ceil(action.ticks / moveDelay(target));
      for (let i = 0; i < tiles; i++) target = nextPoint(target, action.direction);
      const atTarget = () => !changedCell(pilot(), target);
      const control = key[action.direction];
      if (action.bomb) await page.keyboard.press('Space');
      await page.keyboard.down(control);
      try { await waitFor(atTarget); }
      finally { await page.keyboard.up(control); }
      await waitFor(() => atTarget() && frame.tick >= pilot().moveAt);
    }
  }
  return frame.status;
}
async function drive(host, guest, id) {
  if (id === 'roots-1') return driveOpening(host);
  let pilot = hostId;
  let page = host;
  let held;
  let steps = 0;
  let stage = -1;
  let before;
  const deadline = Date.now() + 260000;
  try {
    while (Date.now() < deadline && frame?.settings.missionId === id && frame.status === 'playing') {
      if (frame.players.find(player => player.id === pilot)?.hp === 0) {
        const backup = pilot === hostId ? guestId : hostId;
        if (!frame.players.find(player => player.id === backup)?.hp) return 'party-wipe';
        if (held) { await page.keyboard.up(held); held = undefined; }
        pilot = backup;
        page = pilot === hostId ? host : guest;
        console.log('  Partner took over after a knockout.');
      }
      const value = structuredClone(frame);
      for (const player of value.players) if (player.id === pilot) player.id = 'p1';
      for (const bomb of value.bombs) if (bomb.owner === pilot) bomb.owner = 'p1';
      if (value.stage !== stage) {
        stage = value.stage;
        console.log(id + ' chamber ' + (stage + 1));
      }
      if (!getPlayer(value)?.hp) return 'pilot-wipe';
      const action = driveCampaign(value, 1, { online: true }).actions[0];
      if (!action) return 'no-action';
      const next = action.direction && key[action.direction];
      const seen = sequence;
      before = frame;
      if (held && held !== next) { await page.keyboard.up(held); held = undefined; }
      if (next && held !== next) { await page.keyboard.down(next); held = next; }
      if (action.bomb) await page.keyboard.press('Space');
      const player = before.players.find(item => item.id === pilot);
      for (let iterations = 0; iterations < 10 && frame.status === 'playing' && frame.stage === before.stage; iterations++) {
        if (frame.tick - before.tick >= Math.max(3, Math.min(8, action.ticks))) break;
        if (next && frame.tick !== before.tick && changedCell(frame.players.find(item => item.id === pilot), player)) break;
        await nextFrame(iterations ? sequence : seen);
      }
      if (++steps % 120 === 0) console.log('  ' + Math.round(frame.tick / 30) + 's · ' + frame.targets.filter(target => target.done).length + '/' + frame.targets.length + ' objectives · hp ' + frame.players.map(player => player.hp).join('/') + ' · ' + frame.players.map(player => player.x + ',' + player.y).join(' / ') + ' · boss ' + (frame.enemies.find(enemy => enemy.kind === 'boss')?.hp ?? '—'));
    }
    return frame?.status;
  } finally {
    if (held) await page.keyboard.up(held);
  }
}

try {
  const [host, guest] = await Promise.all(browsers.map(prepare));
  host.on('websocket', track);
  guest.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    const message = JSON.parse(String(payload));
    if (message.type === 'entered') guestId = message.id;
  }));
  await host.goto(base);
  await host.locator('#online-button').click();
  await host.locator('#online-name').fill('Pip');
  await host.locator('#create-room').click();
  await host.locator('.room-code').waitFor();
  await guest.goto(host.url());
  await guest.locator('#online-name').fill('Bramble');
  await guest.locator('#join-room').click();
  await guest.locator('.room-code').waitFor();
  if (firstMission > 1) {
    const id = 'roots-' + firstMission;
    await host.selectOption('#room-mission', id);
    await host.locator('#apply-room').click();
    await guest.locator('#dialog p').filter({ hasText: missionFor(id).name }).waitFor();
  }
  await guest.locator('#room-ready').click();
  await host.locator('#room-ready').click();
  await host.locator('#room-start').click();
  const room = new URL(host.url()).searchParams.get('room');
  for (let mission = firstMission; mission <= lastMission; mission++) {
    const id = 'roots-' + mission;
    const deadline = Date.now() + 7000;
    while (frame?.settings.missionId !== id || frame?.status !== 'playing') {
      if (Date.now() > deadline) throw new Error('Match never started for ' + id);
      await delay(15);
    }
    let status = await drive(host, guest, id);
    for (let retry = 0; retry < 2 && frame.status === 'failed'; retry++) {
      await host.locator('#overlay-retry').click();
      const deadline = Date.now() + 3000;
      while (frame.status !== 'playing' && Date.now() < deadline) await delay(30);
      status = await drive(host, guest, id);
    }
    assert.equal(status, 'cleared', id + ' tick=' + frame.tick + ' stage=' + frame.stage + ' pos=' + JSON.stringify(frame.players.map(p => [p.x,p.y,p.hp])));
    await guest.waitForFunction(expected => JSON.parse(window.render_game_to_text()).profiles[0].cleared.includes(expected), id);
    assert.ok((await stats(host)).profiles[0].cleared.includes(id));
    await guest.screenshot({ path: output + '/' + id + '.png' });
    console.log('Cleared ' + id + ' online for both profiles.');
    const { missionId } = campaignEntry(id, 1);
    for (const page of [host, guest]) {
      await page.locator('#board-overlay').getByText('Starting ' + missionFor(missionId).name + ' shortly.', { exact: false }).waitFor();
    }
    await Promise.all([host, guest].map(page => page.waitForFunction(({ mission, room, crew }) => {
      const state = JSON.parse(window.render_game_to_text());
      return state.mission === mission && state.room === room && state.chamber === 1 && state.status === 'playing'
        && state.players.map(player => player.id).join() === crew.join();
    }, { mission: missionId, room, crew: [hostId, guestId] })));
    console.log('Continued to ' + missionId + ' in the same room.');
  }
  assert.deepEqual(errors, []);
} finally {
  await Promise.all(browsers.map(browser => browser.close()));
}
