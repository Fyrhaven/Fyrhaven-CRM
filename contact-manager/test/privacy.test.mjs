// The GDPR toolkit (#26): the subject-access export, anonymisation, erasure
// and the proof-of-deletion log.
import { describe, expect, it } from 'vitest';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { filesHost } from '../test-utils/files-host.mjs';
import { read } from '../src/lib/store.js';
import { makeCard } from './fixtures.mjs';
import { isAnonymisedCard, isMergeable } from '../src/lib/contacts.js';
import { readConsents, setConsent } from '../src/lib/consent.js';
import { readNotes, saveNote } from '../src/lib/notes.js';
import { readHistory } from '../src/lib/history.js';
import { readUndo } from '../src/lib/undo.js';
import {
  ANONYMISED_NAME, DELETION_KEY, MAX_DELETIONS, anonymisePatch, anonymiseSubject,
  buildSubjectExport, deleteConsent, deletionSummary, deletionsToCsv, eraseSubject,
  normalizeDeletion, normalizeDeletions, personalDataInventory, readDeletions, recordDeletion,
  saveConsent, subjectExportJson, subjectExportName,
} from '../src/lib/privacy.js';

const FULL = makeCard({
  id: 'a', name: 'Ada Lovelace', emails: ['ada@example.org'], phones: ['+491761234567'],
  organizations: { o1: { name: 'Analytical Engines' } }, titles: { t1: { name: 'Countess' } },
  notes: { n1: { note: 'met at a talk' } }, keywords: { vip: true },
});

describe('personalDataInventory', () => {
  it('lists the personal fields a card actually holds', () => {
    const inventory = personalDataInventory(FULL);
    expect(inventory.fields).toEqual(expect.arrayContaining(['name', 'emails', 'phones', 'organizations', 'titles', 'notes', 'keywords']));
    expect(inventory.emails).toBe(1);
    expect(inventory.phones).toBe(1);
    expect(inventory.empty).toBe(false);
  });

  it('is empty for a card with no personal data', () => {
    expect(personalDataInventory({ id: 'x', addressBookIds: { b1: true } }).empty).toBe(true);
  });
});

describe('anonymisePatch', () => {
  it('clears every personal field and keeps a tombstone marker', () => {
    const patch = anonymisePatch(FULL);
    for (const field of ['name', 'emails', 'phones', 'organizations', 'titles', 'notes']) {
      expect(patch[field]).not.toBe(FULL[field]);
    }
    expect(patch.emails).toBeUndefined();
    expect(patch.name).toEqual({ full: ANONYMISED_NAME });
    expect(patch.keywords).toEqual({ anonymised: true });
    expect(patch.kind).toBe('individual');
  });
});

describe('an anonymised tombstone', () => {
  it('is never mergeable, however the host spells its kind', () => {
    expect(isAnonymisedCard({ keywords: { anonymised: true } })).toBe(true);
    expect(isAnonymisedCard({ kind: 'anonymised' })).toBe(true);
    expect(isMergeable({ id: 'a', keywords: { anonymised: true } })).toBe(false);
    expect(isMergeable({ id: 'a', kind: 'anonymised' })).toBe(false);
    expect(isMergeable({ id: 'a' })).toBe(true);
  });
});

describe('buildSubjectExport', () => {
  it('hands back the whole card, and only the subject’s consents and changes', () => {
    const bundle = buildSubjectExport({
      card: FULL,
      consents: [
        { contactId: 'a', source: 'newsletter', basis: 'consent', grantedAt: '2026-01-01', expiresAt: null, note: '' },
        { contactId: 'b', source: 'newsletter', basis: 'consent', grantedAt: '2026-01-01', expiresAt: null, note: '' },
      ],
      history: [
        { at: 1, kind: 'consent', contacts: 1, subject: 'a', detail: 'newsletter' },
        { at: 2, kind: 'merge', contacts: 2 },
      ],
      now: Date.UTC(2026, 0, 1),
    });
    // completeness: every field of the card is in the export
    expect(bundle.data).toEqual(FULL);
    expect(bundle.subject).toEqual({ id: 'a', name: 'Ada Lovelace' });
    expect(bundle.generatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(bundle.consents).toHaveLength(1);
    expect(bundle.changes.map((entry) => entry.kind)).toEqual(['consent']);
    expect(subjectExportJson(bundle)).toContain('"Ada Lovelace"');
  });

  it('hands back the private notes held about the subject (#38)', () => {
    const note = { id: 'n1', at: '2026-01-01T00:00:00Z', text: 'met at a talk' };
    const bundle = buildSubjectExport({ card: FULL, notes: [note] });

    // the notes are personal data this browser holds, so completeness means them
    expect(bundle.notes).toEqual([note]);
    expect(subjectExportJson(bundle)).toContain('met at a talk');
  });

  it('reads no notes as an empty list', () => {
    expect(buildSubjectExport({ card: FULL }).notes).toEqual([]);
    expect(buildSubjectExport({ card: FULL, notes: 'nonsense' }).notes).toEqual([]);
  });

  it('names the file after the subject', () => {
    expect(subjectExportName(FULL, 'json')).toBe('ada-lovelace.json');
    expect(subjectExportName(FULL, 'csv')).toBe('ada-lovelace.csv');
    expect(subjectExportName(FULL, 'vcard')).toBe('ada-lovelace.vcf');
    expect(subjectExportName({ id: '' }, 'json')).toBe('contact.json');
  });
});


describe('the deletion log', () => {
  it('repairs an entry and needs an id and a method', () => {
    expect(normalizeDeletion({ at: 5, id: 'a', method: 'erase', fields: ['name', 'name'], books: ['b1'] }))
      .toEqual({ at: 5, id: 'a', method: 'erase', fields: ['name'], books: ['b1'] });
    expect(normalizeDeletion({ id: 'a', method: 'nonsense' })).toBeNull();
    expect(normalizeDeletion({ method: 'erase' })).toBeNull();
    expect(normalizeDeletion(null)).toBeNull();
  });

  it('keeps the newest first, caps the list, and survives junk', async () => {
    const api = fakeApi();
    await api.storage.set(DELETION_KEY, [{ id: 'a', method: 'erase', at: 1 }, { junk: true }]);
    await recordDeletion(api, { id: 'b', method: 'anonymise' }, 2);
    const log = await readDeletions(api);
    expect(log.map((entry) => entry.id)).toEqual(['b', 'a']);
    expect(await api.storage.get(DELETION_KEY)).toEqual(log);
    const many = Array.from({ length: MAX_DELETIONS + 5 }, (_, i) => ({ at: i + 1, id: `c${i}`, method: 'erase', fields: [], books: [] }));
    expect(normalizeDeletions(many)).toHaveLength(MAX_DELETIONS);
  });

  it('never lets a failed write of the note reach the caller', async () => {
    const api = fakeApi();
    api.storage.set = async () => { throw new Error('quota'); };
    await expect(recordDeletion(api, { id: 'a', method: 'erase' })).resolves.toBeNull();
  });

  it('summarises and exports as a CSV report', async () => {
    const log = normalizeDeletions([
      { at: 2, id: 'a', method: 'erase', fields: ['name'], books: ['b1'] },
      { at: 1, id: 'b', method: 'anonymise', fields: ['emails'], books: [] },
    ]);
    expect(deletionSummary(log)).toEqual({ total: 2, erased: 1, anonymised: 1 });
    const csv = deletionsToCsv(log);
    expect(csv.split('\r\n')[0]).toBe('Erased at,Subject id,Method,Fields,Address books');
    expect(csv).toContain('a,erase,name,b1');
  });
});

describe('anonymiseSubject', () => {
  it('overwrites the card, drops its consents and records the change', async () => {
    const files = filesHost();
    const api = fakeApi({
      host: files.host,
      handlers: { ...files.handlers, 'contacts.update': async () => {} },
    });
    await setConsent(api, { contactId: 'a', source: 'newsletter', basis: 'consent', grantedAt: '2026-01-01' });
    await saveNote(api, 'a', 'a private thought', { id: 'n1' });
    const result = await anonymiseSubject(api, FULL, { now: 1000 });

    expect(result.anonymised).toBe(true);
    const [id, patch] = api.calls('contacts.update')[0].args;
    expect(id).toBe('a');
    expect(patch.name).toEqual({ full: ANONYMISED_NAME });
    expect(patch.emails).toBeUndefined();
    expect(await readConsents(api)).toEqual([]);
    // the private notes go too, or the anonymisation would be a half-measure
    expect(result.notes).toBe(1);
    expect((await read(api, 'contactNotes')).value).toBeNull();
    expect((await readDeletions(api))[0]).toMatchObject({ id: 'a', method: 'anonymise', books: ['b1'] });
    expect((await readHistory(api))[0]).toMatchObject({ kind: 'anonymise', subject: 'a' });
  });
});

describe('eraseSubject', () => {
  it('deletes the card, drops its consents, and leaves a proof of deletion', async () => {
    const files = filesHost();
    const api = fakeApi({
      host: files.host,
      handlers: { ...files.handlers, 'contacts.remove': async () => {} },
    });
    await setConsent(api, { contactId: 'a', source: 'newsletter', basis: 'consent', grantedAt: '2026-01-01' });
    await saveNote(api, 'a', 'a private thought', { id: 'n1' });
    const result = await eraseSubject(api, FULL, { now: 1000 });

    expect(result.erased).toBe(true);
    expect(api.calls('contacts.remove')[0].args[0]).toBe('a');
    expect(await readConsents(api)).toEqual([]);
    // erasure takes the private notes with it
    expect(result.notes).toBe(1);
    expect((await read(api, 'contactNotes')).value).toBeNull();
    expect((await readDeletions(api))[0]).toMatchObject({ id: 'a', method: 'erase' });
    expect((await readHistory(api))[0]).toMatchObject({ kind: 'erase' });
    // the delete left an undo record, like every other delete
    expect((await readUndo(api, 1000))[0].entries[0].removed[0].id).toBe('a');
  });

  it('records nothing when the host refuses the delete', async () => {
    const api = fakeApi({ handlers: { 'contacts.remove': async () => { throw new Error('nope'); } } });
    const result = await eraseSubject(api, FULL);
    expect(result.erased).toBe(false);
    expect(result.failed).toBe(1);
    expect(await readDeletions(api)).toEqual([]);
  });
});

describe('consent changes are audited', () => {
  it('records a save and a removal, tied to the subject', async () => {
    const api = fakeApi();
    await saveConsent(api, { contactId: 'a', source: 'newsletter', basis: 'consent', grantedAt: '2026-01-01' }, 10);
    await deleteConsent(api, 'a', 'newsletter', 20);
    const entries = await readHistory(api);
    expect(entries.map((entry) => entry.kind)).toEqual(['consent', 'consent']);
    expect(entries.every((entry) => entry.subject === 'a')).toBe(true);
    expect(entries[0].detail).toBe('newsletter');
  });

  it('records nothing when the save is unusable or the removal finds nothing', async () => {
    const api = fakeApi();
    await saveConsent(api, { contactId: '', source: 'x' });
    await deleteConsent(api, 'a', 'missing');
    expect(await readHistory(api)).toEqual([]);
  });
});
