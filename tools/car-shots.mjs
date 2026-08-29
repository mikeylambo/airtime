/**
 * Car shots — the only way to judge the thing that has no probe.
 *
 * Everything else in tools/ turns a claim into a number. A silhouette cannot be
 * gated: "does this read as an exotic" is a human call, and the only useful
 * thing a script can do is put the car in front of a human quickly, in every
 * art style, from the two angles that matter. A wedge lives or dies on its side
 * profile and reads completely differently three-quarter on.
 *
 *   npm run shots:car            all four distinctive cars, all three styles
 *   node tools/car-shots.mjs needle
 *   STYLES=afterglow node tools/car-shots.mjs
 */
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.mp4': 'video/mp4', '.wasm': 'application/wasm', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  const p = (req.url || '/').split('?')[0];
  const f = join(DIST, p === '/' ? 'index.html' : p);
  try { const b = await readFile(f);
    res.writeHead(200, { 'content-type': MIME[f.slice(f.lastIndexOf('.'))] || 'application/octet-stream' });
    res.end(b);
  } catch { res.writeHead(404); res.end('no'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars', '--mute-audio', '--enable-unsafe-swiftshader',
         '--use-gl=angle', '--use-angle=swiftshader'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
await page.waitForFunction('window.AIRTIME && window.AIRTIME.ready', { timeout: 60000 });
await page.evaluate(() => window.AIRTIME.game.selectProfile(0));

const cars = process.argv[2] ? [process.argv[2]] : ['vector', 'needle', 'stub', 'proto'];
for (const style of (process.env.STYLES || 'afterglow,graybox').split(',')) {
  for (const car of cars) {
    await page.evaluate(async (carId, st) => {
      const g = window.AIRTIME.game;
      g.profile.car = carId;
      g.saveProfiles();
      g.setArtStyle(st);
      await g.startRun(g.lastMode, window.AIRTIME.ARENAS[0]);
    }, car, style);
    await new Promise((r) => setTimeout(r, 1800));
    // Two framings, because a wedge lives or dies on its side profile and
    // reads completely differently three-quarter on.
    for (const [view, cam, look] of [
      ['3q', [3.6, 1.15, -4.6], [0, -0.1, 0]],
      ['side', [6.6, 0.15, 0.2], [0, -0.15, 0.1]],
    ]) {
      await page.evaluate((c, l) => {
        const g = window.AIRTIME.game;
        g.running = false;
        g.hudRoot.style.display = 'none';
        const p = g.sim.car.position;
        g.camera.fov = 34; g.camera.updateProjectionMatrix();
        g.camera.position.set(p.x + c[0], p.y + c[1], p.z + c[2]);
        g.camera.lookAt(p.x + l[0], p.y + l[1], p.z + l[2]);
        g.renderer.render(g.scene, g.camera);
      }, cam, look);
      await new Promise((r) => setTimeout(r, 120));
      await page.screenshot({ path: join(ROOT, 'capture', `car-${style}-${car}-${view}.png`) });
    }
    await page.evaluate(() => { window.AIRTIME.game.hudRoot.style.display = ''; });
    await page.evaluate(() => { window.AIRTIME.game.running = true; window.AIRTIME.game.start?.(); });
  }
}
console.log('car shots written');
await browser.close();
server.close();
