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
const FRAMES = join(OUT, 'frames');

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
  { id: 'loop', behavior: null, style: 'neon', hud: true, script: 'loop', seconds: 20,
    caption: 'Gate B — the loop: earn boost in traffic, launch, trick, land, chain' },
  { id: 'camera-chase-pullback', behavior: 'chase-pullback', style: 'neon', hud: true,
    caption: '§6 chase-pullback — eases back and up, wider FOV, car centred' },
  { id: 'camera-orbit', behavior: 'orbit', style: 'neon', hud: true,
    caption: '§6 orbit — one revolution on big airtime, resumes chase on descent' },
  { id: 'camera-target-lock', behavior: 'landing-target-lock', style: 'neon', hud: true,
    caption: '§6 landing-target lock — car and target framed together, dolly-zoom in' },
  { id: 'city', behavior: null, style: 'neon', hud: true, script: 'loop', arena: 'city', seconds: 16, start: 66,
    caption: '§10b — the city block: rooftops, billboards, overpasses, traffic' },
  { id: 'art-graybox', behavior: 'chase-pullback', style: 'graybox', hud: false,
    caption: 'Art gate — the same jump, lit gray box' },
  { id: 'art-flat-lowpoly', behavior: 'chase-pullback', style: 'lowpoly', hud: false,
    caption: 'Art gate — the same jump, flat low-poly' },
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

async function encode(id, caption, frameCount) {
  const mp4 = join(OUT, `${id}.mp4`);
  const args = [
    '-y', '-framerate', String(FPS), '-i', join(FRAMES, '%04d.png'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4,
  ];
  const r = spawnSync(ffmpegPath, args, { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stderr?.split('\n').slice(-12).join('\n'));
    throw new Error(`ffmpeg failed for ${id}`);
  }
  // A poster frame from about a third in — mid-flight.
  const poster = Math.min(frameCount - 1, Math.round(frameCount * 0.62));
  spawnSync(ffmpegPath, ['-y', '-i', join(FRAMES, pad(poster)) + '.png',
    join(OUT, `${id}.png`)], { encoding: 'utf8' });
  return mp4;
}

(async () => {
  if (!existsSync(join(DIST, 'index.html')) || has('build')) {
    console.log('building…');
    const b = spawnSync('npx', ['vite', 'build'], { cwd: ROOT, encoding: 'utf8' });
    if (b.status !== 0) { console.error(b.stdout, b.stderr); process.exit(1); }
  }

  const { server, port } = await serve(DIST);
  await mkdir(OUT, { recursive: true });

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
  console.log(`renderer: ${renderer}`);
  console.log(`clips: ${WIDTH}x${HEIGHT} @ ${FPS}fps, ${SECONDS}s each\n`);

  const made = [];

  for (const clip of CLIPS) {
    if (ONLY && !clip.id.includes(ONLY)) continue;
    const total = FPS * (clip.seconds || SECONDS);
    await rm(FRAMES, { recursive: true, force: true });
    await mkdir(FRAMES, { recursive: true });

    await page.evaluate(async (c, fps) => {
      document.getElementById('boot')?.classList.add('gone');
      document.getElementById('screens').style.display = 'none';
      document.getElementById('hud').style.display = c.hud ? '' : 'none';
      await window.AIRTIME.beginCapture({ behavior: c.behavior, style: c.style, fps, script: c.script || 'demo', arena: c.arena || 'park', start: c.start ?? null });
    }, clip, FPS);

    const t0 = Date.now();
    for (let f = 0; f < total; f++) {
      await page.evaluate(() => window.AIRTIME.captureStep());
      await page.screenshot({ path: join(FRAMES, `${pad(f)}.png`), optimizeForSpeed: true });
      if (f % 60 === 0) {
        const rate = (f + 1) / ((Date.now() - t0) / 1000);
        process.stdout.write(`\r  ${clip.id}  ${f}/${total} frames  (${rate.toFixed(1)} fps)   `);
      }
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    process.stdout.write(`\r  ${clip.id}  ${total}/${total} frames in ${secs}s — encoding…      `);
    const mp4 = await encode(clip.id, clip.caption, total);
    console.log(`\r  ${clip.id}  -> ${mp4.replace(ROOT + '/', '')}                    `);
    made.push({ ...clip, mp4 });
  }

  await rm(FRAMES, { recursive: true, force: true });
  await browser.close();
  server.close();

  await writeFile(join(OUT, 'clips.json'), JSON.stringify(made, null, 2));
  console.log(`\n${made.length} clips in capture/`);
})();
