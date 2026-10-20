// @vitest-environment jsdom
// The plugin as the webmail gets it: bundled with esbuild, evaluated as
// CommonJS with a require that only knows React, '@plugin-host' and the kit.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import * as React from 'react';
import { cleanup } from '@testing-library/react';
import { fakeApi } from '../test-utils/fake-api.mjs';
import * as kit from '../test-utils/ui-kit.mjs';

const ROOT = process.cwd();
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
afterEach(cleanup);

// Built by `npm run build` — npm runs it through pretest before vitest.
const code = readFileSync(path.join(ROOT, 'dist', 'index.js'), 'utf8');

function load(api) {
  const mod = { exports: {} };
  const known = { react: React, '@plugin-host': api, '@plugin-host/ui': kit };
  const require = (name) => {
    if (name in known) return known[name];
    throw new Error(`module ${name} is not available`);
  };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports.default ?? mod.exports;
}

const pluginApi = (settings = {}, handlers = {}) => fakeApi({
  translations: manifest.locales,
  settings,
  handlers: { 'contacts.list': async () => [], 'addressBooks.list': async () => [], ...handlers },
});

describe('built plugin', () => {
  it('exports its slots and hooks, each surface covered by a permission', () => {
    const plugin = load(pluginApi());
    expect(Object.keys(plugin.slots).sort()).toEqual(['app-page', 'contact-detail-section', 'plugin-dialog']);
    for (const slot of Object.values(plugin.slots)) expect(typeof slot.component).toBe('function');
    expect(typeof plugin.hooks.onAction).toBe('function');
    expect(typeof plugin.activate).toBe('function');
    for (const permission of ['contacts:read', 'contacts:write', 'ui:app-page', 'ui:contacts', 'ui:commands']) {
      expect(manifest.permissions, permission).toContain(permission);
    }
  });

  it('activate registers the page and the buttons with translated labels', async () => {
    const api = pluginApi();
    const plugin = load(api);
    await plugin.activate(api);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.calls('ui.setPages')[0].args[0])
      .toEqual([{ id: 'duplicates', title: 'Contact Manager', icon: 'users' }]);
    expect(api.calls('ui.setActions').map((c) => c.args[0]))
      .toEqual(['command-palette', 'contact-list-actions']);
    expect(api.calls('ui.setActions')[0].args[1])
      .toEqual([{ id: 'scan', label: 'Find duplicate contacts', icon: 'copy' }]);
    expect(api.calls('ui.setActions')[1].args[1])
      .toEqual([{ id: 'scan-selection', label: 'Find duplicates in selection', icon: 'copy' }]);
  });

  it('re-publishes on locale change and clears when disabled', async () => {
    const api = pluginApi();
    const plugin = load(api);
    await plugin.activate(api);
    api.setLocale('de');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.calls('ui.setPages').at(-1).args[0][0].title).toBe('Kontakt-Manager');
    api.changeSettings({ enabled: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.calls('ui.setPages').at(-1).args[0]).toEqual([]);
    expect(api.calls('ui.setActions').at(-1).args[1]).toEqual([]);
  });

  it('onAction scans all contacts and opens the review dialog', async () => {
    const cards = [
      { id: 'c1', name: { full: 'Same' }, emails: { e: { address: 's@x.de' } } },
      { id: 'c2', name: { full: 'Same' }, emails: { e: { address: 's@x.de' } } },
    ];
    const api = pluginApi({}, { 'contacts.list': async () => cards, 'ui.openDialog': async () => null });
    const plugin = load(api);
    await plugin.hooks.onAction({ surface: 'command-palette', actionId: 'scan', context: {} });
    const call = api.calls('ui.openDialog')[0];
    expect(call.args[0]).toMatchObject({ slot: 'plugin-dialog', title: 'Merge duplicate contacts' });
    expect(call.args[0].extraProps.groups[0].members.map((m) => m.id)).toEqual(['c1', 'c2']);
  });

  it('scan-selection asks for a selection, then scans only those contacts', async () => {
    const cards = [
      { id: 'c1', name: { full: 'Same' }, emails: { e: { address: 's@x.de' } } },
      { id: 'c2', name: { full: 'Same' }, emails: { e: { address: 's@x.de' } } },
      { id: 'c3', name: { full: 'Same' }, emails: { e: { address: 's@x.de' } } },
    ];
    const api = pluginApi({}, { 'contacts.list': async () => cards, 'ui.openDialog': async () => null });
    const plugin = load(api);
    await plugin.hooks.onAction({ surface: 'contact-list-actions', actionId: 'scan-selection', context: {} });
    expect(api.calls('toast.info').at(-1).args[0]).toBe('Select the contacts to check first.');

    await plugin.hooks.onAction({ surface: 'contact-list-actions', actionId: 'scan-selection', context: { contactIds: ['c1', 'c2'] } });
    const members = api.calls('ui.openDialog')[0].args[0].extraProps.groups[0].members.map((m) => m.id);
    expect(members).toEqual(['c1', 'c2']);
  });

  it('shouldShow follows the enabled setting', () => {
    const plugin = load(pluginApi({ enabled: false }));
    expect(plugin.slots['app-page'].shouldShow()).toBe(false);
    expect(plugin.slots['contact-detail-section'].shouldShow()).toBe(false);
  });
});

describe('locales', () => {
  const sourceKeys = () => {
    const files = readdirSync(path.join(ROOT, 'src'), { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('.js'));
    const sources = files.map((file) => readFileSync(path.join(ROOT, 'src', file), 'utf8')).join('\n');
    const keys = new Set();
    for (const match of sources.matchAll(/\bt\(\s*'([^']+)'/g)) keys.add(match[1]);
    for (const match of sources.matchAll(/\bi18n\.t\(\s*'([^']+)'/g)) keys.add(match[1]);
    return keys;
  };

  it('defines every string the source asks for, in en and de', () => {
    const keys = sourceKeys();
    expect(keys.size).toBeGreaterThan(20);
    for (const key of keys) {
      expect(manifest.locales.en, `en: ${key}`).toHaveProperty(key);
      expect(manifest.locales.de, `de: ${key}`).toHaveProperty(key);
    }
  });

  it('translates every settingsSchema label and description', () => {
    for (const field of Object.values(manifest.settingsSchema)) {
      for (const value of [field.label, field.description]) {
        if (!value) continue;
        expect(manifest.locales.en, `en: ${value}`).toHaveProperty(value);
        expect(manifest.locales.de, `de: ${value}`).toHaveProperty(value);
      }
    }
  });
});
