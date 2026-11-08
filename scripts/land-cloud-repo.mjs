#!/usr/bin/env node
// Land the cloud repository.
//
// The cloud server is staged in this repository on branch `cloud-only`, because a
// session without access to `Fyrhaven/Fyrhaven-CRM-Cloud` cannot push it there.
// This script is for the session that *does* have access: it checks the target is
// reachable and empty, pushes the branch, then verifies what landed by cloning it
// and running its tests — rather than trusting the push's exit code.
//
//   node scripts/land-cloud-repo.mjs            # the plan, and the blocker if it is there
//   node scripts/land-cloud-repo.mjs --apply    # push, then verify from a fresh clone
//
// What it will not do: force over existing content, or delete the staging branch.
// Both are printed as the operator's next step, because both are decisions.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TARGET = process.env.FYRHAVEN_CLOUD_REPO ?? 'Fyrhaven/Fyrhaven-CRM-Cloud';
const BRANCH = 'cloud-only';
// A local path is accepted as the target so this can be exercised end to end —
// a bare repository stands in for the empty GitHub one, and the push, the clone
// and the test run are the same commands either way.
const LOCAL = TARGET.startsWith('/') || TARGET.startsWith('.');
const URL = LOCAL ? TARGET : `https://github.com/${TARGET}.git`;
const EXPECT_TESTS = 86;
const APPLY = process.argv.includes('--apply');

const say = (line = '') => console.log(line);
const step = (line) => console.log(`\n== ${line}`);
const fail = (line) => console.error(`\n!! ${line}`);

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

function gh(args) {
  try {
    return { ok: true, out: run('gh', args).trim() };
  } catch (error) {
    return {
      ok: false,
      err: String(error.stderr ?? error.message ?? '').split('\n').filter(Boolean).slice(0, 2).join(' '),
    };
  }
}

/** The blocker, printed the same way every time: it is a settings click, not a bug. */
function reportNoAccess(detail) {
  fail(`cannot reach ${TARGET}: ${detail}`);
  say('');
  say('   This credential is a GitHub App installed on selected repositories.');
  say('   A private repository it is not installed on answers 404 to everything,');
  say('   reads included, so this is a permission and not a typo.');
  say('');
  say('   An organisation owner adds it once:');
  say(`     https://github.com/organizations/${TARGET.split('/')[0]}/settings/installations`);
  say(`     -> the Cline app -> Configure -> Repository access -> add ${TARGET}`);
  say('     (Contents: read and write)');
  say('');
  say('   Or land it from a machine that can push, without this credential:');
  say(`     git clone --branch ${BRANCH} https://github.com/Fyrhaven/Fyrhaven-CRM.git /tmp/cloud-src`);
  say(`     cd /tmp/cloud-src && git push ${TARGET} HEAD:refs/heads/main`);
}

step(`landing ${TARGET}`);
let hasContent = false;
if (LOCAL) {
  try {
    const refs = run('git', ['ls-remote', '--heads', URL]);
    hasContent = refs.trim() !== '';
    say(`  target:    ${TARGET} (local, ${hasContent ? 'has branches' : 'empty'})`);
  } catch (error) {
    fail(`not a repository: ${TARGET} (${String(error.message ?? '').split('\n')[0]})`);
    process.exit(1);
  }
} else {
  const repo = gh(['api', `/repos/${TARGET}`, '--jq', '[.full_name, (.private|tostring), (.size|tostring)] | join(",")']);
  if (!repo.ok) {
    reportNoAccess(repo.err);
    process.exit(1);
  }
  const [fullName, isPrivate, size] = repo.out.split(',');
  say(`  target:    ${fullName} (private: ${isPrivate}, size: ${size} kB)`);
  const commits = gh(['api', `/repos/${TARGET}/commits?per_page=1`, '--jq', 'length']);
  hasContent = commits.ok && commits.out !== '0';
}
say(`  content:   ${hasContent ? 'already has commits — this script will not force over them' : 'empty, ready to receive'}`);

const staged = gh(['api', `/repos/Fyrhaven/Fyrhaven-CRM/git/ref/heads/${BRANCH}`, '--jq', '.object.sha']);
say(`  staged:    branch ${BRANCH}${staged.ok ? ` at ${staged.out.slice(0, 7)}` : ' (missing! push it from the working clone first)'}`);

if (!APPLY) {
  say('');
  say(`  what --apply does: push ${BRANCH} -> ${TARGET} main, then clone it and run its tests`);
  process.exit(0);
}

if (hasContent) {
  fail('the target already has commits; refusing to overwrite.');
  say('   Inspect it, and if it really is disposable, push by hand:');
  say(`     git push ${TARGET} ${BRANCH}:main --force-with-lease`);
  process.exit(1);
}

step('pushing');
try {
  const out = run('git', ['push', URL, `origin/${BRANCH}:refs/heads/main`]);
  say(out.trim().split('\n').filter(Boolean).map((line) => `  ${line}`).join('\n') || '  pushed');
} catch (error) {
  reportNoAccess(String(error.stderr ?? error.message ?? '').trim());
  process.exit(1);
}

step('verifying what landed');
const work = mkdtempSync(join(tmpdir(), 'cloud-land-'));
try {
  // `--branch main`: a bare repository still points HEAD at master, and a plain
  // clone of it checks out nothing — which reads as "the push did not land" and
  // is the wrong conclusion. Ask for the branch we just pushed.
  run('git', ['clone', '--quiet', '--branch', 'main', URL, work]);
  const files = readdirSync(work);
  const problems = [];
  if (!files.includes('cloud.js')) problems.push('cloud.js is missing — that is not the cloud server');
  if (files.includes('packaging')) problems.push('packaging/ is present — that is the self-host machinery');
  if (files.includes('distribution.js')) problems.push('distribution.js is present — the build switch came along');
  say(`  files:     ${files.filter((name) => !name.startsWith('.')).join(' ')}`);

  const tests = run('node', ['--test'], { cwd: work, timeout: 180_000 });
  const match = /# pass (\d+)/.exec(tests) ?? /ℹ pass (\d+)/.exec(tests);
  const passed = match ? Number(match[1]) : 0;
  say(`  tests:     ${passed} passed${passed === EXPECT_TESTS ? '' : ` (expected ${EXPECT_TESTS})`}`);
  if (passed !== EXPECT_TESTS) problems.push(`expected ${EXPECT_TESTS} tests, saw ${passed}`);

  if (problems.length) {
    for (const problem of problems) fail(problem);
    process.exit(1);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

step('next, by hand');
say(`  the staging branch has done its job and can go:`);
say(`    git push origin --delete ${BRANCH}`);
say('');
say('  then this repository becomes the self-hosted server, keeping the record API');
say('  and the licence gate and losing cloud.js, the operator modules and site/ —');
say('  the steps are in NEXT.md, section "Then: this repository\'s server becomes');
say('  the self-hosted one".');
