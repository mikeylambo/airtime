/**
 * §S: does a save survive the round trip, and does it refuse what it should?
 *
 * A save file is the one artefact in the build whose failure is invisible
 * until it matters: nobody discovers a broken export until they have already
 * lost the thing it was supposed to protect. So it gets a probe rather than a
 * screenshot.
 *
 * localStorage does not exist in node, so this stands a minimal one up. That
 * is not a cheat — `storage.js` talks to exactly this surface and nothing
 * else, which is the property being relied on.
 *
 *   node tools/probe-save.mjs
 */

const store = new Map();
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};

const { Storage } = await import('../src/storage/storage.js');
const { exportSave, exportSaveText, importSave, describeImport, saveFilename } =
  await import('../src/storage/savefile.js');
const { simVersion, SCHEMA_VERSION } = await import('../src/sim/version.js');

const fails = [];
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(50)} ${detail}`);
  if (!ok) fails.push(label);
};

console.log('\n── §S: one file, out and back ───────────────────────────────\n');

// A save with something in every corner of it, including a key this file has
// never heard of — which is the whole point of sweeping the prefix.
Storage.write('options', { artStyle: 'afterglow', reduceEffects: true, bindings: { throttle: ['KeyI'] } });
Storage.write('profiles', [{ name: 'MIKEY', medals: { 'park:stunt': 'gold' }, best: { 'park:stunt': 91234 } }]);
Storage.write('activeSlot', 0);
Storage.write('board', { 'park:stunt': [{ name: 'AAA', score: 40000 }] });
Storage.write('ghosts:0', { 'park:stunt': { sim: simVersion(), clip: { streams: {} } } });
Storage.write('driverIds', { local: 'abc' });
Storage.write('a_key_nobody_listed', { still: 'here' });
// Something outside the namespace, which must not be swept up.
localStorage.setItem('someone-elses-app', 'do not touch');

const snapshot = exportSave();
check(snapshot.magic === 'AIRTIME-SAVE' && snapshot.schema === SCHEMA_VERSION,
  'the export is stamped', `schema ${snapshot.schema}  sim ${snapshot.sim}`);
check(snapshot.keys === 7, 'it takes every namespaced key', `${snapshot.keys} keys: ${Object.keys(snapshot.data).join(' ')}`);
check(!('someone-elses-app' in snapshot.data), 'and nothing outside the namespace',
  'a save is not a dump of the whole browser');
check('a_key_nobody_listed' in snapshot.data,
  'including keys this module has never heard of',
  'a system added later is backed up the day it ships');

const text = exportSaveText();
check(text.length > 100 && JSON.parse(text).magic === 'AIRTIME-SAVE',
  'and it serialises to text somebody can keep', `${text.length} chars, ${saveFilename()}`);

// ── The round trip ─────────────────────────────────────────────────────────
store.clear();
const back = importSave(text);
check(back.ok && back.written.length === 7, 'a wiped browser restores from it',
  back.ok ? `${back.written.length} entries` : back.why);
const opts = Storage.read('options', null);
check(opts && opts.reduceEffects === true && opts.bindings.throttle[0] === 'KeyI',
  'and the values are the values', 'options, bindings and all');
const prof = Storage.read('profiles', null);
check(prof && prof[0].best['park:stunt'] === 91234, 'progress survives exactly',
  `best ${prof && prof[0].best['park:stunt']}`);

// ── What it refuses ────────────────────────────────────────────────────────
check(importSave('not json at all').ok === false, 'a file that is not JSON is refused',
  importSave('not json at all').why);
check(importSave('{"hello":1}').ok === false, 'and JSON that is not a save',
  importSave('{"hello":1}').why);

const newer = JSON.parse(text);
newer.schema = SCHEMA_VERSION + 5;
const fromFuture = importSave(JSON.stringify(newer));
check(fromFuture.ok === false, 'and a save from a newer build, rather than corrupting one',
  fromFuture.why);

// §R: progress is portable across a physics change, recorded runs are not.
store.clear();
const stale = JSON.parse(text);
stale.sim = 'sim_0000000';
const r = importSave(JSON.stringify(stale));
const keptProgress = !!Storage.read('profiles', null);
const droppedGhosts = Storage.read('ghosts:0', null) === null;
check(r.ok && keptProgress && droppedGhosts,
  'a save from different physics keeps medals, drops ghosts',
  describeImport(r));

// ── Idempotence ────────────────────────────────────────────────────────────
store.clear();
importSave(text);
const first = exportSaveText();
importSave(first);
check(exportSaveText().replace(/"created":\d+/, '') === first.replace(/"created":\d+/, ''),
  'and importing what you exported changes nothing', 'the round trip is a fixed point');

console.log('');
if (fails.length) { console.log(`FAIL  ${fails.length} of the save contract does not hold\n`); process.exit(1); }
console.log('PASS  the save survives the round trip, and refuses what it should\n');
