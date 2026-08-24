/**
 * Walks the frame (§2) and saves a PNG of every screen.
 *
 * Menus are DOM over a live 3D scene, so the only honest way to review them is
 * to look at them. This drives the real screen manager, not a mock.
 *
 *   node tools/shots.mjs                 all screens
 *   node tools/shots.mjs --only garage
 */
import { createServer } from 'node:http';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'capture', 'screens');
const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const ONLY = flag('only', null);
const WIDTH = 1280, HEIGHT = 720;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.mp4': 'video/mp4' };

function serve(dir) {
  return new Promise((res) => {
    const server = createServer(async (req, rq) => {
      try {
        const url = decodeURIComponent(req.url.split('?')[0]);
        const file = join(dir, url === '/' ? 'index.html' : url);
        if (!file.startsWith(dir) || !existsSync(file)) { rq.writeHead(404); return rq.end('404'); }
        rq.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
        rq.end(await readFile(file));
      } catch (e) { rq.writeHead(500); rq.end(String(e)); }
    });
    server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }));
  });
}

// name, and how to get the game into a state worth photographing.
const SHOTS = [
  ['title', null],
  ['profile', null],
  ['main', null],
  ['mode', null],
  ['arena', null],
  ['prerun', null],
  ['garage', null],
  ['licences', null],
  ['replays', null],
  ['board', null],
  ['options', null],
  ['run', 'run'],
  ['city', 'city'],
  ['result', 'result'],
];

(async () => {
  if (!existsSync(join(DIST, 'index.html')) || has('build')) {
    const b = spawnSync('npx', ['vite', 'build'], { cwd: ROOT, encoding: 'utf8' });
    if (b.status !== 0) { console.error(b.stdout, b.stderr); process.exit(1); }
  }
  const { server, port } = await serve(DIST);
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--hide-scrollbars', '--mute-audio', '--enable-unsafe-swiftshader',
           '--use-gl=angle', '--use-angle=swiftshader'],
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForFunction('window.AIRTIME && window.AIRTIME.ready', { timeout: 60000 });
  // Pick a profile so the menus have somebody to talk about.
  await page.evaluate(() => window.AIRTIME.game.selectProfile(0));

  for (const [name, special] of SHOTS) {
    if (ONLY && name !== ONLY) continue;
    const ok = await page.evaluate(async (n, sp) => {
      const g = window.AIRTIME.game;
      if (sp === 'run') {
        await g.startRun(g.lastMode, window.AIRTIME.ARENAS[0]);
        g.sim.run.begin();
        for (let i = 0; i < 560; i++) g.stepFixed(1 / window.AIRTIME.TUNING.SIM.HZ);
      } else if (sp === 'city') {
        await g.startRun(g.lastMode, window.AIRTIME.ARENAS.find((a) => a.id === 'city'));
        g.sim.run.begin();
        // Drive down the avenue far enough to be inside the block grid.
        for (let i = 0; i < 420; i++) {
          g.sim.step(1 / window.AIRTIME.TUNING.SIM.HZ, { ...g.input.actions, throttle: 1 }, {});
          g.sim.drainEvents();
        }
        return true;
      } else if (sp === 'result') {
        g.startRun(g.lastMode, g.lastArena);
        g.sim.run.begin();
        for (let i = 0; i < 900; i++) g.stepFixed(1 / window.AIRTIME.TUNING.SIM.HZ);
        g.endRun();
      } else {
        g.inRun = false;
        g.screens.go(n);
      }
      return sp ? true : g.screens.current?.name === n;
    }, name, special);

    // Let the transition finish and the world render a few frames.
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    console.log(`  ${ok ? '  ' : '??'} ${name}`);
  }

  await browser.close();
  server.close();
  if (errors.length) {
    console.log('\npage errors:');
    for (const e of [...new Set(errors)].slice(0, 8)) console.log('  ' + e);
  }
  console.log(`\nscreens in capture/screens/`);
})();
