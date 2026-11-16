#!/usr/bin/env node
// Cut a release of the self-hosted server.
//
// `npm run release` from `main`, with a clean tree: it runs the suite, builds
// the archive, tags `fyrhaven-server-vX.Y.Z` and creates the GitHub release with
// the archive attached — so the download is the code in the repository, not a
// file someone built once.
//
//   npm run release              # test, package, tag, release
//   npm run release -- --dry-run # say what it would do, change nothing
//
// It refuses rather than guesses: a dirty tree, a branch that is not `main`, a
// version that already has a tag, and a CHANGELOG that does not start with this
// version are all hard stops.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const say = (line = '') => console.log(line);
const fail = (line) => {
  console.error(`\n!! ${line}`);
  process.exit(1);
};

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}
const git = (args) => run('git', args).trim();

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const VERSION = String(pkg.version);
const TAG = `fyrhaven-server-v${VERSION}`;
const archive = join(root, 'dist', `fyrhaven-server-${VERSION}.tar.gz`);

say(`releasing fyrhaven-server ${VERSION}${DRY ? ' (dry run)' : ''}`);

// ── Refuse rather than guess ────────────────────────────────────────────────
if (git(['status', '--porcelain'])) fail('the tree is not clean — commit or discard first.');
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'main') fail(`releases are cut from main, not ${branch}.`);
try {
  git(['rev-parse', '--verify', `refs/tags/${TAG}`]);
  fail(`tag ${TAG} already exists.`);
} catch {
  // good: no such tag
}
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const heading = `## [${VERSION}]`;
if (!changelog.startsWith(`# `) || !changelog.includes(heading)) {
  fail(`CHANGELOG.md has no \`${heading}\` section.`);
}
// The notes are that section, up to the next release heading.
const start = changelog.indexOf(heading);
const next = changelog.indexOf('\n## [', start + heading.length);
const notes = changelog.slice(start, next === -1 ? undefined : next).trim();

// ── Test, then build ────────────────────────────────────────────────────────
say('\n== tests');
run('node', ['--test'], { stdio: 'inherit' });

say('\n== archive');
run('node', ['scripts/package.mjs'], { stdio: 'inherit' });
if (!existsSync(archive)) fail(`packaging did not write ${archive}.`);

if (DRY) {
  say('\nwould:');
  say(`  git tag -a ${TAG} -m "fyrhaven-server ${VERSION}"`);
  say(`  git push origin ${TAG}`);
  say(`  gh release create ${TAG} ${archive} --title "Fyrhaven record server ${VERSION}"`);
  process.exit(0);
}

// ── Tag, push, release ──────────────────────────────────────────────────────
say('\n== tag');
git(['tag', '-a', TAG, '-m', `fyrhaven-server ${VERSION}`]);
git(['push', 'origin', TAG]);

say('\n== release');
const notesFile = join(mkdtempSync(join(tmpdir(), 'fyrhaven-release-')), 'notes.md');
try {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(notesFile, notes);
  run('gh', [
    'release', 'create', TAG, archive,
    '--title', `Fyrhaven record server ${VERSION}`,
    '--notes-file', notesFile,
  ], { stdio: 'inherit' });
} finally {
  rmSync(dirname(notesFile), { recursive: true, force: true });
}

say(`\n${TAG} released with ${archive}`);
