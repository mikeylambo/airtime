/**
 * The Visual Ceiling probe (airtime-visual-ceiling-prototype.md).
 *
 * "How far can our existing stack go?" — answered with numbers on one bounded
 * scene, on the real machine, before committing to any renderer upgrade. Same
 * discipline as probe:drift: a measurement, not a redesign. It touches nothing
 * in src/ and drives the built game exactly as every clip does.
 *
 *   npm run build && node tools/probe-ceiling.mjs --headful   ← the real run
 *   node tools/probe-ceiling.mjs                               ← software floor
 *
 * Run it --headful on BOTH machines (the Mac and the PC) and keep both outputs:
 * the whole point of Item 0 is to resolve, verbatim, which GPU each one actually
 * has, before any Ultra-tier number is trusted.
 *
 * The scene (spike §"The scene"): one car, one near-black arena, one scripted
 * jump and landing — the AFTERGLOW solo `loop`, which is that single moment and
 * nothing else. Measured across a resolution/effect envelope so the tiers are
 * derived from real frame time, not assumed.
 *
 * What this scaffold does NOT do yet, and says so rather than faking: the
 * WebGPU + TSL renderer path does not exist in the build (the game runs
 * three.js WebGLRenderer), so the side-by-side WebGPU-vs-WebGL frame-time
 * comparison from the spike cannot be measured here. This probe reports whether
 * WebGPU is even available on the machine (adapter + limits), which is the
 * prerequisite that gates that work, and leaves the comparison as the explicit
 * next step. Everything the *current* renderer can tell us about the ceiling,
 * it measures for real.
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
const LOWPOWER = process.argv.includes('--low-power');
const FRAMES = Number((process.argv.find((a) => a.startsWith('--frames=')) || '').split('=')[1] || 180);

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('no dist/ — run `npm run build` first');
  process.exit(1);
}

// ── The tiers, as (resolution × effect density) on the current renderer ──────
// ULTRA/HIGH/STANDARD/REDUCED are named after the spike's ladder, but the
// numbers that place a machine in one come from the measured frame time here,
// not from these labels. STANDARD is the current PLAY target (1080p, full
// effects); REDUCED is the accessibility floor; HIGH and ULTRA push resolution
// past PLAY, which is the CAPTURE direction this scene is meant to probe.
// Ordered lightest → heaviest on purpose: the PLAY-target and floor numbers are
// the ones a verdict rests on, so they are captured before the 4K tier — which,
// on a software rasteriser, can be heavy enough to take the browser down with
// it — gets a chance to fail. Each tier is measured independently so one that
// dies does not cost the ones already recorded.
const TIERS = [
  { name: 'REDUCED ', width: 1920, height: 1080, scale: 1, reduce: true, note: '1080p, Reduce Effects (a11y floor)' },
  { name: 'STANDARD', width: 1920, height: 1080, scale: 1, reduce: false, note: '1080p, full effects (PLAY target)' },
  { name: 'HIGH    ', width: 2560, height: 1440, scale: 1, reduce: false, note: '1440p, full effects' },
  { name: 'ULTRA   ', width: 3840, height: 2160, scale: 1, reduce: false, note: '4K, full effects' },
];

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

// Headless has no GPU: rasterise on the CPU and be consistent about it, exactly
// like probe:perf. Headful is left alone so the machine's own driver serves the
// frames — the only mode whose numbers mean anything for a ceiling.
const browser = await puppeteer.launch({
  headless: !HEADFUL,
  args: [
    '--no-sandbox',
    ...(HEADFUL ? [] : ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader']),
    ...(LOWPOWER ? ['--force_low_power_gpu'] : []),
    '--enable-unsafe-webgpu',   // so the adapter probe below can see WebGPU where the build supports it
    '--window-size=1920,1080',
  ],
  defaultViewport: { width: 1920, height: 1080 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`http://127.0.0.1:${port}/?capture`, { waitUntil: 'load' });
await page.waitForFunction('window.AIRTIME && window.AIRTIME.ready', { timeout: 90000 });

// ── Item 0: the real renderer string, verbatim ──────────────────────────────
// The live contradiction the spike opens on ("discrete GPU or not?") is settled
// here and nowhere else. Read off the actual context, never assumed.
const RENDERER = await page.evaluate(() => {
  const gl = window.AIRTIME.game.renderer.getContext();
  const d = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    unmasked: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown',
    vendor: d ? gl.getParameter(d.UNMASKED_VENDOR_WEBGL) : 'unknown',
    version: gl.getParameter(gl.VERSION),
  };
});
const SOFTWARE = /swiftshader|llvmpipe|software|basic render/i.test(RENDERER.unmasked);

// ── WebGPU availability (the prerequisite for the TSL path) ──────────────────
const WEBGPU = await page.evaluate(async () => {
  if (!('gpu' in navigator)) return { available: false, reason: 'navigator.gpu absent' };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { available: false, reason: 'requestAdapter() returned null' };
    const info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
    return {
      available: true,
      vendor: info.vendor || '(unreported)',
      architecture: info.architecture || '(unreported)',
      description: info.description || '(unreported)',
      maxTextureDimension2D: adapter.limits ? adapter.limits.maxTextureDimension2D : null,
    };
  } catch (e) { return { available: false, reason: String(e && e.message || e) }; }
});

async function measure({ width, height, scale, reduce }) {
  await page.setViewport({ width, height, deviceScaleFactor: scale });
  return page.evaluate(async ({ reduce, FRAMES }) => {
    const g = window.AIRTIME.game;
    window.AIRTIME.setOption('reduceEffects', reduce);
    // One car, one scripted jump and landing, near-black AFTERGLOW: the scene.
    await g.beginCapture({ script: 'loop', players: 1, style: 'afterglow', fps: 60, start: 3 });
    for (let i = 0; i < 30; i++) g.captureStep();          // warm-up: shader compile
    const times = [];
    for (let i = 0; i < FRAMES; i++) {
      const t0 = performance.now();
      g.captureStep();
      times.push(performance.now() - t0);
    }
    const live = g.trails ? (g.trails.live | 0) : 0;
    g.endCapture();
    times.sort((a, b) => a - b);
    return { avg: times.reduce((a, b) => a + b, 0) / times.length, p95: times[Math.floor(times.length * 0.95)], live };
  }, { reduce, FRAMES });
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log('── probe:ceiling · one car, one jump, one landing · AFTERGLOW ──\n');
console.log('   Item 0 — the machine, read off the live context (record this verbatim):');
console.log(`     WebGL renderer : ${RENDERER.unmasked}${SOFTWARE ? '   ⚠ SOFTWARE RASTERISER' : ''}`);
console.log(`     WebGL vendor   : ${RENDERER.vendor}`);
console.log(`     WebGL version  : ${RENDERER.version}`);
console.log(`     WebGPU         : ${WEBGPU.available
  ? `available — ${WEBGPU.vendor} / ${WEBGPU.architecture} ${WEBGPU.description !== '(unreported)' ? '(' + WEBGPU.description + ')' : ''}  maxTex2D=${WEBGPU.maxTextureDimension2D}`
  : `NOT available (${WEBGPU.reason})`}`);
console.log('');

if (!HEADFUL) {
  console.log('   NOTE  headless — frames served by a software rasteriser. The tier table below is a');
  console.log('         pessimistic CPU floor, not a GPU verdict. Re-run with --headful on the target');
  console.log('         machine (and again on the other one) for numbers that mean anything.\n');
} else if (SOFTWARE) {
  console.log('   INVALID  --headful but a software rasteriser served the frames — no GPU here to reach.');
  console.log('            Run on a machine with a display and a real driver.\n');
}

console.log('   tier      resolution   effects              avg ms   fps    p95 ms   ribbon   real-time?');
for (const tier of TIERS) {
  let r;
  try {
    r = await measure(tier);
  } catch (e) {
    // A tier that takes the browser down (a software rasteriser at 4K can) must
    // not erase the tiers already measured — report it and move on.
    console.log(`   ${tier.name}  ${String(tier.width + '×' + tier.height).padEnd(11)}  ${tier.note.padEnd(19)}  render failed (${String(e && e.message || e).split('\n')[0].slice(0, 40)})`);
    break;   // the target is gone; nothing after this can run either
  }
  const fps = 1000 / r.avg;
  // PLAY-eligible if it clears 60fps solo; otherwise CAPTURE-only. On a software
  // floor this reads pessimistically, which is why the verdict needs --headful.
  const rt = HEADFUL && !SOFTWARE ? (fps >= 60 ? 'PLAY 60+' : fps >= 45 ? 'PLAY 45+' : 'CAPTURE') : '—';
  console.log(`   ${tier.name}  ${String(tier.width + '×' + tier.height).padEnd(11)}  ${tier.note.padEnd(19)}  ` +
    `${r.avg.toFixed(1).padStart(6)}  ${fps.toFixed(0).padStart(4)}   ${r.p95.toFixed(1).padStart(6)}   ${String(r.live).padStart(5)}    ${rt}`);
}

console.log('\n   The WebGPU + TSL path (spike items 1–3: presence shader, Ultra material, the');
console.log('   side-by-side frame-time comparison) is NOT measured here — the build has no WebGPU');
console.log('   renderer to measure against. The WebGPU line above is the availability check that');
console.log('   gates building one. That renderer path is the next step this scaffold hands off to.');

try { await browser.close(); } catch { /* already gone */ }
server.close();

// A scaffold, not a pass/fail gate: it reports the machine and the envelope so a
// human can derive the tiers. The only failure it asserts is the one that makes
// every number a lie — a --headful run that a software rasteriser served.
if (HEADFUL && SOFTWARE) {
  console.log('\nINVALID  --headful on a software rasteriser. No ceiling verdict from this run.');
  process.exit(2);
}
console.log(`\nOK  ${HEADFUL ? 'ceiling measured on ' + RENDERER.unmasked : 'software floor recorded — re-run --headful on each real machine'}.`);
process.exit(0);
