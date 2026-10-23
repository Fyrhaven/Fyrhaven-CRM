// One command to land a release: merge the open pull requests into `main`, keep
// the `contact-manager` mirror branch in step and cut the release. This is the
// documented "merge the branches, then `npm run release`" flow, automated.
//
//   npm run ship                  merge the open PRs, sync the mirror, release
//   npm run ship -- --dry-run     print the plan and change nothing
//   npm run ship -- --no-release  merge + sync the mirror only
//
// Run it with a clean working tree. The manifest version is the single source
// of truth; `scripts/release.mjs` refuses to tag when it disagrees with
// `package.json` or the top `CHANGELOG.md` entry.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planShip } from './ship-lib.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = path.resolve(ROOT, '..');
const flags = new Set(process.argv.slice(2));
const DRY = flags.has('--dry-run');
const NO_RELEASE = flags.has('--no-release');
const MERGEABLE_TRIES = 15;
const MERGEABLE_WAIT_MS = 2000;

const run = (command, args, options = {}) => spawnSync(command, args, {
  cwd: options.cwd ?? REPO_ROOT,
  encoding: 'utf8',
  stdio: options.inherit ? 'inherit' : 'pipe',
});
const git = (...args) => run('git', args);
const gh = (...args) => run('gh', args);

function fail(message) {
  console.error(`\nship: ${message}`);
  process.exit(1);
}

const gitOrFail = (args, what) => {
  const result = git(...args);
  if (result.status !== 0) fail(`${what} failed:\n${(result.stderr || result.stdout || '').trim()}`);
  return result;
};

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// --- preconditions ---------------------------------------------------------
if (gh('--version').status !== 0) {
  fail('the GitHub CLI (gh) is required — install it and authenticate first.');
}
if (!DRY) {
  const dirty = git('status', '--porcelain').stdout?.trim();
  if (dirty) fail(`working tree is not clean; commit or stash first:\n${dirty}`);
}
console.log(DRY ? 'ship (dry run)' : 'ship');

// --- bring `main` up to date ----------------------------------------------
if (!DRY) {
  gitOrFail(['fetch', 'origin', '--prune', '--tags'], 'git fetch');
  gitOrFail(['checkout', 'main'], 'git checkout main');
  gitOrFail(['merge', '--ff-only', 'origin/main'], 'fast-forward main');
}

const openPrs = () => {
  const result = gh('pr', 'list', '--state', 'open', '--limit', '100',
    '--json', 'number,baseRefName,headRefName');
  if (result.status !== 0) fail(`gh pr list failed:\n${(result.stderr || '').trim()}`);
  return JSON.parse(result.stdout || '[]');
};

// A branch has landed when it is an ancestor of `origin/main` (its PR is merged
// and the branch still exists), so a stacked PR based on it can be retargeted.
function baseLanded(base) {
  if (base === 'main') return true;
  const ref = `refs/remotes/origin/${base}`;
  if (git('rev-parse', '-q', '--verify', ref).status !== 0) return false;
  return git('merge-base', '--is-ancestor', ref, 'origin/main').status === 0;
}

function mergePr(pr) {
  if (pr.retarget) {
    const edit = gh('pr', 'edit', String(pr.number), '--base', 'main');
    if (edit.status !== 0) fail(`gh pr edit #${pr.number} --base main failed:\n${(edit.stderr || '').trim()}`);
    for (let i = 0; i < MERGEABLE_TRIES; i++) {
      const state = gh('pr', 'view', String(pr.number), '--json', 'mergeable', '-q', '.mergeable').stdout?.trim();
      if (state && state !== 'UNKNOWN') break;
      sleep(MERGEABLE_WAIT_MS);
    }
  }
  const merge = gh('pr', 'merge', String(pr.number), '--merge');
  if (merge.status !== 0) fail(`gh pr merge #${pr.number} failed:\n${(merge.stderr || '').trim()}`);
}

const refreshMain = () => {
  gitOrFail(['fetch', 'origin', '--prune'], 'git fetch');
  gitOrFail(['checkout', 'main'], 'git checkout main');
  gitOrFail(['merge', '--ff-only', 'origin/main'], 'fast-forward main');
};

// --- merge the open pull requests into main --------------------------------
let merged = 0;
for (let round = 0; round < 50; round++) {
  const prs = openPrs();
  if (!prs.length) break;
  const onMain = [...new Set(prs.map((pr) => pr.baseRefName))].filter(baseLanded);
  const { ready, blocked } = planShip(prs, ['main', ...onMain]);
  for (const pr of blocked) {
    console.log(`  blocked: #${pr.number} ${pr.head} (base ${pr.base} is not on main)`);
  }
  if (!ready.length) break;
  for (const pr of ready) {
    console.log(`  ${DRY ? 'would merge' : 'merging'} #${pr.number} ${pr.head}${pr.retarget ? ' (retargeted to main)' : ''}`);
    if (DRY) { merged++; continue; }
    mergePr(pr);
    merged++;
    refreshMain();
  }
  if (DRY) break;
}
console.log(merged ? `\n${DRY ? 'would merge' : 'merged'} ${merged} pull request(s).` : '\nno open pull requests.');

if (DRY) {
  if (!NO_RELEASE) console.log('[dry-run] would then run: npm run release');
  process.exit(0);
}

// --- keep the mirror branch in step ---------------------------------------
gitOrFail(['push', 'origin', 'main:contact-manager'], 'push the contact-manager mirror');
console.log('contact-manager mirror is in step with main.');

// --- cut the release -------------------------------------------------------
if (NO_RELEASE) {
  console.log('\n--no-release: stopping before the release.');
  process.exit(0);
}
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const tag = `contact-manager-v${manifest.version}`;
if (git('rev-parse', '-q', '--verify', `refs/tags/${tag}`).status === 0) {
  console.log(`\nnothing to release: ${tag} already exists.`);
  process.exit(0);
}
console.log(`\ncutting ${tag}...`);
process.exit(run('npm', ['run', 'release'], { cwd: ROOT, inherit: true }).status ?? 1);
