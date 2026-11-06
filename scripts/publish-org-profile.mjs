#!/usr/bin/env node
// The organisation page: github.com/Fyrhaven.
//
// GitHub has exactly one mechanism for it — a **public** repository called
// `.github` in the organisation, holding `profile/README.md`. There is no
// org-level API for the page itself, so this creates that repository on the
// first run and updates the files on every run after.
//
// There is no second copy of the copy: the text lives at `brand/org-profile.md`
// in this repository, the lockups come from `brand/` (the page's own images are
// relative, so they travel with it), and this script is the mapping.
//
//   node scripts/publish-org-profile.mjs            # the plan, changes nothing
//   node scripts/publish-org-profile.mjs --apply    # create or update, then read back
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const ORG = process.env.FYRHAVEN_ORG ?? 'Fyrhaven';
const REPO = `${ORG}/.github`;
const DESCRIPTION = 'The Fyrhaven organisation page: mail hosting and a CRM for people who run their own mail server.';

/** The page, and the images it references, as <path in .github repo, source here>. */
const FILES = [
  ['profile/README.md', 'brand/org-profile.md'],
  // The names the live page already uses: a run must *update* the logo, not add
  // a second one beside it under a different name.
  ['profile/fyrhaven-lockup.svg', 'brand/fyrhaven-lockup.svg'],
  ['profile/fyrhaven-lockup-dark.svg', 'brand/fyrhaven-lockup-dark.svg'],
];

const say = (line = '') => console.log(line);
const step = (line) => console.log(`\n== ${line}`);
const fail = (line) => console.error(`\n!! ${line}`);

function gh(argv) {
  try {
    return { ok: true, out: execFileSync('gh', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (error) {
    return { ok: false, err: String(error.stderr ?? error.message ?? '').split('\n').filter(Boolean).slice(0, 3).join(' ') };
  }
}

const repoExists = () => gh(['api', `/repos/${REPO}`, '--jq', '.full_name']).ok;
const shaOf = (file) => {
  const answer = gh(['api', `/repos/${REPO}/contents/${file}`, '--jq', '.sha']);
  return answer.ok ? answer.out : null;
};

/**
 * Files already in `profile/`, so a name that differs only in case is found.
 * It happens: GitHub renders `profile/readme.md` today, but `README.md` is the
 * name its documentation gives, and writing one beside the other leaves two
 * copies of the page to drift apart.
 */
const profileFiles = () => {
  const answer = gh(['api', `/repos/${REPO}/contents/profile`, '--jq', '.[].name']);
  return answer.ok ? answer.out.split('\n').filter(Boolean) : [];
};
const caseVariantsOf = (target) => {
  const base = target.split('/').pop().toLowerCase();
  return profileFiles()
    .filter((name) => name.toLowerCase() === base && name !== target.split('/').pop())
    .map((name) => `profile/${name}`);
};
const source = (file) => readFileSync(path.join(ROOT, file));
const b64 = (file) => source(file).toString('base64');

function plan() {
  step(`the page for ${ORG}`);
  say(`  repository:  ${REPO}${repoExists() ? ' (exists)' : ' (does not exist yet)'}`);
  say('  writes:');
  for (const [target, from] of FILES) {
    const action = repoExists() && shaOf(target) ? 'update' : 'create';
    say(`    ${target.padEnd(35)} <- ${from}  (${action})`);
  }
  const variants = repoExists() ? FILES.flatMap(([target]) => caseVariantsOf(target)) : [];
  for (const variant of variants) {
    say(`    remove ${variant.padEnd(33)} (same file, other spelling: two copies would drift)`);
  }
  say('');
  say('  The page appears at https://github.com/' + ORG);
  say('  GitHub shows an organisation profile only once this repository is public.');
}

if (!APPLY) {
  plan();
  say('\n  run with --apply to create or update it.');
  process.exit(0);
}

if (!repoExists()) {
  step(`creating ${REPO}`);
  const made = gh(['repo', 'create', REPO, '--public', '--description', DESCRIPTION]);
  if (!made.ok) {
    fail(`cannot create ${REPO}: ${made.err}`);
    say('');
    say('   Creating a repository in an organisation needs Administration: write.');
    say('   Either grant it (organisation owner):');
    say(`     https://github.com/organizations/${ORG}/settings/installations`);
    say('     -> the Cline app -> Configure -> Administration: Read and write');
    say('');
    say('   or make the repository by hand once, and re-run this script to fill it:');
    say(`     https://github.com/organizations/${ORG}/repositories/new`);
    say(`     name: .github   visibility: public   (the name is the mechanism, not a typo)`);
    process.exit(1);
  }
  say(`  created ${made.out || REPO}`);
}

step('writing');
let failed = false;
for (const [target, from] of FILES) {
  const sha = shaOf(target);
  const argv = [
    'api', '-X', 'PUT', `/repos/${REPO}/contents/${target}`,
    '-f', `message=org profile: ${target} from ${from}`,
    '-f', `content=${b64(from)}`,
  ];
  if (sha) argv.push('-f', `sha=${sha}`);
  const written = gh(argv);
  say(`  ${written.ok ? 'wrote' : 'FAILED'} ${target}`);
  if (!written.ok) {
    say(`    ${written.err}`);
    failed = true;
  }
}
// A copy of the page under another spelling is not a write, it is a removal:
// leaving both means the next edit changes one of them and the page shows the other.
for (const [target] of FILES) {
  for (const variant of caseVariantsOf(target)) {
    const sha = shaOf(variant);
    if (!sha) continue;
    const removed = gh([
      'api', '-X', 'DELETE', `/repos/${REPO}/contents/${variant}`,
      '-f', `message=org profile: remove ${variant}, the documented name is ${target}`,
      '-f', `sha=${sha}`,
    ]);
    say(`  ${removed.ok ? 'removed' : 'FAILED '} ${variant}`);
    if (!removed.ok) {
      say(`    ${removed.err}`);
      failed = true;
    }
  }
}

if (failed) {
  // The distinction that costs the most time: a public repository can be *read*
  // by an app that is not installed on it, so "I can see it" and "I can write to
  // it" are different permissions and the 403 says neither.
  const installed = gh(['api', '/installation/repositories', '--paginate', '--jq', '.repositories[].full_name']);
  const onIt = installed.ok ? installed.out.split('\n').filter(Boolean) : [];
  if (installed.ok && !onIt.includes(REPO)) {
    say('');
    fail(`this app can read ${REPO} (it is public) but not write to it.`);
    say(`   it is installed on: ${onIt.join(', ') || '(nothing)'}`);
    say('   Fix, in the browser — same page as the other permissions, one click:');
    say(`     https://github.com/organizations/${ORG}/settings/installations`);
    say(`     -> the Cline app -> Configure -> Repository access -> add ${REPO}`);
  }
  process.exit(1);
}

step('read back');
for (const [target, from] of FILES) {
  const answer = gh(['api', `/repos/${REPO}/contents/${target}`, '--jq', '.content']);
  const live = answer.ok ? answer.out.replace(/\s+/g, '') : '';
  say(`  ${live === b64(from) ? 'ok      ' : 'MISMATCH'} ${target}`);
  if (live !== b64(from)) failed = true;
}
say('');
step('what a visitor sees');
try {
  const page = await (await fetch(`https://github.com/${ORG}`)).text();
  const hasTagline = page.includes('Your mail. Your records. Your rock.');
  say(`  ${hasTagline ? 'ok     ' : 'MISSING'} the page carries the README`);
  if (!hasTagline) failed = true;
  // The images are the part that fails quietly: a page can look written and
  // still show a broken image, because the file it points at is in a private
  // repository that a visitor cannot open.
  if (page.includes('Fyrhaven-CRM/blob/')) {
    say('  WARNING the page\'s images point into another repository');
    say('          (Fyrhaven-CRM, which is private): visitors get a broken image.');
    say('          They must live in this one, referenced relatively.');
    failed = true;
  }
} catch (error) {
  say(`  could not read the page: ${error.message}`);
}

for (const [target] of FILES) {
  const url = `https://raw.githubusercontent.com/${REPO}/main/${target}`;
  try {
    const response = await fetch(url);
    say(`  ${response.status === 200 ? 'ok     ' : 'BROKEN '} ${target} (${response.status})`);
    if (response.status !== 200) failed = true;
  } catch (error) {
    say(`  BROKEN  ${target}: ${error.message}`);
    failed = true;
  }
}

say('');
say(`The page is https://github.com/${ORG} — GitHub renders it from`);
say(`${REPO}/profile/README.md, and the repository must stay public for it to show.`);
process.exit(failed ? 1 : 0);
