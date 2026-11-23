import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.BURROW_TEST_URL ?? 'http://127.0.0.1:4317';
const output = 'qa/browser';
await mkdir(output, { recursive: true });
const hosts = await Promise.all([chromium.launch(), chromium.launch()]);
const errors = [];
const view = { viewport: { width: 1440, height: 900 } };
const setup = async (browser, name, url = base, latency = false) => {
  const page = await browser.newPage(view);
  page.on('pageerror', error => errors.push(name + ': ' + error.message));
  if (latency) {
    await page.routeWebSocket('**/rooms', room => {
      const upstream = room.connectToServer();
      room.onMessage(message => setTimeout(() => {
        try { upstream.send(message); } catch { /* The room may have closed. */ }
      }, 65));
      upstream.onMessage(message => setTimeout(() => {
        try { room.send(message); } catch { /* The browser may have navigated. */ }
      }, 100));
    });
  }
  await page.goto(url);
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
  return page;
};
const state = page => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const tick = (page, ms) => page.evaluate(ms => window.advanceTime(ms), ms);
async function drive(page, key, time) {
  await page.keyboard.down(key);
  await tick(page, time);
  await page.keyboard.up(key);
}
async function moveTile(page, key) {
  await page.keyboard.press(key);
  await tick(page, 1000 * 7 / 30);
}
try {
  const host = await setup(hosts[0], 'host');
  await host.screenshot({ path: output + '/01-trail.png', fullPage: true });
  assert.equal(await host.locator('h1').textContent(), 'Beneath the Bramble');
  await host.locator('[data-count="2"]').click();
  await tick(host, 0);
  await host.locator('#start-btn').click();
  assert.deepEqual(await host.locator('#board-stats .hearts').allTextContents(), ['♥', '♥']);
  const before = await state(host);
  await host.keyboard.down('d');
  await host.keyboard.down('ArrowRight');
  await tick(host, 80);
  const firstSlide = await state(host);
  await tick(host, 80);
  await host.keyboard.up('d');
  await host.keyboard.up('ArrowRight');
  const duo = await state(host);
  for (const [i, player] of duo.players.entries()) {
    const start = before.players[i].x;
    const first = firstSlide.playerVisuals[player.id].x;
    const second = duo.playerVisuals[player.id].x;
    assert.equal(player.x, start + 1);
    assert.equal(player.x, firstSlide.players[i].x);
    assert.ok(start < first && first < second && second < player.x);
    assert.ok(Math.abs((second - first) - .4) < .02);
  }
  await host.keyboard.press('Space');
  await host.keyboard.press('Enter');
  await tick(host, 40);
  assert.equal((await state(host)).bombs.length, 2);
  await host.screenshot({ path: output + '/02-local-duo.png' });
  await host.locator('#pause-button').click();
  const paused = await state(host);
  await tick(host, 400);
  const still = await state(host);
  assert.equal(still.tick, paused.tick);
  assert.deepEqual(still.playerVisuals, paused.playerVisuals);
  await host.locator('#overlay-leave').click();
  await host.locator('#resume-save').waitFor();
  await host.locator('#controls-button').click();
  await host.locator('[data-key="1:bomb"]').click();
  await host.keyboard.press('ShiftRight');
  assert.ok((await host.locator('[data-key="1:bomb"]').textContent()).includes('R Shift'));
  await host.locator('#dialog-close').click();

  const itemsPage = await setup(hosts[0], 'items');
  await tick(itemsPage, 0);
  await itemsPage.locator('#start-btn').click();
  const capacityDrop = item => item.kind === 'capacity' && item.x === 4 && item.y === 3;
  const fresh = await state(itemsPage);
  assert.deepEqual(fresh.items, []);
  assert.equal(fresh.players[0].range, 1);
  await drive(itemsPage, 's', 1000 * 2 / 30);
  await itemsPage.keyboard.press('d');
  await tick(itemsPage, 1000 / 30);
  const queued = await state(itemsPage);
  assert.equal(queued.players[0].bufferedTurn.direction, 'right');
  assert.equal(queued.players[0].y, 2);
  await tick(itemsPage, 1000 * 7 / 30);
  const corner = await state(itemsPage);
  assert.equal(corner.players[0].step.direction, 'right');
  assert.equal(corner.players[0].step.corner.y, 3);
  assert.equal(corner.players[0].step.started, 8);
  assert.ok(corner.playerVisuals.p1.x > 1 && corner.playerVisuals.p1.y < 3);
  await itemsPage.screenshot({ path: output + '/06-early-corner.png' });
  await drive(itemsPage, 'd', 300);
  await tick(itemsPage, 200);
  await itemsPage.keyboard.press('Space');
  await drive(itemsPage, 'a', 400);
  await drive(itemsPage, 'w', 200);
  const lit = await state(itemsPage);
  const planted = lit.bombs[0];
  assert.deepEqual([planted.x, planted.y], [3, 3]);
  const fuseWidth = () => itemsPage.evaluate(({ x, y }) => {
    const pixels = document.querySelector('#board').getContext('2d').getImageData(x * 48 + 10, y * 48 + 42, 28, 1).data;
    let width = 0;
    for (let at = 0; at < pixels.length; at += 4) if (pixels[at] > 140) width++;
    return width;
  }, planted);
  const longFuse = await fuseWidth();
  await tick(itemsPage, (planted.end - lit.tick - 9) * 1000 / 30);
  const nearlyOut = await fuseWidth();
  assert.ok(nearlyOut > 0 && nearlyOut < longFuse);
  await itemsPage.screenshot({ path: output + '/09-fuse-meter.png' });
  await tick(itemsPage, 1000 * 10 / 30);
  const afterBlast = await state(itemsPage);
  const pixels = await itemsPage.evaluate(() => {
    const ctx = document.querySelector('#board').getContext('2d');
    const heated = (x, y) => {
      const [red, green] = ctx.getImageData(x, y, 1, 1).data;
      return red > 170 && green > 130;
    };
    const y = 3 * 48 + 24;
    return [heated(4 * 48 - 1, y), heated(4 * 48, y), heated(5 * 48 - 2, y), heated(5 * 48 + 24, y)];
  });
  assert.deepEqual(pixels, [true, true, false, false]);
  await itemsPage.screenshot({ path: output + '/10-connected-blast.png' });
  assert.equal(afterBlast.players[0].hp, 1);
  assert.ok(afterBlast.items.some(capacityDrop));
  assert.deepEqual(afterBlast.visualCues.map(({ kind, x, y }) => [kind, x, y]), [['crate', 4, 3]]);
  await tick(itemsPage, 450);
  for (const key of ['s', 'd', 'd']) await moveTile(itemsPage, key);
  assert.deepEqual((await state(itemsPage)).playerVisuals.p1, { x: 3, y: 3 });
  await itemsPage.keyboard.press('Space');
  await tick(itemsPage, 2600);
  const failed = await state(itemsPage);
  assert.equal(failed.status, 'failed');
  assert.ok(!failed.items.some(capacityDrop));
  assert.equal(await itemsPage.locator('#board-stats .hearts').innerText(), '♡');
  assert.deepEqual(failed.visualCues.map(({ kind, x, y }) => [kind, x, y]), [['knockout', 3, 3]]);
  assert.ok(await itemsPage.locator('#board-overlay').isHidden());
  await tick(itemsPage, 750);
  const settled = await state(itemsPage);
  assert.equal(settled.tick, failed.tick);
  assert.deepEqual(settled.visualCues, []);
  assert.ok(await itemsPage.locator('#board-overlay').isVisible());
  await itemsPage.close();

  const pickupPage = await setup(hosts[0], 'pickup timing');
  await tick(pickupPage, 0);
  await pickupPage.locator('#start-btn').click();
  for (const key of ['s', 's', 'd', 'd']) await moveTile(pickupPage, key);
  await pickupPage.keyboard.press('Space');
  for (const key of ['w', 'w']) await moveTile(pickupPage, key);
  await tick(pickupPage, 2600);
  for (const key of ['s', 's']) await moveTile(pickupPage, key);
  await pickupPage.keyboard.press('d');
  await tick(pickupPage, 1000 * 3 / 30);
  const beforePickup = await state(pickupPage);
  assert.equal(beforePickup.players[0].x, 4);
  assert.ok(beforePickup.playerVisuals.p1.x < 3.5 && beforePickup.items.some(capacityDrop));
  await tick(pickupPage, 100);
  const afterPickup = await state(pickupPage);
  assert.ok(afterPickup.playerVisuals.p1.x >= 3.5 && !afterPickup.items.some(capacityDrop));
  assert.equal(afterPickup.players[0].capacity, 2);
  await pickupPage.close();

  const latePage = await setup(hosts[0], 'late corner');
  await tick(latePage, 0);
  await latePage.locator('#start-btn').click();
  await drive(latePage, 's', 200);
  await tick(latePage, 100);
  assert.equal((await state(latePage)).players[0].y, 2);
  await latePage.keyboard.down('s');
  await latePage.keyboard.down('d');
  await tick(latePage, 1000 / 30);
  const continuing = (await state(latePage)).players[0];
  assert.ok(continuing.y === 3 && continuing.step.direction === 'down');
  await tick(latePage, 1000 * 2 / 30);
  const preferredTurn = (await state(latePage)).players[0];
  assert.deepEqual(preferredTurn.step.corner, { x: 1, y: 3 });
  assert.equal(preferredTurn.step.direction, 'right');
  await latePage.screenshot({ path: output + '/08-held-directions.png' });
  await latePage.keyboard.up('s');
  await tick(latePage, 400);
  await latePage.keyboard.up('d');
  await tick(latePage, 200);
  await drive(latePage, 'w', 200);
  await tick(latePage, 100);
  await drive(latePage, 's', 1000 * 8 / 30);
  const past = (await state(latePage)).players[0];
  assert.ok(past.y === 4 && past.step.passedCenter);
  await latePage.keyboard.press('a');
  await tick(latePage, 100);
  const recovered = await state(latePage);
  assert.deepEqual(recovered.players[0].step.corner, { x: 3, y: 3 });
  assert.ok(recovered.players[0].step.from.y > 3);
  assert.ok(recovered.playerVisuals.p1.x < 3 && recovered.playerVisuals.p1.y > 3);
  await latePage.screenshot({ path: output + '/07-late-corner.png' });
  await latePage.close();

  await host.locator('#online-button').click();
  await host.locator('#online-name').fill('Pip');
  await host.locator('#create-room').click();
  await host.locator('.room-code').waitFor();
  const invite = host.url();
  const code = await host.locator('.room-code').textContent();
  assert.ok(invite.endsWith(code));
  const guest = await setup(hosts[1], 'guest', invite, true);
  await guest.locator('#online-name').fill('Bramble');
  await guest.locator('#join-room').click();
  await guest.locator('.room-code').waitFor();
  await host.waitForFunction(() => document.querySelectorAll('.room-member').length === 2);
  const extra = await Promise.all(['Moss', 'Button'].map(name => setup(hosts[1], name)));
  for (const [i, page] of extra.entries()) {
    await page.locator('#online-button').click();
    await page.locator('#online-name').fill(i === 0 ? 'Moss' : 'Button');
    await page.locator('#join-code').fill(code);
    await page.locator('#join-room').click();
    await page.locator('.room-code').waitFor();
  }
  await host.waitForFunction(() => document.querySelectorAll('.room-member').length === 4);
  await host.screenshot({ path: output + '/03-private-room.png' });
  await Promise.all([guest, ...extra].map(page => page.locator('#room-ready').click()));
  await host.locator('#room-ready').click();
  await host.locator('#room-start').click();
  await Promise.all([host, guest].map(page => page.waitForFunction(() => {
    const s = JSON.parse(window.render_game_to_text());
    return s.phase === 'match' && s.players.length === 4 && s.tick > 4;
  })));
  const hostId = (await state(host)).you[0];
  await host.keyboard.down('s');
  await host.waitForFunction(id => {
    const s = JSON.parse(window.render_game_to_text());
    return s.playerVisuals[id]?.y > 1.25;
  }, hostId);
  await host.keyboard.up('s');
  await host.keyboard.press('d');
  await host.waitForFunction(id => {
    const s = JSON.parse(window.render_game_to_text());
    const player = s.players.find(p => p.id === id);
    return player.step?.direction === 'right' && player.step?.corner?.y === 3;
  }, hostId);
  const cornerGuest = extra[0];
  const cornerId = (await state(cornerGuest)).you[0];
  await cornerGuest.keyboard.down('s');
  await cornerGuest.waitForFunction(id => {
    const s = JSON.parse(window.render_game_to_text());
    return s.playerVisuals[id]?.y > 3.08;
  }, cornerId);
  await cornerGuest.keyboard.press('a');
  await cornerGuest.keyboard.up('s');
  await host.waitForFunction(id => {
    const s = JSON.parse(window.render_game_to_text());
    const player = s.players.find(p => p.id === id);
    return player.step?.direction === 'left' && player.step.corner?.y === 3 && player.step.from.y > 3;
  }, cornerId);

  const twoKeyGuest = extra[1];
  const twoKeyId = (await state(twoKeyGuest)).you[0];
  await twoKeyGuest.keyboard.down('w');
  await twoKeyGuest.waitForFunction(id => {
    const s = JSON.parse(window.render_game_to_text());
    return s.players.find(p => p.id === id).y === 2;
  }, twoKeyId);
  await twoKeyGuest.keyboard.up('w');
  await twoKeyGuest.waitForFunction(id => {
    const s = JSON.parse(window.render_game_to_text());
    const p = s.players.find(p => p.id === id);
    return p.y === 2 && s.tick > p.moveAt;
  }, twoKeyId);
  await twoKeyGuest.evaluate(() => {
    for (const code of ['KeyW', 'KeyD']) window.dispatchEvent(new KeyboardEvent('keydown', { code, cancelable: true }));
  });
  await host.waitForFunction(id => {
    const s = JSON.parse(window.render_game_to_text());
    const p = s.players.find(p => p.id === id);
    return p.step?.direction === 'right' && p.step.corner?.x === 3 && p.step.corner?.y === 1;
  }, twoKeyId);
  await twoKeyGuest.evaluate(() => {
    for (const code of ['KeyW', 'KeyD']) window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  });

  const initial = await state(guest);
  const guestId = initial.you[0];
  const guestX = initial.players.find(player => player.id === guestId).x;
  const sentBeforeNextFrame = await guest.evaluate(() => {
    const originalSend = WebSocket.prototype.send;
    let sent = false;
    WebSocket.prototype.send = function (data) {
      const packet = JSON.parse(data);
      if (packet.type === 'input' && packet.turn === 'right') sent = true;
      return originalSend.call(this, data);
    };
    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', cancelable: true }));
      return sent;
    } finally {
      WebSocket.prototype.send = originalSend;
    }
  });
  assert.ok(sentBeforeNextFrame, 'fresh online input is sent inside the key event');
  await Promise.all([guest, host].map(page => page.waitForFunction(({ id, x }) => {
    const s = JSON.parse(window.render_game_to_text());
    const drawn = s.playerVisuals[id]?.x;
    return drawn > x && drawn < x + 1;
  }, { id: guestId, x: guestX })));
  await guest.waitForFunction(x => {
    const s = JSON.parse(window.render_game_to_text());
    return s.players.find(player => player.id === s.you[0]).x > x;
  }, guestX);
  await guest.keyboard.up('d');
  await guest.keyboard.press('Space');
  await host.waitForFunction(() => JSON.parse(window.render_game_to_text()).bombs.length === 1);
  await guest.waitForFunction(() => JSON.parse(window.render_game_to_text()).bombs.length === 1);
  await guest.screenshot({ path: output + '/04-online-coop.png' });

  await guest.reload();
  await guest.waitForFunction(() => {
    if (typeof window.render_game_to_text !== 'function') return false;
    const s = JSON.parse(window.render_game_to_text());
    return s.phase === 'match' && s.players.some(player => player.id === s.you[0]) && s.tick > 12;
  });
  await guest.locator('#online-button').click();
  await guest.locator('#room-leave').click();
  await Promise.all(extra.map(async page => {
    await page.locator('#online-button').click();
    await page.locator('#room-leave').click();
    await page.close();
  }));
  await host.locator('#online-button').click();
  await host.locator('#room-leave').click();
  await host.locator('[data-mode="arena"]').click();
  await host.locator('#map-button').click();
  await host.selectOption('#set-arena', 'ice');
  await host.selectOption('#set-difficulty', 'hard');
  await host.locator('#save-arena').click();
  assert.equal(await host.locator('h1').textContent(), 'Frosthollow Arena');
  await host.locator('#start-btn').click();
  await drive(host, 'd', 450);
  await tick(host, 4800);
  assert.ok((await state(host)).tick > 100);
  await host.screenshot({ path: output + '/05-arena.png' });
  assert.deepEqual(errors, []);
  console.log('Passed: fuse meter, connected blast caps, pickup timing, two-key wall fallback and early and late corners in local and online play, smooth slides, one-heart knockout and exposed item destruction, local 2P checkpoint, remap, four-seat room in two Chromium processes, direct code and invite joins, shared bomb under added latency, reload/rejoin, custom arena');
} finally {
  await Promise.all(hosts.map(browser => browser.close()));
}
