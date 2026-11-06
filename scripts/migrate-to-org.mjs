#!/usr/bin/env node
// Move this repository to the Fyrhaven organisation, and fix the links after it.
//
// Two ways in, and the difference matters:
//
//   --transfer  GitHub's own transfer. The repository *moves*: issues, pull
//               requests, releases, tags, labels, milestones and the redirect
//               from the old URL all come with it. This is the one to use.
//   --create    Creates an empty repository at the target and pushes every
//               branch and tag into it. Code and history arrive; **issues, pull
//               requests and releases do not**, so it is the fallback for a
//               credential that may create but not transfer.
//
// Both need a credential that can act on the organisation. A GitHub App must be
// *installed on it* — being able to read `https://api.github.com/orgs/Fyrhaven`
// proves nothing, because a public organisation answers that to anyone.
//
//   node scripts/migrate-to-org.mjs                     # what would happen, and what blocks it
//   node scripts/migrate-to-org.mjs --transfer          # move the repository
//   node scripts/migrate-to-org.mjs --create            # fallback: create + push all refs
//   node scripts/migrate-to-org.mjs --links --dry-run   # show the files whose links would change
//   node scripts/migrate-to-org.mjs --links             # rewrite the slug (AFTER the move)
//
// Nothing here runs in CI. It is an operator's command, run once, from a clean
// tree — `--transfer` refuses a dirty tree, because a move is not the moment to
// discover uncommitted work.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const TARGET = option('--to', 'Fyrhaven/bulwark-plugins');
const OLD_SLUG = 'zyntrax/bulwark-plugins';
const DRY = flag('--dry-run');
const TARGET_ORG = TARGET.split('/')[0];

const say = (line = '') => console.log(line);
const step = (line) => console.log(`\n== ${line}`);
const fail = (line) => console.error(`\n!! ${line}`);

function gh(argv) {
  try {
    return { ok: true, out: execFileSync('gh', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (error) {
    return {
      ok: false,
      out: String(error.stdout ?? '').trim(),
      err: String(error.stderr ?? error.message ?? '').split('\n').filter(Boolean).slice(0, 3).join(' '),
    };
  }
}

function git(argv) {
  return execFileSync('git', argv, { encoding: 'utf8' }).trim();
}

/** `owner/repo` from the origin remote, in either the HTTPS or the SSH spelling. */
function currentRepo() {
  const url = git(['remote', 'get-url', 'origin']);
  const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
  if (!match) throw new Error(`cannot read owner/repo from origin ${url}`);
  return `${match[1]}/${match[2]}`;
}

/** The repositories this credential is installed on — app tokens only, else null. */
function installedRepos() {
  const listed = gh(['api', '/installation/repositories', '--jq', '.repositories[].full_name']);
  if (!listed.ok) return null;
  return listed.out.split('\n').map((line) => line.trim()).filter(Boolean);
}

const repoExists = (slug) => gh(['api', `/repos/${slug}`, '--jq', '.full_name']).ok;
const cleanTree = () => git(['status', '--porcelain']) === '';

/**
 * What is missing, said once and precisely. A GitHub App that is not installed on
 * an organisation cannot create a repository in it, and cannot receive one by
 * transfer; no amount of retrying changes that.
 */
function reportBlocker(repos) {
  fail(`this credential cannot act on the ${TARGET_ORG} organisation.`);
  if (repos) {
    say(`   It is installed on: ${repos.join(', ') || '(nothing)'}`);
    say(`   ${TARGET_ORG} is not in that list, so the organisation must install the app.`);
  }
  say('');
  say('   Fix, in the browser (an organisation owner must do this):');
  say(`     1. https://github.com/organizations/${TARGET_ORG}/settings/installations`);
  say('     2. find the Cline GitHub App and choose "Install" (or "Configure" -> add repositories)');
  say(`     3. grant it access to all repositories, or at least the one named below`);
  say('     4. "Administration" write is what a transfer needs; "Contents" write is enough for --create');
  say('');
  say('   Then run this again from the same workspace:');
  say(`     node scripts/migrate-to-org.mjs --transfer`);
}

// ── The link sweep ─────────────────────────────────────────────
//
// Only ever run after the move: until then the old slug is the one that works.
// A transfer keeps redirects alive, so a stale link still lands — but a document
// that names the wrong repository is a document that lies.

function trackedTextFiles() {
  return git(['ls-files'])
    .split('\n')
    .filter(Boolean)
    .filter((file) => !file.startsWith('.cline-home/'))
    .filter((file) => !file.split('/').includes('node_modules'))
    .filter((file) => !file.split('/').includes('dist') && !file.split('/').includes('build'))
    .filter((file) => /\.(md|json|mjs|js|ya?ml|txt|html|css)$/.test(file));
}

function sweepLinks() {
  step(`rewriting ${OLD_SLUG} -> ${TARGET}`);
  const touched = [];
  for (const file of trackedTextFiles()) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!text.includes(OLD_SLUG)) continue;
    const hits = text.split(OLD_SLUG).length - 1;
    touched.push([file, hits]);
    if (!DRY) writeFileSync(file, text.split(OLD_SLUG).join(TARGET));
  }
  if (!touched.length) {
    say('  nothing to rewrite.');
    return;
  }
  for (const [file, hits] of touched) say(`  ${DRY ? 'would rewrite' : 'rewrote'} ${file} (${hits})`);
  const total = touched.reduce((sum, [, hits]) => sum + hits, 0);
  say(`\n  ${total} reference(s) in ${touched.length} file(s).`);
  say(DRY ? '  re-run without --dry-run to write them' : '  review with `git diff`, then commit and push');
}

// ── Moving it ─────────────────────────────────────────────────

function transfer(from) {
  step(`transferring ${from} -> ${TARGET}`);
  if (!cleanTree()) {
    fail('the working tree is dirty; commit or stash first.');
    return 1;
  }
  const answer = gh(['api', '-X', 'POST', `/repos/${from}/transfer`, '-f', `new_owner=${TARGET_ORG}`]);
  if (!answer.ok) {
    reportBlocker(installedRepos());
    say(`\n   GitHub said: ${answer.err}`);
    return 1;
  }
  // A transfer answers with the repository *message* only; the move finishes asynchronously.
  say(`  asked GitHub to move it. The answer was: ${answer.out || '(empty)'}`);
  say('');
  say('  Next, once https://github.com/' + TARGET + ' answers:');
  say(`    git remote set-url origin https://github.com/${TARGET}.git`);
  say('    node scripts/migrate-to-org.mjs --links');
  return 0;
}

function create(from) {
  step(`creating ${TARGET} and pushing every branch and tag`);
  if (repoExists(TARGET)) {
    fail(`${TARGET} already exists — push into it by hand, or transfer instead.`);
    return 1;
  }
  const made = gh(['repo', 'create', TARGET, '--private', '--description',
    'Bulwark Mail plugins (Fyrhaven CRM) and the record server behind them']);
  if (!made.ok) {
    reportBlocker(installedRepos());
    say(`\n   GitHub said: ${made.err}`);
    return 1;
  }
  say(`  created ${TARGET}`);
  // --mirror carries every ref, including tags, and deletes nothing that is not
  // there. Releases and issues are NOT part of a git mirror; that is the cost of
  // this path and the reason --transfer is preferred.
  execFileSync('git', ['push', '--mirror', `https://github.com/${TARGET}.git`], { stdio: 'inherit' });
  say('');
  say(`  ${from}: issues, pull requests and releases did NOT move.`);
  say('  Re-create the releases from the tags if they are needed:');
  say('    gh release list --repo ' + from);
  say('');
  say('  Next:');
  say(`    git remote set-url origin https://github.com/${TARGET}.git`);
  say('    node scripts/migrate-to-org.mjs --links');
  return 0;
}

function plan(from) {
  step('plan');
  say(`  from:      ${from}`);
  say(`  to:        ${TARGET}`);
  say(`  dirty:     ${cleanTree() ? 'no' : 'yes (--transfer will refuse)'}`);
  say(`  target:    ${repoExists(TARGET) ? 'already exists' : 'does not exist yet'}`);
  const repos = installedRepos();
  say(`  installed: ${repos ? repos.join(', ') || '(nothing)' : 'unknown (not an app token)'}`);
  const keys = ['issues', 'pull requests', 'releases', 'tags', 'labels', 'milestones', 'redirects'];
  say('');
  say('  --transfer keeps every one of these; --create keeps only code, branches and tags:');
  say(`    ${keys.join(', ')}`);
  say('');
  if (repos && !repos.some((slug) => slug.startsWith(`${TARGET_ORG}/`))) {
    reportBlocker(repos);
    return 1;
  }
  say('  Run it:');
  say('    node scripts/migrate-to-org.mjs --transfer      # preferred');
  say('    node scripts/migrate-to-org.mjs --create        # fallback, lossy');
  return 0;
}

const from = currentRepo();
if (flag('--links')) {
  sweepLinks();
  process.exit(0);
}
const status = flag('--transfer') ? transfer(from) : flag('--create') ? create(from) : plan(from);
process.exit(status);

