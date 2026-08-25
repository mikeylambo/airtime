/**
 * The gates, as executable checks.
 *
 * Everything here is measurable. The two things that are not — "does a 3s jump
 * play better as footage than as input" and "do they hit restart when the timer
 * expires" — are human verdicts on a human in a chair, and this script
 * deliberately does not pretend to answer them.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const CHECKS = [
  ['A', 'ground handling reaches the ramp', 'probe-drive.mjs'],
  ['A', 'parts steer the air (§5.1, 6 claims)', 'probe-aero.mjs'],
  ['A', 'the hero jump lands (~3s flight)', 'measure-jump.mjs'],
  ['A', 'the scripted capture jump lands', 'probe-demo.mjs'],
  ['B', 'the loop runs end to end', 'probe-run.mjs'],
  ['B', 'risk pays: near-miss and oncoming (§4)', 'probe-traffic.mjs'],
  ['C', 'every §9 mode rule bites', 'probe-modes.mjs'],
  ['R1', 'stacking facets breaks the scoring open', 'probe-facets.mjs'],
  ['R2', 'recoverable and rotatable at once', 'probe-axes.mjs'],
  ['R2', 'the car flies from the stick', 'probe-air.mjs'],
  ['R3', 'the park is a network, not a scatter', 'lines.mjs'],
  ['R4', 'one input, back in the air under 3s', 'probe-flow.mjs'],
];

const verbose = process.argv.includes('--verbose');
const only = process.argv.includes('--r') ? process.argv[process.argv.indexOf('--r') + 1] : null;
let failed = 0, ran = 0;

console.log('\n  AIRTIME — gates\n  ' + '─'.repeat(58));
let phase = null;
for (const [p, label, script] of CHECKS) {
  if (only && p.toLowerCase() !== only.toLowerCase()) continue;
  if (p !== phase) { console.log(`  ${'·'.repeat(2)} ${p}`); phase = p; }
  ran++;
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', script)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const bad = r.status !== 0 || /^FAIL\b/m.test(out);
  if (bad) failed++;
  console.log(`     ${bad ? 'FAIL' : 'PASS'}  ${label}`);
  if (verbose || bad) console.log(out.split('\n').map((l) => '           ' + l).join('\n'));
}

console.log('  ' + '─'.repeat(58));
if (failed === 0) {
  console.log(`  ${ran}/${ran} measurable criteria pass.\n`);
  console.log('  Still human verdicts, and deliberately not checked here:');
  console.log('    · does a 3-second jump play better as footage than as input');
  console.log('    · do they hit restart when the timer expires\n');
} else {
  console.log(`  ${failed} of ${ran} checks failed.\n`);
}
process.exit(failed ? 1 : 0);
