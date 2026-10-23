// One-command release: tests, packages and creates the GitHub release for the
// version in manifest.json. The ZIP is a release asset, not a committed file.
// Run from contact-manager/ with `npm run release` on clean, pushed `main`.
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseNotes, checkRelease } from './release-lib.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = path.resolve(ROOT, '..');
const manifest = JSON.parse(await readFile(path.join(ROOT, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
const changelog = await readFile(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const tag = `contact-manager-v${manifest.version}`;

// Fail fast on the classic mistake: a commit that ships the feature but forgets
// the version. The manifest version is the single source of truth, so the top
// CHANGELOG entry and package.json must agree with it before we tag anything.
const problems = checkRelease({
  manifestVersion: manifest.version,
  packageVersion: pkg.version,
  changelog,
});
if (problems.length) {
  console.error(`\nCannot release ${manifest.version}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function capture(command, args, cwd = REPO_ROOT) {
  return spawnSync(command, args, { encoding: 'utf8', cwd });
}

run('npm', ['test']);
run('npm', ['run', 'package']);

const dirty = capture('git', ['status', '--porcelain']);
if (dirty.stdout.trim()) {
  console.error(`\nWorking tree is not clean. Commit the source before releasing:\n${dirty.stdout}`);
  process.exit(1);
}

const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
if (branch !== 'main') {
  console.error(`\nReleases are cut from main (current branch: ${branch}).`);
  process.exit(1);
}

if (capture('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`]).status === 0) {
  console.error(`\nTag ${tag} already exists. Bump manifest.json/CHANGELOG.md first.`);
  process.exit(1);
}

run('git', ['tag', '-a', tag, '-m', `Contact Manager ${manifest.version}`], REPO_ROOT);
run('git', ['push', 'origin', tag], REPO_ROOT);
const notes = releaseNotes(changelog, manifest.version);
const releaseArgs = [
  'release', 'create', tag,
  path.join(ROOT, 'contact-manager.zip'),
  '--title', `Contact Manager ${manifest.version}`,
  '--verify-tag',
];
if (notes) releaseArgs.push('--notes', notes);
else releaseArgs.push('--generate-notes');
run('gh', releaseArgs, REPO_ROOT);

console.log(`\nReleased ${tag} with contact-manager.zip.`);
