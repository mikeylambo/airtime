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
  // R9's mastery layer and R11's creator screens. `board` became `boards` —
  // one screen with seven tabs — so the old shot pointed at a screen that no
  // longer exists.
  ['challenges', null],
  ['boards', null],
  ['ghosts', null],
  ['codes', null],
  ['gauntlet', null],
  ['options', null],
  ['run', 'run'],
  ['city', 'city'],
  // R10: the three arenas that did not exist when these exhibits were last
  // rendered. Each is shot from a run rather than from a menu, because what
  // is being exhibited is a routing idea rather than a skybox.
  ['works', 'works'],
  ['flood', 'flood'],
  ['sky', 'sky'],
  ['party', null],
  ['split3', 'split3'],
  ['split4', 'split4'],
  ['reel', 'reel'],
  ['scoreboard', 'scoreboard'],
  ['result', 'result'],
];

(async () => {
  if (!existsSync(join(DIST, 'index.html')) || has('build')) {
    const b = spawnSync('npx', ['vite', 'build'], { cwd: ROOT, encoding: 'utf8' });
    if (b.status !== 0) { console.error(b.stdout, b.stderr); process.exit(1); }
  }
  const { server, port } = await serve(DIST);
  // Only wipe on a full pass. `--only` exists to re-shoot one screen, and
  // deleting the other twenty-five to do it makes it useless for that.
  if (!ONLY) await rm(OUT, { recursive: true, force: true });
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
  await page.evaluate(() => {
    const g = window.AIRTIME.game;
    g.selectProfile(0);
    // These screens exhibit the *roster*, so the rig shows all of it. A shot
    // of the arena select with five rows greyed out documents a fresh save,
    // not the game.
    const p = g.profile;
    p.unlocked.arenas = window.AIRTIME.ARENAS.map((a) => a.id);
    p.unlocked.modes = window.AIRTIME.MODES.map((m) => m.id);
    p.unlocked.trials = ['gauntlet'];
    p.gauntlet = 7;
    g.saveProfiles();
  });

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
      } else if (sp === 'works' || sp === 'flood' || sp === 'sky') {
        await g.startRun(g.lastMode, window.AIRTIME.ARENAS.find((a) => a.id === sp));
        g.sim.run.begin();
        // Placed, not driven. The scripted driver finds the hero jump in The
        // Yard and flails everywhere else — in Skyline it never gets off the
        // deck, because the way up is a spiral it has no idea how to take —
        // so a driven shot of these arenas is a photograph of the driver's
        // limitations. A screenshot is a camera position, not a claim about
        // anybody's driving, so the car starts where the arena is.
        const VANTAGE = {
          works: { pos: { x: 0, y: 56, z: -12 }, heading: 0 },
          flood: { pos: { x: -190, y: 26, z: -150 }, heading: -Math.PI / 2 },
          sky: { pos: { x: 0, y: 78, z: 8 }, heading: 0 },
        }[sp];
        const p0 = g.sim.players[0];
        p0.place(VANTAGE.pos, VANTAGE.heading);
        const HZ = window.AIRTIME.TUNING.SIM.HZ;
        const f = p0.car.forward;
        p0.car.body.setLinvel({ x: f.x * 26, y: 0, z: f.z * 26 }, true);
        // A moment of driving so the camera settles behind the car rather
        // than snapping to a teleport — and only a moment, because ninety
        // frames was enough to reach the next kicker and launch, which framed
        // Floodway as an empty sky.
        for (let i = 0; i < 40; i++) {
          g.sim.step(1 / HZ, { ...g.input.actions, throttle: 1 }, {});
          g.sim.drainEvents();
        }
        return true;
      } else if (sp === 'split3' || sp === 'split4') {
        const n = sp === 'split4' ? 4 : 3;
        await g.startRun(g.lastMode, window.AIRTIME.ARENAS[0], { players: n });
        g.sim.round.begin();
        const HZ = window.AIRTIME.TUNING.SIM.HZ;
        // Give each driver a different line so the viewports are not identical.
        for (let i = 0; i < 520; i++) {
          const acts = g.sim.players.map((p, k) => ({
            ...g.input.actionsFor(k), throttle: 1, boost: true,
            steer: Math.sin((i / HZ) * 0.7 + k * 1.3) * 0.35,
          }));
          g.sim.step(1 / HZ, acts, g.sim.players.map(() => ({})));
          g.sim.drainEvents();
        }
        return true;
      } else if (sp === 'reel') {
        await g.startRun(g.lastMode, window.AIRTIME.ARENAS[0], { players: 1 });
        g.sim.round.begin();
        const HZ = window.AIRTIME.TUNING.SIM.HZ;
        for (let i = 0; i < 900; i++) g.stepFixed(1 / HZ);
        // Force a reel even if nothing crossed the auto-save threshold.
        if (!g.roundClips.length && g.recorder) {
          g.roundClips.push(g.recorder.clip(20, g.recorder.step, {
            total: 1234, quality: 'clean', tier: 'road', airtime: 2.9,
            tricks: ['360', 'LEFT DOOR'], arena: 'park', mode: 'stunt', player: 0,
          }, 0));
        }
        await g.startReel(() => {});
        for (let i = 0; i < 240; i++) g.stepFixed(1 / HZ);
        return true;
      } else if (sp === 'scoreboard') {
        g.inRun = false;
        g.screens.go('scoreboard', {
          kind: 'split',
          all: [
            { player: 0, score: 8420, landed: 7, jumps: 9, bestChain: 4, alive: true, best: { quality: 'perfect', total: 3100 } },
            { player: 1, score: 6110, landed: 5, jumps: 8, bestChain: 3, alive: true, best: { quality: 'clean', total: 2050 } },
            { player: 2, score: 2740, landed: 3, jumps: 7, bestChain: 2, alive: false, best: { quality: 'sloppy', total: 900 } },
          ],
        });
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
