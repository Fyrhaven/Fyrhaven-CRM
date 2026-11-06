#!/usr/bin/env node
// Package the **self-hosted** server.
//
// The cloud service in this folder is never distributed. This copies the parts a
// customer actually runs — the record API and the licence check — into its own
// archive, rewrites the build constant so that copy cannot enter cloud mode, and
// replaces the cloud's operator modules with stubs whose code is not in the
// archive at all.
//
//   node scripts/dist.mjs            # write dist/fyrhaven-selfhost-<version>.tar.gz
//   node scripts/dist.mjs --check    # the plan and the assertions, writing nothing
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const CHECK = process.argv.includes('--check');
const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const OUT = path.join(ROOT, 'dist', `fyrhaven-selfhost-${version}`);

/** What a customer gets. `site/` is not here, and neither is any cloud module. */
const FILES = [
  ['server.js', 'server.js'],
  ['storage.js', 'storage.js'],
  ['s3.js', 's3.js'],
  ['licence.js', 'licence.js'],
  ['package.json', 'package.json'],
  ['LICENSING.md', 'LICENSING.md'],
  ['packaging/Dockerfile.selfhost', 'Dockerfile'],
  ['packaging/docker-compose.selfhost.yml', 'docker-compose.yml'],
  ['packaging/env.example', '.env.example'],
  ['packaging/README.selfhost.md', 'README.md'],
];

const absent = (what) => `// Cloud-only file, absent from the self-hosted build.
//
// It exists here so the module graph resolves. Every entry point throws, because
// nothing on this server can reach one: the surfaces that would call them are not
// mounted, and the routes answer 404 before they get this far.
const absent = (name) => () => {
  throw new Error(\`\${name} belongs to the cloud build — ${what}\`);
};
`;

/** The cloud's modules, as stubs. Their real code is not in the archive. */
const STUBS = {
  'accounts.js': `${absent('this server has no customer accounts')}
export const accountOps = absent('accountOps');
export const accountWorkspace = absent('accountWorkspace');
export const openAccountTables = absent('openAccountTables');
export const DEFAULT_TRIAL_DAYS = 0;
export const SESSION_DAYS = 0;
`,
  'catalog.js': `${absent('this server sells nothing')}
export const catalogOps = absent('catalogOps');
export const defaultCatalogue = absent('defaultCatalogue');
export const openCatalogTables = absent('openCatalogTables');
`,
  'payments.js': `${absent('this server takes no payments')}
// Answers rather than throws: startup asks once for the payment provider, and a
// build that cannot take money has nothing to configure.
export const paymentConfig = () => ({
  provider: 'none', available: false, webhookSecret: '', planDays: 0,
});
export const createCheckout = absent('createCheckout');
export const createStripePrice = absent('createStripePrice');
export const planFromEvent = absent('planFromEvent');
export const verifyStripeSignature = absent('verifyStripeSignature');
`,
};

const say = (line = '') => console.log(line);
const fail = (line) => { console.error(`\n!! ${line}`); process.exit(1); };

function plan() {
  say(`\n== the self-hosted build, ${version}\n`);
  say('  ships:');
  for (const [from, to] of FILES) say(`    ${to.padEnd(22)} <- ${from}`);
  say('  replaces with stubs (cloud code is not in the archive):');
  for (const name of Object.keys(STUBS)) say(`    ${name}`);
  say('  rewrites:');
  say("    distribution.js        DISTRIBUTION = 'selfhosted'");
  say('  leaves out:');
  say('    site/ (the shop and the panel), server.test.js, docs/, the cloud compose file');
}

if (CHECK) {
  plan();
  for (const [from] of FILES) {
    if (!existsSync(path.join(ROOT, from))) fail(`missing source file: ${from}`);
  }
  say('\n  every source file is present; nothing written.');
  process.exit(0);
}

rmSync(path.join(ROOT, 'dist'), { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
plan();

for (const [from, to] of FILES) {
  const source = path.join(ROOT, from);
  if (!existsSync(source)) fail(`missing source file: ${from}`);
  cpSync(source, path.join(OUT, to));
}

const distribution = readFileSync(path.join(ROOT, 'distribution.js'), 'utf8')
  .replace("export const DISTRIBUTION = 'cloud';", "export const DISTRIBUTION = 'selfhosted';");
if (!distribution.includes("export const DISTRIBUTION = 'selfhosted';")) {
  fail('could not rewrite the build constant — distribution.js changed shape');
}
writeFileSync(path.join(OUT, 'distribution.js'), distribution);

for (const [name, body] of Object.entries(STUBS)) {
  writeFileSync(path.join(OUT, name), body);
}

writeFileSync(path.join(OUT, 'BUILD'), [
  `Fyrhaven record server ${version} — self-hosted build`,
  '',
  'This archive is not the cloud service. Nothing of the cloud is mounted here:',
  'no shop, no customer accounts, no billing routes, no operator panel, and no',
  'cloud mode (that constant is compiled in, so no environment variable can turn',
  'this copy into the operator\'s service).',
  '',
  "accounts.js, catalog.js and payments.js are stubs in this archive — the",
  "operator's account, catalogue and Stripe code is not in it.",
  '',
  'Still to do, and known: server.js carries the cloud route *implementations*',
  'inline. They are unreachable (closedSurface answers 404 before they run) but',
  'the code is present. Extracting them into the cloud build is the next step.',
  '',
].join('\n'));

// The assertions that matter, made against what was actually written.
const problems = [];
if (existsSync(path.join(OUT, 'site'))) problems.push('site/ is in the archive');
for (const name of ['accounts.js', 'catalog.js', 'payments.js']) {
  const size = statSync(path.join(OUT, name)).size;
  if (size > 1200) problems.push(`${name} is ${size} bytes — that is the cloud's code, not a stub`);
}
if (!readFileSync(path.join(OUT, 'distribution.js'), 'utf8').includes("'selfhosted'")) {
  problems.push('the build constant still says cloud');
}
if (problems.length) for (const problem of problems) fail(problem);

const archive = path.join(ROOT, 'dist', `fyrhaven-selfhost-${version}.tar.gz`);
execFileSync('tar', ['-czf', archive, '-C', path.join(ROOT, 'dist'), path.basename(OUT)]);
const kb = Math.round(statSync(archive).size / 1024);
say(`\n  wrote ${path.relative(ROOT, archive)} (${kb} kB)`);
say(`  ${path.relative(ROOT, OUT)}/ is the unpacked form`);
