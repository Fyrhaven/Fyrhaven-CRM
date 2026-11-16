#!/usr/bin/env node
// The installable archive of the self-hosted server.
//
// The folder is what a customer runs, so this does not stub anything out — it
// copies the files that are here, asserts that no cloud module came along, and
// writes `dist/fyrhaven-server-<version>.tar.gz`. A BUILD file travels inside
// it, because "which build is this?" has to be answerable without the archive's
// name.
//
//   node scripts/package.mjs            # build the archive
//   node scripts/package.mjs --dir DIR  # put it somewhere else
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const VERSION = String(pkg.version);

/** What a customer's archive holds — and nothing else. */
export const FILES = [
  'server.js', 'storage.js', 's3.js', 'licence.js',
  'package.json', 'CHANGELOG.md', 'README.md', 'LICENSING.md',
  'Dockerfile', 'docker-compose.yml', 'docker-compose.host.yml', 'Caddyfile', 'env.example',
];

/** The cloud's modules. If one of these exists, this is not the self-hosted server. */
export const CLOUD_FILES = [
  'cloud.js', 'accounts.js', 'catalog.js', 'payments.js', 'distribution.js', 'site', 'packaging',
];

const argDir = process.argv.indexOf('--dir');
const outDir = argDir > 0 ? resolve(process.argv[argDir + 1]) : join(root, 'dist');
const name = `fyrhaven-server-${VERSION}`;
const stage = join(outDir, name);

for (const file of FILES) {
  if (!existsSync(join(root, file))) {
    console.error(`!! ${file} is missing — that is not a complete archive`);
    process.exit(1);
  }
}
for (const file of CLOUD_FILES) {
  if (existsSync(join(root, file))) {
    console.error(`!! ${file} is present — the cloud is not supposed to be in this tree`);
    process.exit(1);
  }
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const file of FILES) cpSync(join(root, file), join(stage, file));

const commit = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();

writeFileSync(join(stage, 'BUILD'), [
  `fyrhaven-server ${VERSION}`,
  `built   ${new Date().toISOString()}`,
  `commit  ${commit}`,
  '',
  'This is the self-hosted record server: the record API, the auth and the',
  'licence gate, checked offline. It has no shop, no customer accounts, no',
  'billing and no operator panel, and it cannot be switched into the cloud',
  'service — that is a different repository and none of its code is here.',
  '',
].join('\n'));

const archive = join(outDir, `${name}.tar.gz`);
rmSync(archive, { force: true });
execFileSync('tar', ['-czf', archive, '-C', outDir, name], { stdio: 'inherit' });
rmSync(stage, { recursive: true, force: true });

const listing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
  .trim().split('\n').map((line) => line.replace(`${name}/`, '')).filter(Boolean);
console.log(`\n${archive}`);
console.log(`  ${VERSION}, ${listing.length - 1} files + BUILD`);
console.log(`  ${listing.filter((line) => !line.endsWith('/')).join(' ')}`);
console.log(`  ${(statSync(archive).size / 1024).toFixed(1)} kB`);
