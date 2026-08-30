/**
 * Records the Gate A clips.
 *
 * Drives the built game frame by frame through the deterministic capture API
 * in src/main.js, so every clip is the *same* jump — same seed, same fixed
 * timestep, same input script — shot under a different camera behaviour or a
 * different art style. That is what makes the three camera clips comparable at
 * all: nothing varies except the thing being judged.
 *
 *   node tools/capture.mjs                 all clips, headless
 *   node tools/capture.mjs --headful       use the real GPU (much faster)
 *   node tools/capture.mjs --only orbit    one clip
 *   node tools/capture.mjs --fps 30 --seconds 10
 */

import { createServer } from 'node:http';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import ffmpegPath from 'ffmpeg-static';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'capture');
// Kept only to sweep up after older runs that wrote frames to disk.
const LEGACY_FRAMES = join(OUT, 'frames');

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const has = (n) => argv.includes(`--${n}`);

const FPS = Number(flag('fps', 30));
const SECONDS = Number(flag('seconds', 10));
const WIDTH = Number(flag('width', 1280));
const HEIGHT = Number(flag('height', 720));
const ONLY = flag('only', null);
const HEADFUL = has('headful');

// Each clip names what it is proving.
const CLIPS = [
  { id: 'loop', behavior: null, style: 'afterglow', hud: true, seconds: 12, start: 2.4,
    caption: 'R1 — one cycle: boost, launch, stack facets, land, cash out' },
  // R7 is the phase whose gate is "judged on footage", so it gets a clip whose
  // whole job is to show it: a long run at speed for the streaks, a launch, a
  // landing that shakes, and whatever the driver does to itself afterwards.
  { id: 'premium', behavior: null, style: 'afterglow', hud: true, script: 'loop', seconds: 16, start: 1.2,
    caption: 'R7 — speed lines, tyre smoke, landing dust and shake, crash debris' },
  { id: 'camera-chase-pullback', behavior: 'chase-pullback', style: 'afterglow', hud: true,
    caption: '§6 chase-pullback — eases back and up, wider FOV, car centred' },
  { id: 'camera-orbit', behavior: 'orbit', style: 'afterglow', hud: true,
    caption: '§6 orbit — one revolution on big airtime, resumes chase on descent' },
  { id: 'camera-target-lock', behavior: 'landing-target-lock', style: 'afterglow', hud: true,
    caption: '§6 landing-target lock — car and target framed together, dolly-zoom in' },
  { id: 'city', behavior: null, style: 'afterglow', hud: true, script: 'loop', arena: 'city', seconds: 14, start: 6,
    caption: 'R8 Vertical City — the centre is a pit; the Coil and the Stack are how you leave it' },
  // R10. Each arena's clip is the arena's own routing idea, not a tour of it.
  // Started from a vantage inside the arena. The scripted driver finds the
  // hero jump in The Yard and flails everywhere else, so a clip driven from
  // the spawn films the driver rather than the place. The driving is real;
  // only the starting position is chosen, and it is stated here rather than
  // hidden.
  { id: 'works', behavior: null, style: 'afterglow', hud: true, script: 'loop', arena: 'works', seconds: 12, start: 0.6,
    vantage: { pos: { x: 0, y: 56, z: -12 }, heading: 0, speed: 30 },
    caption: 'R10 Mega Works — off the plant, over the yard: the skip, the jib, the cranes' },
  { id: 'flood', behavior: null, style: 'afterglow', hud: true, script: 'loop', arena: 'flood', seconds: 12, start: 0.6,
    vantage: { pos: { x: -220, y: 26, z: -150 }, heading: -Math.PI / 2, speed: 34 },
    caption: 'R10 Floodway — down the top channel, banked walls returning the line' },
  { id: 'sky', behavior: null, style: 'afterglow', hud: true, script: 'loop', arena: 'sky', seconds: 12, start: 0.6,
    vantage: { pos: { x: 0, y: 78, z: 10 }, heading: 0, speed: 30 },
    caption: 'R10 Skyline — no ground under any of it; a missed landing is a demotion' },
  { id: 'split-screen', behavior: null, style: 'afterglow', hud: false, script: 'split',
    players: 3, seconds: 14, start: 4,
    caption: '§9 split-screen — three drivers, one world, one clock; per-viewport chase only' },
  // The art gate (airtime-art-direction.md): the deterministic hero jump in
  // AFTERGLOW, judged on footage. Graybox stays as the honest reference.
  { id: 'art-afterglow', behavior: 'chase-pullback', style: 'afterglow', hud: false,
    caption: 'Art gate — the hero jump in AFTERGLOW: trails, ghosts, stretch, splash' },
  { id: 'art-graybox', behavior: 'chase-pullback', style: 'graybox', hud: false,
    caption: 'Art gate — the same jump, lit gray box (diagnostic reference)' },
  // §A: Reduce Effects "must read as the same game", and that is a footage
  // question. The same hero jump, same seed, same camera, one switch flipped.
  { id: 'art-reduced', behavior: 'chase-pullback', style: 'afterglow', hud: false, reduce: true,
    caption: 'Accessibility — the same jump with REDUCE EFFECTS on; it has to read as the same game' },
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png' };

function serve(dir) {
  return new Promise((res) => {
    const server = createServer(async (req, rq) => {
      try {
        const url = decodeURIComponent(req.url.split('?')[0]);
        const file = join(dir, url === '/' ? 'index.html' : url);
        if (!file.startsWith(dir) || !existsSync(file)) { rq.writeHead(404); return rq.end('404'); }
        const body = await readFile(file);
        rq.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
        rq.end(body);
      } catch (e) { rq.writeHead(500); rq.end(String(e)); }
    });
    server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }));
  });
}

const pad = (n) => String(n).padStart(4, '0');

/**
 * An ffmpeg process fed frames as they are rendered.
 *
 * The old path wrote every frame to disk as a PNG and handed ffmpeg the pile
 * afterwards. At 480 frames of 1280x720 that is most of a gigabyte per clip,
 * and a run that dies mid-render — which happens, the renderer tab crashes on
 * the heaviest scenes — left all of it behind. Enough crashed runs and the
 * machine has no disk left, which is exactly how this session ended up unable
 * to run a shell command.
 *
 * Piping into stdin keeps the determinism that made frame-by-frame capture
 * worth doing in the first place (the sim is stepped at a fixed dt regardless
 * of how fast the machine is going) and costs one frame of disk instead of
 * five hundred.
 */
function openEncoder(id) {
  const mp4 = join(OUT, `${id}.mp4`);
  const proc = spawn(ffmpegPath, [
    '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  const err = [];
  let killed = false;
  proc.stderr.on('data', (d) => { err.push(d.toString()); if (err.length > 40) err.shift(); });
  const done = new Promise((res, rej) => {
    proc.on('close', (code) => {
      // A deliberate kill is not a failure. Rejecting here left an unhandled
      // rejection that killed the whole run over one bad clip — the opposite
      // of what the retry is for.
      if (killed) return res(null);
      if (code === 0) return res(mp4);
      console.error(err.join('').split('\n').slice(-12).join('\n'));
      rej(new Error(`ffmpeg failed for ${id}`));
    });
  });
  return {
    mp4,
    write: (buf) => new Promise((res) => {
      // Respect backpressure: ffmpeg encodes slower than the renderer produces
      // frames on an easy scene, and ignoring this buffers the whole clip in
      // memory instead of on disk, which is not an improvement.
      if (proc.stdin.write(buf)) res(); else proc.stdin.once('drain', res);
    }),
    finish: () => { proc.stdin.end(); return done; },
    kill: () => { killed = true; try { proc.stdin.destroy(); proc.kill('SIGKILL'); } catch { /* already gone */ } },
  };
}

/** A poster frame straight from a buffer, no intermediate file. */
async function poster(id, buf) {
  await writeFile(join(OUT, `${id}.png`), buf);
}

/**
 * A fresh browser per clip.
 *
 * A single long-lived page reliably died partway through the fourth clip —
 * "Target closed" mid-screenshot, every run, on whichever clip happened to be
 * fourth. Under software GL a page that has torn down and rebuilt an entire
 * arena several times eventually loses its context and never gets it back, and
 * nothing in this tool was going to fix that from inside the page.
 *
 * Launching per clip costs a few seconds of startup each and makes the whole
 * set reproducible in one command, which is the point of having the tool. It
 * also means one bad clip can no longer take the other eight with it.
 */
async function openRenderer(port) {
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    args: [
      '--no-sandbox', '--hide-scrollbars', '--mute-audio',
      '--enable-unsafe-swiftshader',
      `--window-size=${WIDTH},${HEIGHT}`,
      ...(HEADFUL ? [] : ['--use-gl=angle', '--use-angle=swiftshader']),
    ],
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('  page error:', e.message));
  await page.goto(`http://127.0.0.1:${port}/?capture=1`, { waitUntil: 'load' });
  await page.waitForFunction('window.AIRTIME && window.AIRTIME.ready', { timeout: 60000 });
  const renderer = await page.evaluate(() => {
    const gl = window.AIRTIME.game.renderer.getContext();
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  return { browser, page, renderer };
}

(async () => {
  if (!existsSync(join(DIST, 'index.html')) || has('build')) {
    console.log('building…');
    const b = spawnSync('npx', ['vite', 'build'], { cwd: ROOT, encoding: 'utf8' });
    if (b.status !== 0) { console.error(b.stdout, b.stderr); process.exit(1); }
  }

  const { server, port } = await serve(DIST);
  await mkdir(OUT, { recursive: true });

  console.log(`clips: ${WIDTH}x${HEIGHT} @ ${FPS}fps, ${SECONDS}s each\n`);

  const made = [];
  let announced = false;

  const failed = [];

  for (const clip of CLIPS) {
    if (ONLY && !clip.id.includes(ONLY)) continue;
    const total = FPS * (clip.seconds || SECONDS);
    const posterAt = Math.min(total - 1, Math.round(total * 0.62));

    // One retry, on a completely fresh browser. A lost GL context is not
    // something the next attempt inherits, so a retry is worth having; two
    // failures in a row means the clip itself is broken, and the run should
    // report that and keep going rather than lose the other eight.
    let mp4 = null, lastErr = null;
    for (let attempt = 0; attempt < 2 && !mp4; attempt++) {
      let browser = null, enc = null;
      const t0 = Date.now();
      try {
        // Inside the try: a browser that fails to launch is exactly the kind of
        // failure the retry exists for, and outside it took the run down.
        const r = await openRenderer(port);
        browser = r.browser;
        const page = r.page;
        if (!announced) { console.log(`renderer: ${r.renderer}\n`); announced = true; }
        enc = openEncoder(clip.id);
        await page.evaluate(async (c, fps) => {
          document.getElementById('boot')?.classList.add('gone');
          document.getElementById('screens').style.display = 'none';
          document.getElementById('hud').style.display = c.hud ? '' : 'none';
          if ((c.players || 1) > 1) document.getElementById('splithud').classList.remove('hidden');
          await window.AIRTIME.beginCapture({ behavior: c.behavior, style: c.style, fps, script: c.script || 'demo', arena: c.arena || 'park', start: c.start ?? null, players: c.players || 1, reduce: c.reduce ?? null, vantage: c.vantage ?? null });
        }, clip, FPS);

        for (let f = 0; f < total; f++) {
          await page.evaluate(() => window.AIRTIME.captureStep());
          const buf = await page.screenshot({ optimizeForSpeed: true });
          await enc.write(buf);
          if (f === posterAt) await poster(clip.id, buf);
          if (f % 60 === 0) {
            const rate = (f + 1) / ((Date.now() - t0) / 1000);
            const tag = attempt ? `${clip.id} (retry)` : clip.id;
            process.stdout.write(`\r  ${tag}  ${f}/${total} frames  (${rate.toFixed(1)} fps)   `);
          }
        }
        const secs = ((Date.now() - t0) / 1000).toFixed(0);
        process.stdout.write(`\r  ${clip.id}  ${total}/${total} frames in ${secs}s — encoding…      `);
        mp4 = await enc.finish();
        console.log(`\r  ${clip.id}  -> ${mp4.replace(ROOT + '/', '')}                    `);
      } catch (e) {
        // Never leave a half-written mp4 and a live ffmpeg behind.
        enc?.kill();
        lastErr = e;
        const why = String(e.message || e).split('\n')[0];
        console.log(`\r  ${clip.id}  ${attempt ? 'failed twice' : 'lost the renderer, retrying'} — ${why}          `);
      } finally {
        await browser?.close().catch(() => {});
      }
    }

    if (mp4) made.push({ ...clip, mp4 });
    else failed.push({ id: clip.id, why: String(lastErr?.message || lastErr).split('\n')[0] });
  }

  server.close();

  await writeFile(join(OUT, 'clips.json'), JSON.stringify(made, null, 2));
  if (failed.length) {
    console.log(`\n  ${failed.length} clip(s) did NOT render:`);
    for (const f of failed) console.log(`    · ${f.id} — ${f.why}`);
  }
  console.log(`\n${made.length} clips in capture/`);
})();
