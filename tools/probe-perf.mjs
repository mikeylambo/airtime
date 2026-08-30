/**
 * The AFTERGLOW perf gate: "60fps on an integrated-GPU machine, 1080p, single
 * player; ≥45fps 4-way split. Measured, not eyeballed."
 *
 * Drives the built game frame by frame (the same deterministic capture API
 * every clip uses) and times the whole pipeline — sim steps, smear, render —
 * per frame at 1920×1080, solo and 4-way, full effects and Reduce Effects.
 *
 * Headless CI has no GPU: SwiftShader renders on the CPU, so the absolute
 * numbers here are a *pessimistic floor*, not the target machine. The gate's
 * verdict comes from running this on real hardware:
 *
 *   npm run build && node tools/probe-perf.mjs --headful
 *
 * Either way the relative story — solo vs split, full vs reduced — is real.
 *
 * `--headful` has to *stop forcing SwiftShader*, which is not automatic and
 * was wrong here for two builds: the launch args pinned ANGLE to the software
 * rasteriser unconditionally, so `--headful` opened a real window, rendered
 * every frame on the CPU anyway, printed "REAL GPU" and issued a verdict on a
 * number it had no business issuing one on. The renderer string is now read
 * back off the live context and printed, and a software rasteriser under
 * `--headful` is refused rather than graded — a perf gate that can quietly
 * measure the wrong machine is worse than no perf gate.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm' };
const HEADFUL = process.argv.includes('--headful');
const FRAMES = Number((process.argv.find((a) => a.startsWith('--frames=')) || '').split('=')[1] || 240);
// On a laptop with two GPUs the browser takes the fast one, which is not the
// machine the bar is written about. This asks macOS/Chromium for the low-power
// adapter; whether it worked is not assumed, it is read back off the context
// and printed with everything else.
const LOWPOWER = process.argv.includes('--low-power');
// Each configuration is timed back to back, so a laptop that heats up over the
// four runs charges the difference to whichever ran last. Repeating the whole
// list makes that visible instead of letting it read as a result.
const REPEAT = Number((process.argv.find((a) => a.startsWith('--repeat=')) || '').split('=')[1] || 1);

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('no dist/ — run `npm run build` first');
  process.exit(1);
}

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

// Headless has no GPU to reach for, so it is told to rasterise on the CPU and
// be consistent about it. Headful must be left alone: the whole point of the
// flag is that the machine's own driver serves the frames.
const browser = await puppeteer.launch({
  headless: !HEADFUL,
  args: [
    '--no-sandbox',
    ...(HEADFUL ? [] : ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader']),
    ...(LOWPOWER ? ['--force_low_power_gpu'] : []),
    '--window-size=1920,1080',
  ],
  defaultViewport: { width: 1920, height: 1080 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`http://127.0.0.1:${port}/?capture`, { waitUntil: 'load' });
await page.waitForFunction('window.AIRTIME && window.AIRTIME.ready', { timeout: 90000 });

async function measure(label, { players, script, reduce }) {
  return page.evaluate(async ({ players, script, reduce, FRAMES }) => {
    const g = window.AIRTIME.game;
    window.AIRTIME.setOption('reduceEffects', reduce);
    await g.beginCapture({ script, players, style: 'afterglow', fps: 60, start: 3 });
    // Warm-up: shaders compile on first sight of each material.
    for (let i = 0; i < 30; i++) g.captureStep();
    const times = [];
    for (let i = 0; i < FRAMES; i++) {
      const t0 = performance.now();
      g.captureStep();
      times.push(performance.now() - t0);
    }
    const live = g.trails.live | 0;
    g.endCapture();
    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    return { avg, p95: times[Math.floor(times.length * 0.95)], live };
  }, { players, script, reduce, FRAMES });
}

const runs = [
  ['solo, full effects   ', { players: 1, script: 'loop', reduce: false }],
  ['solo, reduce effects ', { players: 1, script: 'loop', reduce: true }],
  ['4-way, full effects  ', { players: 4, script: 'split', reduce: false }],
  ['4-way, reduce effects', { players: 4, script: 'split', reduce: true }],
];

// Not what we asked for — what actually served the frames.
const RENDERER = await page.evaluate(() => {
  const gl = window.AIRTIME.game.renderer.getContext();
  const d = gl.getExtension('WEBGL_debug_renderer_info');
  return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
const SOFTWARE = /swiftshader|llvmpipe|software|basic render/i.test(RENDERER);

console.log(`── probe:perf · 1920×1080 · ${FRAMES} frames each ──`);
console.log(`   renderer: ${RENDERER}${SOFTWARE ? '  (software rasteriser)' : ''}\n`);
const out = {};
const passes = [];
for (let pass = 0; pass < REPEAT; pass++) {
  // Reversed on every other pass. If a configuration is slower only when it
  // runs late, that is the machine warming up and not the configuration.
  const order = pass % 2 ? [...runs].reverse() : runs;
  if (REPEAT > 1) console.log(`  pass ${pass + 1}/${REPEAT}${pass % 2 ? '  (reversed)' : ''}`);
  const seen = {};
  for (const [label, cfg] of order) {
    const r = await measure(label, cfg);
    seen[label.trim()] = r;
    // The last pass is the one the verdict is taken on, so it is the one kept.
    out[label.trim()] = r;
    console.log(`${REPEAT > 1 ? '  ' : ''}${label}  avg ${r.avg.toFixed(1).padStart(6)} ms (${(1000 / r.avg).toFixed(0).padStart(3)} fps)` +
      `  p95 ${r.p95.toFixed(1).padStart(6)} ms  ribbon quads ${r.live}`);
  }
  passes.push(seen);
}

// Same configuration, different pass: how much the machine itself drifted.
if (REPEAT > 1) {
  console.log('\n  drift between passes (same configuration, so this is the machine, not the build)');
  for (const [label] of runs) {
    const k = label.trim();
    const ms = passes.map((p) => p[k].avg);
    const spread = Math.max(...ms) - Math.min(...ms);
    console.log(`  ${label}  ${ms.map((m) => m.toFixed(1)).join(' → ')} ms   spread ${spread.toFixed(1)} ms`);
  }
}

await browser.close();
server.close();

const solo = out['solo, full effects'];
const split = out['4-way, full effects'];
if (HEADFUL && SOFTWARE) {
  // A verdict here would be a lie with a number attached.
  console.log('\nINVALID  --headful, but the frames were served by a software rasteriser.');
  console.log('         No GPU verdict from this run. On a headless box (a cloud');
  console.log('         session, a container, a server with no display) there is no');
  console.log('         driver to reach; run it on the target machine instead.');
  process.exit(2);
} else if (HEADFUL) {
  const ok = 1000 / solo.avg >= 60 && 1000 / split.avg >= 45;
  console.log(ok
    ? '\nPASS  60fps solo, ≥45fps 4-way at 1080p on this machine'
    : '\nFAIL  under the art-gate perf bar on this machine');
  process.exit(ok ? 0 : 1);
} else {
  console.log('\nNOTE  software floor recorded; the gate verdict needs --headful on the target machine.');
  process.exit(0);
}
