/**
 * The AFTERGLOW dark-frame rule, measured: "VOID/ASPHALT own ≥85% of any
 * frame … at the busiest moment (4 players, reactive traffic)."
 *
 * Drives the built game through the deterministic capture API and reads the
 * WebGL canvas back per frame, counting pixels below a luminance threshold.
 * The worst frame is the number that matters — a rule about "any frame"
 * gates on the minimum, not the average.
 *
 * Two scenarios: the hero jump (the art-gate clip itself), and a 4-way split
 * with reactive traffic — the busiest picture the game can draw.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };

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

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--mute-audio', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`http://127.0.0.1:${port}/?capture`, { waitUntil: 'load' });
await page.waitForFunction('window.AIRTIME && window.AIRTIME.ready', { timeout: 90000 });

/**
 * "Dark" = luminance under 40/255 — VOID (#0A0A12) and ASPHALT (#16161F)
 * both sit far below it, the dimmed traffic and legibility edges just under,
 * and anything the direction calls *light* (trails, trim, splash, coins,
 * billboards) well above.
 */
async function measure(label, { script, players, seconds, reduce = false }) {
  return page.evaluate(async ({ script, players, seconds, reduce }) => {
    const A = window.AIRTIME;
    const g = A.game;
    A.setOption('reduceEffects', reduce);
    await g.beginCapture({ script, players, style: 'afterglow', fps: 30, start: 2 });
    const src = g.renderer.domElement;
    const w = 320, h = 180;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    let worst = 1, worstT = 0, sum = 0, n = 0;
    const frames = Math.round(seconds * 30);
    for (let i = 0; i < frames; i++) {
      g.captureStep();
      ctx.drawImage(src, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h).data;
      let dark = 0;
      for (let p = 0; p < d.length; p += 4) {
        const y = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2];
        if (y < 40) dark++;
      }
      const frac = dark / (w * h);
      sum += frac; n++;
      if (frac < worst) { worst = frac; worstT = g.demoT; }
    }
    g.endCapture();
    A.setOption('reduceEffects', false);
    return { worst, worstT, mean: sum / n };
  }, { script, players, seconds, reduce });
}

const runs = [
  ['hero jump (art-gate clip)   ', { script: 'demo', players: 1, seconds: 10 }],
  ['4-way split, reactive traffic', { script: 'split', players: 4, seconds: 12 }],
];

console.log('── the ≥85% dark-frame rule, measured per frame (luma < 40/255) ──');
let ok = true;
const full = {};
for (const [label, cfg] of runs) {
  const r = await measure(label, cfg);
  full[label] = r;
  const pass = r.worst >= 0.85;
  ok = ok && pass;
  console.log(`${label}  worst frame ${(r.worst * 100).toFixed(1)}% dark (t=${r.worstT.toFixed(1)}s) · mean ${(r.mean * 100).toFixed(1)}%  ${pass ? 'ok' : 'UNDER'}`);
}

// ── §A: Reduce Effects can never make the picture brighter ─────────────────
// The accessibility toggle is binding, and the honest end-to-end statement of
// it is not "the trails are shorter" — it is that every frame is at least as
// dark as it was. Three emissive systems shipped ignoring the switch (the
// signs, the brake discs, the ghost) and nothing here could see it, because
// nothing here ever turned the switch on.
console.log('\n── the same frames with Reduce Effects on ──');
for (const [label, cfg] of runs) {
  const r = await measure(label, { ...cfg, reduce: true });
  const f = full[label];
  // A tolerance, because the two passes are separate captures of a
  // deterministic script through a rasteriser that is not bit-identical
  // frame to frame; brighter by a fifth of a percent is noise, brighter by
  // more is a system that ignored the switch.
  const pass = r.worst >= f.worst - 0.002 && r.worst >= 0.85;
  ok = ok && pass;
  console.log(`${label}  worst frame ${(r.worst * 100).toFixed(1)}% dark · mean ${(r.mean * 100).toFixed(1)}%  ` +
    `${pass ? 'ok' : 'BRIGHTER THAN FULL EFFECTS'}`);
}

await browser.close();
server.close();
console.log(ok
  ? '\nPASS  the dark owns the frame, and Reduce Effects never spends more light'
  : '\nFAIL  a frame went brighter than the direction allows');
process.exit(ok ? 0 : 1);
