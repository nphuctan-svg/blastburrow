# Blastburrow

An original pixel-art bomb-grid adventure for desktop and mobile browsers. Clear the burrows solo, share a keyboard with a friend, or invite up to three friends to a private online room.

**[Play online](https://blastburrow.merecabin4.chatgpt.site/)**

## Play locally

Open [Play Blastburrow.command](Play%20Blastburrow.command), or run the following with Node.js 22.13 or newer.

```sh
npm ci
npm run dev
```

Open [Blastburrow on localhost](http://127.0.0.1:4317). Keep the Terminal window open while you play.

| Player | Move | Plant a bomb |
| --- | --- | --- |
| 1 | W A S D | Space |
| 2 | Arrow keys | Enter |

Turn into an open lane while you’re still sliding. With two directions held, the latest key takes priority and the other keeps you moving when that lane is blocked. An early turn waits for an opening, and a slightly late turn can catch the corner just behind you. Damage and pickups follow the tile under your character. Bombs snap to that same grid. The fuse bar shrinks until detonation, and flames link along the tiles they reach. Use **Controls** to rebind keys for either player. **F** toggles fullscreen, unless assigned to a game control. **Esc** pauses local play. The speaker button enables the original synthesized music and effects.

Players and arena bots can pass through each other. Terrain and planted bombs block movement.

## Game modes

- **Adventure** has 24 missions across six regions, with 78 chambers, six bosses, and 12 hidden discoveries. Pick any mission from the world map and burrow trail, or from the online lobby. Rootwarren opens with three hand-built chambers in Beneath the Bramble. Use a nook to escape a blast, draw a moth into the bomb lane, then chain two marked charges to open a root gate. Two local players share the campaign board and earn progress separately.
- **Arena** has six boards, two to four contestants, free-for-all and 2v2, and three bot difficulties. Change the fuse speed and crate density under **Customize**. Every critter and gadget is available in Arena.
- **Expeditions** rotate by seed on Mondays at 00:00 UTC. Cleared campaign missions also unlock timed score challenges in the **Journal**.
- **Loadout** shows each gadget’s tradeoff and which levels unlock it. Fresh missions and arena rounds start with one tile of base bomb reach. Break crates to discover upgrades. Arena powerups reset each round. Adventure powerups carry between chambers in a mission. Each player starts with one heart. A rare heart pickup lets you survive one hit, and you can carry one spare at a time. Bombs destroy exposed pickups. Loot inside a crate survives the blast that uncovers it. A wipe restarts the current chamber and restores the supplies you had when you entered it.

Progress belongs to the browser profile. Each local seat keeps its own XP, unlocks, and discoveries. Visit the game once while online and let the browser cache it before you travel. Offline campaign rewards sync on your next connected visit. Clearing site data removes access to the browser’s profiles.

## Play with friends

Open the same HTTPS game address in each browser. Choose **Play Online**, create a room, then copy the invite link or share the eight-character room code. Everyone picks **Ready** before the host starts. Each browser plays one seat. If you lose the connection, keep the game open to reconnect, or reload the invite address in the same browser within 60 seconds.

On a phone, hold the directional pad to move and tap **Bomb** with your other thumb. Slide across the pad to turn. Both portrait and landscape support touch play.

To install on an iPhone, open the game in Safari and tap **Share → Add to Home Screen**. Turn on **Open as Web App** if shown, then tap **Add**. Launch from the new icon for play without Safari’s toolbar.

A localhost link only works on the Mac running the server. For internet play, use one HTTPS host with a persistent SQLite volume.

1. Point a DNS record at the host and allow ports 80 and 443.
2. Set `BURROW_DOMAIN` to the hostname and build the two-service deployment.

   ```sh
   BURROW_DOMAIN=burrow.example.com docker compose up -d --build
   ```

3. Open the HTTPS address and check `/health`. Back up the `burrow-state` volume.

Caddy terminates HTTPS and forwards WebSocket traffic to Node. Rooms save their last chamber checkpoint in SQLite. After a restart, the original party can rejoin by code, ready up, and resume from that checkpoint. The default room retention is 24 hours.

## Verification

```sh
npm run typecheck
npm test
npx playwright install chromium
```

Start a local server before the browser checks. Set `BURROW_TEST_URL` if it runs on another port.

```sh
node scripts/smoke-browser.mjs
node scripts/campaign-browser.mjs
BURROW_FULL_CAMPAIGN=1 node scripts/campaign-browser.mjs
node scripts/online-campaign.mjs
```

The campaign replay scripts drive the visible game using keyboard inputs. The online run uses two separate Chromium processes and moves in real time. Browser checks save screenshots under `qa/`.
