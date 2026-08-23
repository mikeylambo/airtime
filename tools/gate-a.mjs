/**
 * Gate A (§11) as an executable check.
 *
 *   "tease-thrust + body-as-trick parts + airtime camera on a gray box with
 *    one ramp. Pass = a 3-second jump feels better to watch than to do, parts
 *    visibly steer the air, and it still lands."
 *
 * Two of those three are measurable and are measured here. Whether it feels
 * better to watch than to do is a human call on the footage — that is what
 * `npm run capture` is for, and this script deliberately does not pretend to
 * answer it.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CHECKS = [
  ['ground handling reaches the ramp', 'probe-drive.mjs'],
  ['parts steer the air (§5.1, 6 claims)', 'probe-aero.mjs'],
  ['the hero jump lands (~3s flight)', 'measure-jump.mjs'],
  ['the scripted capture jump lands', 'probe-demo.mjs'],
];

const verbose = process.argv.includes('--verbose');
let failed = 0;

console.log('\n  AIRTIME — Gate A\n  ' + '─'.repeat(56));
for (const [label, script] of CHECKS) {
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', script)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const bad = r.status !== 0 || /\bFAIL\b/.test(out);
  if (bad) failed++;
  console.log(`  ${bad ? 'FAIL' : 'PASS'}  ${label}`);
  if (verbose || bad) console.log(out.split('\n').map((l) => '        ' + l).join('\n'));
}

console.log('  ' + '─'.repeat(56));
console.log(failed === 0
  ? '  Gate A: measurable criteria all pass.\n  The judgement call — does a 3s jump play better as footage than as\n  input — is on the clips: npm run capture\n'
  : `  Gate A: ${failed} check(s) failed.\n`);
process.exit(failed ? 1 : 0);
