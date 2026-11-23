import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { CAMPAIGN } from '../dist/shared/content.js';
import { DEFAULT_SETTINGS, createGame, tickGame } from '../dist/shared/engine.js';
import { driveCampaign, openingChambers, replayInputs } from './campaign-driver.mjs';

const base = process.env.BURROW_TEST_URL ?? 'http://127.0.0.1:4317';
const output = 'qa/campaign';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const errors = [];
const state = page => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const pilot = { id: 'p1', critter: 'hare', gadget: 'standard' };

async function run(count, missionCount = 4) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const writes = [];
  page.on('request', request => {
    if (request.url().endsWith('/api/profile')) writes.push(request.postDataJSON());
  });
  await page.goto(base);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
  await page.waitForLoadState('networkidle');
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
  await page.evaluate(() => window.advanceTime(0));
  if (count > 1) await page.locator('[data-count="2"]').click();
  let completed = 0;
  for (const [index, mission] of CAMPAIGN.slice(0, missionCount).entries()) {
    const id = mission.id;
    if (index > 0) await page.locator('#overlay-next').click();
    await page.locator('#start-btn').click();
    const seats = count === 1 ? [pilot] : [pilot, { ...pilot, id: 'p2', critter: 'fox' }];
    const settings = { ...DEFAULT_SETTINGS, missionId: id, seed: 117 + index * 109 };
    // Try different starting phases for timed hazards before replaying a successful route.
    let route;
    for (let delay = 0; delay <= 450; delay += 9) {
      const game = createGame(settings, seats);
      for (let tick = 0; tick < delay; tick++) tickGame(game);
      const candidate = driveCampaign(game);
      if (candidate.status !== 'cleared') continue;
      if (delay) candidate.actions.unshift({ ticks: delay });
      // Browser keydowns also queue a tap on the first tick of each action.
      const replay = createGame(settings, seats);
      for (const { direction, bomb, ticks } of candidate.actions) {
        for (let tick = 0; tick < ticks; tick++) tickGame(replay, {
          p1: { direction, turn: tick === 0 ? direction : undefined, bomb: Boolean(bomb && tick === 0) }
        });
      }
      if (replay.status === 'cleared') {
        route = { actions: candidate.actions, game: replay };
        break;
      }
    }
    assert.ok(route, 'campaign driver found no browser-playable route for ' + id);
    if (id === 'roots-1') {
      const lessons = ['Around the Hedge', 'Moth and Fuse', 'The Second Spark'];
      const chambers = openingChambers();
      const leadIn = route.actions.length - chambers.flat().length;
      await replayInputs(page, route.actions.slice(0, leadIn));
      for (const [i, actions] of chambers.entries()) {
        assert.equal((await state(page)).chamber, i + 1);
        assert.equal(await page.locator('#objective-kicker').textContent(), lessons[i]);
        await page.screenshot({ path: output + '/lesson-' + (i + 1) + '-' + count + 'p.png' });
        await replayInputs(page, actions);
      }
    } else await replayInputs(page, route.actions);
    const result = await state(page);
    assert.equal(result.status, 'cleared', id + ' in browser with ' + count + ' keyboard players');
    assert.equal(result.score, route.game.score);
    await page.waitForFunction(({ mission, id, count }) => {
      const value = JSON.parse(window.render_game_to_text());
      return value.profiles.slice(0, count).every(profile => profile.pending === mission && profile.cleared.includes(id));
    }, { mission: index + 1, id, count });
    completed = result.score;
  }
  await page.screenshot({ path: output + '/' + (missionCount === 4 ? 'rootwarren' : 'all-regions') + '-' + count + 'p.png' });
  await page.reload();
  await page.waitForFunction(({ count, missionCount }) => {
    if (typeof window.render_game_to_text !== 'function') return false;
    return JSON.parse(window.render_game_to_text()).profiles.slice(0, count).every(profile => profile.cleared.length === missionCount && profile.pending === missionCount);
  }, { count, missionCount });
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(({ count, missionCount }) =>
    JSON.parse(window.render_game_to_text()).profiles.slice(0, count).every(profile => profile.cleared.length === missionCount && profile.pending === 0 && profile.xp >= 460), { count, missionCount });
  const profiles = (await state(page)).profiles;
  for (const write of writes.filter(request => request.rewards.length === missionCount)) {
    const reply = await page.request.post(base + '/api/profile', { data: write });
    assert.ok(reply.ok());
    const { profile } = await reply.json();
    assert.equal(profile.xp, profiles[0].xp);
    assert.equal(profile.cleared.length, missionCount);
  }
  if (count === 1) assert.equal(profiles[1].xp, 0);
  else assert.equal(profiles[1].xp, profiles[0].xp);
  await page.locator('#journal-button').click();
  await page.locator('[data-challenge="roots-1"]').click();
  assert.equal((await state(page)).mode, 'challenge');
  assert.ok((await state(page)).timeLeft < 360 * 30);
  await page.locator('[data-mode="expedition"]').click();
  assert.equal((await state(page)).mode, 'expedition');
  await page.locator('#start-btn').click();
  await page.evaluate(() => window.advanceTime(200));
  assert.ok((await state(page)).tick > 0);
  await context.close();
  console.log('Cleared ' + missionCount + ' missions offline with ' + count + ' keyboard profile(s), ' + completed + ' boss mission points. Cached restart and exactly-once XP sync passed.');
}

try {
  if (process.env.BURROW_FULL_CAMPAIGN === '1') await run(1, CAMPAIGN.length);
  else {
    await run(1);
    await run(2);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
