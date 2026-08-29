/**
 * Runs the Gate B loop script inside the real game loop and reports when it
 * scores — so the clip window is chosen from the run being captured, not from
 * a headless approximation of it.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.mp4':'video/mp4','.wasm':'application/wasm' };
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

const arena = process.argv.includes('--city') ? 'city' : 'park';
const out = await page.evaluate(async (arena) => {
  const g = window.AIRTIME.game;
  const HZ = window.AIRTIME.TUNING.SIM.HZ;
  await g.beginCapture({ script: 'loop', style: 'afterglow', fps: 30, start: 0, arena });
  const hits = [];
  const orig = g.hud.showLanding.bind(g.hud);
  g.hud.showLanding = (r) => {
    if (r.airtime > 0.3) hits.push({ t: +g.demoT.toFixed(1), q: r.quality, tier: r.tier, total: r.total,
      tricks: r.tricks.map((k) => k.name) });
    orig(r);
  };
  for (let i = 0; i < 90 * HZ; i++) g.stepFixed(1 / HZ);
  const s = g.sim.runSummary();
  return { hits, score: s.score, jumps: s.jumps, landed: s.landed, respawns: g.sim.respawns, coins: s.coins };
}, arena);

console.log(`── ${arena}: the loop as the capture runs it ──`);
for (const h of out.hits) {
  console.log(`  t=${String(h.t).padStart(5)}s  ${h.q.padEnd(7)} ${h.tier.padEnd(9)} ${String(h.total).padStart(5)}  ${h.tricks.join('+') || '—'}`);
}
console.log(`\nscore ${out.score.toLocaleString()} · jumps ${out.jumps} · landed ${out.landed} · respawns ${out.respawns} · coins ${out.coins}`);

// Best 20 second window by points scored inside it.
let best = { t: 0, sum: 0 };
for (let t0 = 0; t0 < 70; t0 += 1) {
  const sum = out.hits.filter((h) => h.t >= t0 && h.t < t0 + 20).reduce((a, h) => a + h.total, 0);
  if (sum > best.sum) best = { t: t0, sum };
}
console.log(`best 20s window: t=${best.t}..${best.t + 20} worth ${best.sum.toLocaleString()}`);

await browser.close(); server.close();
