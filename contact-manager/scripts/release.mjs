// One-command release: tests, packages, refreshes the published artifacts and
// creates the GitHub release for the version in manifest.json. Run from
// contact-manager/ with `npm run release` and a clean, pushed working tree.
import { cp, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = path.resolve(ROOT, '..');
const BUILD_DIR = path.join(REPO_ROOT, 'build', 'contact-manager');
const manifest = JSON.parse(await readFile(path.join(ROOT, 'manifest.json'), 'utf8'));
const changelog = await readFile(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const tag = `contact-manager-v${manifest.version}`;

/** The CHANGELOG section for this version, without the heading itself. */
function releaseNotes() {
  const marker = `## [${manifest.version}]`;
  const start = changelog.indexOf(marker);
  if (start === -1) return '';
  const headingEnd = changelog.indexOf('\n', start);
  if (headingEnd === -1) return '';
  const rest = changelog.slice(headingEnd + 1);
  const end = rest.search(/^## \[/m);
  return rest.slice(0, end === -1 ? undefined : end).trim();
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

// Keep the published artifacts in lockstep with the source.
await cp(path.join(ROOT, 'manifest.json'), path.join(BUILD_DIR, 'manifest.json'));
await cp(path.join(ROOT, 'dist', 'index.js'), path.join(BUILD_DIR, 'index.js'));
await cp(path.join(ROOT, 'contact-manager.zip'), path.join(BUILD_DIR, 'contact-manager.zip'));

const dirty = capture('git', ['status', '--porcelain', '--', 'build/contact-manager']);
if (dirty.stdout.trim()) {
  console.error(`\nArtifacts changed. Commit build/contact-manager before releasing:\n${dirty.stdout}`);
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
const notes = releaseNotes();
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
