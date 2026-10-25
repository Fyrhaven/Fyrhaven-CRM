// Remembered column mappings: what is kept, what is replaced, and what is
// cleaned up on the way in.
import { describe, expect, it } from 'vitest';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { mappingKey } from '../src/lib/import-fields.js';
import {
  MAX_TEMPLATES, deleteTemplate, findTemplate, normalizeTemplates, readTemplates, saveTemplate,
} from '../src/lib/import-templates.js';

const api = () => fakeApi({});
const GOOGLE = ['Given Name', 'Family Name', 'E-mail 1 - Value'];
const MAPPING = ['given', 'surname', 'email'];

describe('normalizeTemplates', () => {
  it('keeps keyed entries with a mapping and drops the rest', () => {
    expect(normalizeTemplates([
      { key: 'k1', mapping: ['given', 'email'] },
      { key: '', mapping: ['given'] },
      { key: 'k2', mapping: [] },
      null,
      { key: 'k3', mapping: ['ignore', 'phone'] },
    ])).toEqual([
      { key: 'k1', headers: [], mapping: ['given', 'email'] },
      { key: 'k3', headers: [], mapping: ['ignore', 'phone'] },
    ]);
  });

  it('de-duplicates by key, and keeps the newest', () => {
    expect(normalizeTemplates([
      { key: 'k1', mapping: ['given'] },
      { key: 'k1', mapping: ['surname'] },
    ])).toEqual([{ key: 'k1', headers: [], mapping: ['given'] }]);
  });

  it('caps the list', () => {
    const many = Array.from({ length: MAX_TEMPLATES + 5 }, (_, i) => ({ key: `k${i}`, mapping: ['given'] }));

    expect(normalizeTemplates(many)).toHaveLength(MAX_TEMPLATES);
    expect(normalizeTemplates('not a list')).toEqual([]);
  });
});

describe('the template store', () => {
  it('remembers a mapping and finds it by its headers', async () => {
    const subject = api();

    await saveTemplate(subject, GOOGLE, MAPPING);

    const found = await findTemplate(subject, GOOGLE);
    expect(found.mapping).toEqual(MAPPING);
    expect(found.headers).toEqual(GOOGLE);
  });

  it('finds the same headers however the punctuation is spelled', async () => {
    const subject = api();
    await saveTemplate(subject, ['E-mail 1 - Value'], ['email']);

    expect(await findTemplate(subject, ['E-mail_1_Value'])).not.toBeNull();
  });

  it('says nothing for headers it has never seen', async () => {
    const subject = api();
    await saveTemplate(subject, GOOGLE, MAPPING);

    expect(await findTemplate(subject, ['Something', 'Else'])).toBeNull();
  });

  it('replaces the mapping for the same headers', async () => {
    const subject = api();
    await saveTemplate(subject, GOOGLE, MAPPING);
    await saveTemplate(subject, GOOGLE, ['ignore', 'surname', 'phone']);

    const templates = await readTemplates(subject);
    expect(templates).toHaveLength(1);
    expect(templates[0].mapping).toEqual(['ignore', 'surname', 'phone']);
  });

  it('refuses a mapping with no headers and one that is empty', async () => {
    const subject = api();

    await saveTemplate(subject, [], MAPPING);
    await saveTemplate(subject, GOOGLE, []);

    expect(await readTemplates(subject)).toEqual([]);
  });

  it('forgets one, and clears storage with the last', async () => {
    const subject = api();
    await saveTemplate(subject, GOOGLE, MAPPING);
    await saveTemplate(subject, ['Name'], ['name']);

    expect(await deleteTemplate(subject, mappingKey(GOOGLE))).toHaveLength(1);
    await deleteTemplate(subject, mappingKey(['Name']));
    expect(subject.storageSnapshot().importMappings).toBeUndefined();
  });

  it('repairs junk left in storage', async () => {
    const subject = api();
    await subject.storage.set('importMappings', [{ key: 'k1', mapping: ['given'] }, { junk: true }]);

    expect(await readTemplates(subject)).toEqual([{ key: 'k1', headers: [], mapping: ['given'] }]);
    expect(subject.storageSnapshot().importMappings).toHaveLength(1);
  });
});
