// In-app help (#39): the cheatsheet is derived from the search box's own
// constants, so it cannot describe an operator the box does not have — and every
// example is asserted to parse. Pure.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  HAS_VALUES, IS_VALUES_LIST, QUERY_EXAMPLES, QUERY_OPERATORS, SHORTCUTS, WHATS_NEW,
} from '../src/lib/help.js';
import { FIELDS, HAS_FLAGS, IS_VALUES, parseQuery } from '../src/lib/search.js';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));

describe('the search cheatsheet', () => {
  it('lists every field operator the box understands, and nothing else', () => {
    expect(QUERY_OPERATORS.map((entry) => entry.field)).toEqual(FIELDS);
    for (const entry of QUERY_OPERATORS) expect(entry.token).toBe(`${entry.field}:`);
  });

  it('lists the has: and is: values from the parser itself', () => {
    expect(HAS_VALUES).toEqual(HAS_FLAGS);
    expect(IS_VALUES_LIST).toEqual(IS_VALUES);
  });

  it('every worked example parses without an error', () => {
    for (const example of QUERY_EXAMPLES) {
      expect(parseQuery(example).errors, example).toEqual([]);
    }
  });

  it('the examples show AND, OR, grouping and both ways to exclude', () => {
    expect(QUERY_EXAMPLES).toContain('tag:vip tag:customer');
    expect(QUERY_EXAMPLES).toContain('tag:vip OR tag:customer');
    expect(QUERY_EXAMPLES).toContain('(tag:vip OR tag:customer) has:email');
    expect(QUERY_EXAMPLES).toContain('-tag:vip');
    expect(QUERY_EXAMPLES).toContain('not:tag:vip');
  });

  it('a field in the cheatsheet really filters (so the help is true)', () => {
    const parsed = parseQuery('tag:vip');
    expect(parsed.errors).toEqual([]);
    expect(parsed.filters).toEqual([{ field: 'tag', value: 'vip' }]);
  });
});

describe('the keyboard shortcuts', () => {
  it('names the palette, the search focus and the clear key', () => {
    expect(SHORTCUTS.map((shortcut) => shortcut.keys.join('+'))).toEqual(['Ctrl+K', '/', 'Esc']);
  });

  it('every shortcut has its label in both locales', () => {
    for (const shortcut of SHORTCUTS) {
      expect(manifest.locales.en[shortcut.label], shortcut.label).toBeTruthy();
      expect(manifest.locales.de[shortcut.label], shortcut.label).toBeTruthy();
    }
  });
});

describe("what's new", () => {
  it('is newest first and every version is a semver', () => {
    const versions = WHATS_NEW.map((entry) => entry.version);
    const sorted = [...versions].sort((a, b) => {
      const [a1, a2, a3] = a.split('.').map(Number);
      const [b1, b2, b3] = b.split('.').map(Number);
      return (b1 - a1) || (b2 - a2) || (b3 - a3);
    });
    expect(versions).toEqual(sorted);
    for (const version of versions) expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('every note exists in both locales', () => {
    for (const entry of WHATS_NEW) {
      expect(manifest.locales.en[entry.note], entry.note).toBeTruthy();
      expect(manifest.locales.de[entry.note], entry.note).toBeTruthy();
    }
  });
});
