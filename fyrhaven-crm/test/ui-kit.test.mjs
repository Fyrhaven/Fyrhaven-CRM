// Guards the plugin's use of the UI kit: every component it imports must be a
// name the kit actually exports.
//
// A name that does not exist is `undefined` at run time, and React throws
// "Element type is invalid" the moment the page using it renders — which is
// exactly how a sub-tab can crash on open while every other tab works.
// `test-utils/ui-kit.mjs` stands in for the real kit (vitest aliases the
// module name to it), so the stand-in is the list of names this plugin may
// use. Keep it in step with the host's `lib/plugin-sandbox/ui-kit`.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as kit from '../test-utils/ui-kit.mjs';

const SRC = path.join(process.cwd(), 'src');
const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*'@plugin-host\/ui'/g;

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

function importedNames() {
  const names = new Set();
  for (const file of sourceFiles(SRC)) {
    for (const match of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
      for (const raw of match[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim();
        if (name) names.add(name);
      }
    }
  }
  return [...names].sort();
}

describe('@plugin-host/ui imports', () => {
  it('finds the imports it is meant to check', () => {
    expect(importedNames()).toEqual(expect.arrayContaining(['Button', 'SearchInput', 'Tabs']));
  });

  it('only imports names the kit exports', () => {
    expect(importedNames().filter((name) => !(name in kit))).toEqual([]);
  });
});
