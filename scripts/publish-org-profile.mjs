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
  ['profile/lockup.svg', 'brand/fyrhaven-lockup.svg'],
  ['profile/lockup-dark.svg', 'brand/fyrhaven-lockup-dark.svg'],
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
const source = (file) => readFileSync(path.join(ROOT, file));
const b64 = (file) => source(file).toString('base64');

function plan() {
  step(`the page for ${ORG}`);
  say(`  repository:  ${REPO}${repoExists() ? ' (exists)' : ' (does not exist yet)'}`);
  say('  writes:');
  for (const [target, from] of FILES) {
    const action = repoExists() && shaOf(target) ? 'update' : 'create';
    say(`    ${target.padEnd(26)} <- ${from}  (${action})`);
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
if (failed) process.exit(1);

step('read back');
for (const [target, from] of FILES) {
  const answer = gh(['api', `/repos/${REPO}/contents/${target}`, '--jq', '.content']);
  const live = answer.ok ? answer.out.replace(/\s+/g, '') : '';
  say(`  ${live === b64(from) ? 'ok      ' : 'MISMATCH'} ${target}`);
  if (live !== b64(from)) failed = true;
}
say('');
say(`The page is https://github.com/${ORG} — GitHub renders it from`);
say(`${REPO}/profile/README.md, and the repository must stay public for it to show.`);
process.exit(failed ? 1 : 0);
