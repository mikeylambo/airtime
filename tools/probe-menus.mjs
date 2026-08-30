/**
 * Every screen, opened, in a real browser.
 *
 * The headless probes measure the simulation and the data layers, and between
 * them they cover almost everything — but the menus are DOM, and a screen
 * whose `onEnter` throws does not fail a physics probe. It fails silently, in
 * front of a player, on a build that passed the gate.
 *
 * So this walks the screen graph, opens every screen the profile can reach,
 * and fails on any uncaught page error. It also drives one real run to the
 * result screen first, because most of the interesting screens are empty
 * until something has happened: an empty board renders fine and proves
 * nothing, and R9's result screen only shows what a run bought if a run has
 * bought something.
 *
 *   node tools/probe-menus.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.mp4': 'video/mp4', '.wasm': 'application/wasm',
};

if (!existsSync(join(DIST, 'index.html'))) {
  console.log('\nFAIL  no dist/ — run `npm run build` first');
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
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  defaultViewport: { width: 960, height: 540 },
});
const page = await browser.newPage();

// Anything the page throws is a failure, including inside an async screen
// handler that nothing awaits — which is exactly the class of bug a DOM-free
// probe cannot see.
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  // A browser asks for /favicon.ico whether or not anybody put one there, and
  // logs its own 404 for it. That is the browser, not the build.
  const url = (m.location && m.location().url) || '';
  if (url.endsWith('/favicon.ico')) return;
  errors.push(`console: ${m.text()}${url ? ` (${url})` : ''}`);
});
page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
page.on('response', (r) => {
  // A browser asks for /favicon.ico whether or not anybody put one there.
  if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) {
    errors.push(`http ${r.status()}: ${r.url()}`);
  }
});

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
await page.waitForFunction('window.AIRTIME && window.AIRTIME.ready', { timeout: 60000 });

const out = await page.evaluate(async () => {
  const g = window.AIRTIME.game;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  g.selectProfile(0);

  // One real run, short, so the screens have something to show. Nobody is
  // holding the controller, so it banks nothing — which is honest but leaves
  // every screen this probe cares about empty. So the *result* it is finished
  // with is synthesised: a real recorder, a real world, a real landing shape,
  // and a score somebody would have earned. Everything after this point —
  // the ladder, the seven boards, the ghost — runs through exactly the code
  // path a played run uses.
  await g.startRun(g.lastMode, g.lastArena, { players: 1, duration: 6 });
  const t0 = performance.now();
  while (!g.sim.run.over && performance.now() - t0 < 20000) await wait(60);
  if (g.reel) g.skipReel();
  await wait(400);

  await g.startRun(g.lastMode, g.lastArena, { players: 1, duration: 4 });
  const t1 = performance.now();
  while (!g.sim.run.over && performance.now() - t1 < 15000) await wait(60);
  if (g.reel) g.skipReel();
  const base = g.sim.runSummary(0);
  const landing = {
    landed: true, counted: true, quality: 'perfect', tier: 'rooftop',
    facetCount: 7, facets: [], tricks: [], purity: { id: 'raw', label: 'RAW', mult: 2.2 },
    airtime: 3.4, rotation: 12.6, bank: 9000, total: 14200, payout: 14200, coins: 0,
    landingMult: 1.5, tierMult: 1.5, combo: 1.2, target: 'tower',
    from: { x: 0, y: 10, z: 80 }, landedAt: { x: 0, y: 18, z: -10 },
  };
  const synth = {
    ...base, score: 21400, medal: 'silver', jumps: 4, landed: 4, crashes: 0,
    landingRate: 1, bestChain: 4, landings: [landing, { ...landing, total: 7200 }],
    best: landing, coins: 6, nearMisses: 2, moverNearMisses: 0, respawns: 0,
    thrustBursts: 0, groundClimb: 0,
  };
  g.finishRun(synth);
  await wait(500);
  const finishedOn = synth.score;

  const visited = [];
  const names = [...g.screens.screens.keys()];
  for (const name of names) {
    // The run screen is the game, not a menu, and going to it mid-walk would
    // leave the walk driving.
    if (name === 'run') continue;
    try {
      // Screens that expect data get the shape their caller passes.
      const data = {
        challengeset: { set: 'ROTATION' },
        boards: { board: 'arena' },
        gauntletnext: { state: { index: 1, cleared: [{ id: 'g1' }] }, cleared: { name: 'THREE IN A ROW' }, summary: g.lastSummary },
        gauntletresult: { state: { index: 3, cleared: [{}, {}, {}], failed: 'g4' }, summary: g.lastSummary },
        licresult: { test: g.licences[0], result: { value: 1, grade: 'bronze', unit: 'landings' } },
        result: g.lastSummary,
        scoreboard: { all: [g.lastSummary], kind: 'split' },
        handover: { turn: 1, count: 2, scores: [g.lastSummary] },
        reel: (g.replays || [])[0] ? { clip: g.replays[0], index: 0, count: 1 } : null,
      }[name];
      // The reel is a clip player: with nothing recorded there is no screen
      // to open, and inventing an empty clip would test the invention.
      if (name === 'reel' && !data) { visited.push(`${name} (no clip)`); continue; }
      g.screens.go(name, data);
      await wait(90);
      visited.push(name);
    } catch (e) {
      visited.push(`${name} THREW: ${e.message}`);
    }
  }

  // R9's own state, after a real run through the real path.
  return {
    visited,
    screens: names.length,
    challenges: g.challengeCount,
    total: g.challengeTotal,
    ghosts: g.ghostRecords.length,
    placings: (g.placings || []).map((p) => p.board.id),
    score: finishedOn,
  };
});

// Loading a ghost is the one path that runs a whole second simulation inside
// the page, and it is the most likely thing here to throw or to hang.
const ghost = await page.evaluate(async () => {
  const g = window.AIRTIME.game;
  const rec = g.ghostRecords[0];
  if (!rec) return { ok: false, why: 'no ghost was saved by the run' };
  const t0 = performance.now();
  const loaded = await g.loadGhost(rec);
  return {
    ok: !!loaded,
    ms: Math.round(performance.now() - t0),
    steps: loaded ? loaded.steps : 0,
    state: g.ghostState ? !!g.ghostState : false,
  };
});

await browser.close();
server.close();

const thrown = out.visited.filter((v) => v.includes('THREW'));

console.log('\n── every screen, in a browser ──────────────────────────────\n');
console.log(`screens opened                           ${out.visited.length}/${out.screens - 1}`);
console.log(`the result it finished on                ${(out.score || 0).toLocaleString()}  (synthesised — nobody is holding the pad)`);
console.log(`challenges completed by it               ${out.challenges}/${out.total}`);
console.log(`ghosts saved by it                       ${out.ghosts}`);
console.log(`boards it filed onto                     ${out.placings.length ? out.placings.join(', ') : 'none'}`);
console.log(`loading a ghost                          ${ghost.ok ? `${ghost.steps} steps in ${ghost.ms} ms` : ghost.why}`);
if (thrown.length) for (const t of thrown) console.log(`  THREW  ${t}`);
if (errors.length) for (const e of errors.slice(0, 10)) console.log(`  ERROR  ${e}`);

const ok = !thrown.length && !errors.length && ghost.ok && out.ghosts > 0;
console.log('\ngate: every screen opens, nothing throws, and a ghost loads');
console.log(ok ? 'PASS  the menus survive a real run' : 'FAIL  something in the menus is broken');
process.exit(ok ? 0 : 1);
