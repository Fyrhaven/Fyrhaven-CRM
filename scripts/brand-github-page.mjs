#!/usr/bin/env node
// The repository page's settings: description, website, topics.
//
// These are the only part of the branding that is not a file in this tree, and
// they need a permission the file-level credential does not have: writing them
// is `Administration: write` on the repository, where pushing a commit is
// `Contents: write`. So this script plans by default and prints the exact strings
// — the values are reviewable without running anything, and pasteable if the
// token can never be granted.
//
//   node scripts/brand-github-page.mjs              # the plan, and the blocker if it is there
//   node scripts/brand-github-page.mjs --apply      # write them
//
// What it deliberately does NOT do: the social preview image and the
// organisation's avatar and bio. GitHub exposes no API for any of the three, so
// they are clicks — `brand/README.md` says which file goes where.
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const REPO = process.env.FYRHAVEN_REPO ?? 'Fyrhaven/Fyrhaven-CRM';

// The description is the pitch in one breath: what it is, what it does, where the
// records live. It is the line a stranger reads before deciding to click.
const PAGE = {
  description:
    'Contacts, companies, projects and time for Bulwark Mail — find and merge '
    + 'duplicate contacts across every address book, keep notes and consent records '
    + 'on a server you own, and follow them between devices. Plus the record server '
    + 'they live on.',
  homepage: 'https://fyrhaven.com',
  topics: [
    'crm', 'contacts', 'address-book', 'duplicate-detection', 'email',
    'stalwart', 'bulwark-mail', 'webmail', 'plugin', 'self-hosted',
  ],
};

// The organisation's own description, which is a *different field* with a much
// smaller ceiling than the repository's: 160 characters, not 350. And it
// truncates silently — a 207-character paste was stored as exactly 160, ending
// mid-word ("…notes and conse") — so the length is checked here rather than
// discovered on the page after the fact.
const ORG = process.env.FYRHAVEN_ORG ?? 'Fyrhaven';
const ORG_LIMIT = 160;
const ORG_DESCRIPTION =
  'Mail hosting and record keeping for people who run their own mail server — '
  + 'a CRM for Bulwark Mail, and the record server behind it.';

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

/** The limit GitHub enforces on a topic string, so a bad one is caught here. */
const validTopic = (topic) => /^[a-z0-9][a-z0-9-]{0,49}$/.test(topic);

/** Over the ceiling is a hard stop: the field does not warn, it just cuts. */
function checkLengths() {
  const problems = [];
  if (ORG_DESCRIPTION.length > ORG_LIMIT) {
    problems.push(`the organisation description is ${ORG_DESCRIPTION.length} characters; `
      + `the field holds ${ORG_LIMIT} and truncates the rest silently.`);
  }
  return problems;
}

function printValues() {
  say('  description:');
  say(`    ${PAGE.description}`);
  say(`  website:     ${PAGE.homepage}`);
  say(`  topics:      ${PAGE.topics.join(', ')}`);
  say('');
  say(`  organisation description (${ORG_DESCRIPTION.length}/${ORG_LIMIT}):`);
  say(`    ${ORG_DESCRIPTION}`);
}

const current = gh(['api', `/repos/${REPO}`, '--jq', '.description, .homepage, (.topics | join(","))']);
if (!current.ok) {
  fail(`cannot read ${REPO}: ${current.err}`);
  process.exit(1);
}
const [liveDescription, liveHomepage, liveTopics] = current.out.split('\n');
const liveOrg = gh(['api', `/orgs/${ORG}`, '--jq', '.description']);

step(`the page for ${REPO}`);
say(`  description: ${liveDescription || '(unset)'}`);
say(`  website:     ${liveHomepage || '(unset)'}`);
say(`  topics:      ${liveTopics || '(none)'}`);
say('');
say(`  ${ORG} description: ${liveOrg.ok ? `"${liveOrg.out || '(unset)'}"` : '(cannot read)'}`);
if (liveOrg.ok && liveOrg.out.length === ORG_LIMIT && liveOrg.out !== ORG_DESCRIPTION) {
  say('  ^ exactly the ceiling, and not the string below it: that is what a silent');
  say('    truncation looks like, so check where it ends before trusting it.');
}

const junk = PAGE.topics.filter((topic) => !validTopic(topic));
if (junk.length) {
  fail(`not a valid GitHub topic: ${junk.join(', ')}`);
  process.exit(1);
}

const problems = checkLengths();
if (problems.length) {
  for (const problem of problems) fail(problem);
  process.exit(1);
}

const inStep =
  liveDescription === PAGE.description
  && liveHomepage === PAGE.homepage
  && liveTopics === PAGE.topics.join(',')
  && liveOrg.ok && liveOrg.out === ORG_DESCRIPTION;
if (inStep) {
  say('\n  already in step — nothing to write.');
  process.exit(0);
}

step('what would be written');
printValues();

if (!APPLY) {
  say('\n  run with --apply to write it — that is the step that needs');
  say('  Administration: write, and the only one this command cannot verify first.');
  process.exit(0);
}

step('writing');
const updated = gh([
  'api', '-X', 'PATCH', `/repos/${REPO}`,
  '-f', `description=${PAGE.description}`,
  '-f', `homepage=${PAGE.homepage}`,
]);
if (!updated.ok) {
  fail('GitHub refused the update: ' + updated.err);
  say('');
  say('   Reading the repository works, and pushing a commit works, because this');
  say('   credential holds Contents: write. Editing the repository itself is');
  say('   Administration: write, which the app was not granted.');
  say('');
  say('   Fix, in the browser (an organisation owner does this):');
  say('     https://github.com/organizations/Fyrhaven/settings/installations');
  say('     -> Cline -> Configure -> Repository permissions -> Administration: Read and write');
  say('');
  say('   Until then the values above are the ones to paste into');
  say(`     https://github.com/${REPO}/settings`);
  process.exit(1);
}

const topicArgs = ['api', '-X', 'PUT', `/repos/${REPO}/topics`];
for (const topic of PAGE.topics) topicArgs.push('-f', `names[]=${topic}`);
const topics = gh(topicArgs);
if (!topics.ok) {
  fail('the description and website were written, but the topics were refused: ' + topics.err);
  process.exit(1);
}

step('read back');
const after = gh(['api', `/repos/${REPO}`, '--jq', '.description, .homepage, (.topics | join(","))']).out.split('\n');
say(`  description: ${after[0] === PAGE.description ? 'ok' : 'MISMATCH'}`);
say(`  website:     ${after[1] === PAGE.homepage ? 'ok' : 'MISMATCH'}`);
say(`  topics:      ${after[2] === PAGE.topics.join(',') ? 'ok' : 'MISMATCH'}`);

step(`the ${ORG} description`);
const orgWrite = gh(['api', '-X', 'PATCH', `/orgs/${ORG}`, '-f', `description=${ORG_DESCRIPTION}`]);
let orgApplied = false;
if (orgWrite.ok) {
  const back = gh(['api', `/orgs/${ORG}`, '--jq', '.description']).out;
  orgApplied = back === ORG_DESCRIPTION;
  say(`  written, and read back: ${orgApplied ? 'ok' : 'MISMATCH — it was cut, check where it ends'}`);
} else {
  say(`  NOT written: ${orgWrite.err}`);
  say('');
  say('  The organisation description is its own permission (organisation');
  say('  administration), not the repository one. Paste it by hand — it is');
  say(`  ${ORG_DESCRIPTION.length} of ${ORG_LIMIT} characters, and the field cuts anything past`);
  say(`  ${ORG_LIMIT} without saying so:`);
  say(`    https://github.com/organizations/${ORG}/settings/profile`);
  say('');
  say(`    ${ORG_DESCRIPTION}`);
}

say('');
say('  Not settable from here, by anyone: the social preview image');
say('  (brand/fyrhaven-banner.png) and the org avatar and bio.');
process.exit(orgApplied ? 0 : 1);
