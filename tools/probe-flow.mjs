/**
 * R4's gate: how long between a run ending and being back in the air?
 *
 * "Timer expires -> back in the air in under 3 seconds, one input." That is
 * three separate costs: rebuilding the world, the countdown, and whatever
 * screens sit in between. This measures the first two directly and states the
 * third, because a menu you can skip with one button is not downtime.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.mp4': 'video/mp4', '.wasm': 'application/wasm' };

const { server, port } = await new Promise((res) => {
  const s = createServer(async (req, rq) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const f = join(DIST, u === '/' ? 'index.html' : u);
    if (!existsSync(f)) { rq.writeHead(404); return rq.end(); }
    rq.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
    rq.end(await readFile(f));
  });
  s.listen(0, '127.0.0.1', () => res({ server: s, port: s.address().port }));
});

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  defaultViewport: { width: 640, height: 360 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
await page.waitForFunction('window.AIRTIME && window.AIRTIME.ready', { timeout: 60000 });

const out = await page.evaluate(async () => {
  const g = window.AIRTIME.game;
  const T = window.AIRTIME.TUNING;
  g.selectProfile(0);

  // Cold: the very first run of a session builds the world.
  await g.startRun(g.lastMode, g.lastArena, { players: 1 });
  const cold = g.lastStartMs;

  // Warm: same arena, same car, go again — the common case.
  const warm = [];
  for (let i = 0; i < 6; i++) {
    await g.restartNow();
    warm.push(g.lastStartMs);
  }

  // Changing the car has to rebuild, and should say so.
  g.saveProfiles();
  await g.restartNow();
  const dirty = g.lastStartMs;

  return {
    cold, warm, dirty,
    countdown: T.RUN.COUNTDOWN,
    reelSolo: T.UI.REEL_SOLO_SCORE,
  };
});

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
console.log('── from "again" to driving ──\n');
console.log(`first run of a session (builds the world)   ${out.cold.toFixed(1)} ms`);
console.log(`same arena, same car (reuses it)            ${mean(out.warm).toFixed(1)} ms  (worst ${Math.max(...out.warm).toFixed(1)})`);
console.log(`after a garage change (must rebuild)        ${out.dirty.toFixed(1)} ms`);
console.log(`countdown                                   ${out.countdown.toFixed(2)} s`);
const total = mean(out.warm) / 1000 + out.countdown;
console.log(`\ntotal, one input to airborne-capable:        ${total.toFixed(2)} s`);
console.log(`solo reel only interrupts above              ${out.reelSolo.toLocaleString()} points`);
console.log('inputs required: 1 (START, from the run, the reel or the result)');

const ok = total < 3 && mean(out.warm) < 30;
console.log(ok ? '\nPASS  one input, under three seconds' : '\nFAIL');
await browser.close(); server.close();
process.exit(ok ? 0 : 1);
