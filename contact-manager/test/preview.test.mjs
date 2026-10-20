// The pure display shaping behind the review dialog: the complete details of
// the contact that will be kept, what the merge adds, and what it leaves out.
import { describe, expect, it } from 'vitest';
import { planMerge } from '../src/lib/duplicates.js';
import { conflictFields, previewCounts, previewFields } from '../src/lib/preview.js';
import { makeCard } from './fixtures.mjs';

const groupOf = (...members) => ({ members });
const field = (fields, name) => fields.find((entry) => entry.field === name);

describe('previewFields', () => {
  it('shows every field of the kept contact, not only what the merge adds', () => {
    const kept = makeCard({
      id: 'a',
      name: 'Bob Smith',
      emails: ['bob@x.de'],
      phones: ['+4917612345678'],
      addresses: { h: { full: 'Main Street 1, Berlin' } },
      notes: { n: { note: 'Friend' } },
      keywords: { family: true },
    });
    const twin = makeCard({ id: 'b', name: 'Bob Smith', emails: ['bob@x.de'] });
    const plan = planMerge(groupOf(kept, twin), 'a');
    const fields = previewFields(plan);

    expect(fields.map((entry) => entry.field)).toEqual(['name', 'emails', 'phones', 'addresses', 'notes', 'keywords']);
    expect(field(fields, 'phones').kept).toEqual(['+4917612345678']);
    expect(field(fields, 'addresses').kept).toEqual(['Main Street 1, Berlin']);
    expect(field(fields, 'notes').kept).toEqual(['Friend']);
    expect(field(fields, 'keywords').kept).toEqual(['family']);
    expect(fields.every((entry) => entry.added.length === 0)).toBe(true);
  });

  it('marks merged values as added and keeps their source contact', () => {
    const kept = makeCard({ id: 'a', name: 'Bob Smith', emails: ['bob@x.de'] });
    const twin = makeCard({ id: 'b', name: 'Bob Smith', emails: ['bob@x.de'], phones: ['+4917612345678'], notes: { n: { note: 'Friend' } } });
    const fields = previewFields(planMerge(groupOf(kept, twin), 'a'));

    expect(field(fields, 'phones').added).toEqual([{ value: '+4917612345678', fromId: 'b' }]);
    expect(field(fields, 'notes').added).toEqual([{ value: 'Friend', fromId: 'b' }]);
    expect(field(fields, 'phones').conflicts).toEqual([]);
  });

  it('flags a different single value of another contact as not merged', () => {
    const kept = makeCard({ id: 'a', name: 'Bob Smith', emails: ['bob@x.de'], organizations: { o: { name: 'Acme' } } });
    const twin = makeCard({ id: 'b', name: 'Robert Smith', emails: ['bob@x.de'], organizations: { o: { name: 'Globex' } } });
    const plan = planMerge(groupOf(kept, twin), 'a');
    const fields = previewFields(plan);

    expect(field(fields, 'name').kept).toEqual(['Bob Smith']);
    expect(field(fields, 'name').conflicts).toEqual([{ value: 'Robert Smith', fromId: 'b' }]);
    expect(field(fields, 'organizations').conflicts).toEqual([{ value: 'Globex', fromId: 'b' }]);
    expect(plan.patch.name).toBeUndefined();
    expect(plan.patch.organizations).toBeUndefined();
  });

  it('counts kept, added and conflicting values for the summary', () => {
    const kept = makeCard({ id: 'a', name: 'Bob Smith', emails: ['bob@x.de'], notes: { n: { note: 'Friend' } } });
    const twin = makeCard({ id: 'b', name: 'Robert Smith', emails: ['bob@x.de'], phones: ['+4917612345678'] });
    const fields = previewFields(planMerge(groupOf(kept, twin), 'a'));

    expect(previewCounts(fields)).toEqual({ kept: 3, added: 1, changed: 0, conflicts: 1 });
  });

  it('offers each conflicting value as a choice for the kept contact', () => {
    const kept = makeCard({ id: 'a', name: 'Bob Smith', emails: ['bob@x.de'], organizations: { o: { name: 'Acme' } } });
    const twin = makeCard({ id: 'b', name: 'Robert Smith', emails: ['bob@x.de'], organizations: { o: { name: 'Globex' } } });
    const fields = conflictFields(planMerge(groupOf(kept, twin), 'a'));

    expect(fields.map((entry) => entry.field)).toEqual(['name', 'organizations']);
    expect(fields[0].kept).toEqual(['Bob Smith']);
    expect(fields[0].options).toEqual([{ value: 'Robert Smith', fromId: 'b' }]);
  });

  it('shows a chosen donor value as changed and keeps the replaced value for context', () => {
    const kept = makeCard({ id: 'a', name: 'Bob Smith', emails: ['bob@x.de'] });
    const twin = makeCard({ id: 'b', name: 'Robert Smith', emails: ['bob@x.de'], phones: ['+4917612345678'] });
    const plan = planMerge(groupOf(kept, twin), 'a', { name: 'b' });
    const fields = previewFields(plan);
    const name = field(fields, 'name');

    expect(name.kept).toEqual([]);
    expect(name.previous).toEqual(['Bob Smith']);
    expect(name.changed).toEqual([{ value: 'Robert Smith', fromId: 'b' }]);
    expect(name.conflicts).toEqual([]);
    expect(previewCounts(fields)).toEqual({ kept: 1, added: 1, changed: 1, conflicts: 0 });
  });

  it('shows the details of whichever contact is selected to keep', () => {
    const first = makeCard({ id: 'a', name: 'Bob Smith', emails: ['bob@x.de'], notes: { n: { note: 'Friend' } } });
    const second = makeCard({ id: 'b', name: 'Bob Smith', emails: ['bob@x.de'], phones: ['+4917612345678'] });
    const fields = previewFields(planMerge(groupOf(first, second), 'b'));

    expect(field(fields, 'phones').kept).toEqual(['+4917612345678']);
    expect(field(fields, 'notes').added).toEqual([{ value: 'Friend', fromId: 'a' }]);
  });
});
