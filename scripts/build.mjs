import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';

await mkdir('dist/public', { recursive: true });
await cp('public', 'dist/public', { recursive: true, filter: path => !basename(path).startsWith('.') });
await Promise.all([
  build({ entryPoints: ['src/client.ts'], outfile: 'dist/public/game.js', bundle: true, target: 'es2022', format: 'esm' }),
  build({ entryPoints: ['src/server.ts'], outfile: 'dist/server/server.js', bundle: true, platform: 'node', target: 'node22', format: 'esm', packages: 'external' }),
  build({ entryPoints: ['src/engine.ts', 'src/content.ts'], outdir: 'dist/shared', bundle: true, platform: 'node', target: 'node22', format: 'esm' })
]);

const files = ['index.html', 'style.css', 'game.js', 'mark.svg', 'sw.js', 'app.webmanifest',
  'apple-touch-icon.png', 'app-icon-192.png', 'app-icon-512.png'];
const hash = createHash('sha256');
for (const file of files) hash.update(await readFile('dist/public/' + file));
const worker = await readFile('dist/public/sw.js', 'utf8');
await writeFile('dist/public/sw.js', worker.replace('__BUILD__', hash.digest('hex').slice(0, 16)));
