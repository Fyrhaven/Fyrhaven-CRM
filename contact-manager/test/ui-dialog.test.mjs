// @vitest-environment jsdom
// The review dialog and the contact-detail section, with a fake api.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { SlotPropsContext } from '../test-utils/ui-kit.mjs';
import { makeReviewDialog } from '../src/lib/review-dialog.js';
import { makeDuplicateSection } from '../src/lib/detail-section.js';
import { findDuplicateGroups, groupFromSelection } from '../src/lib/duplicates.js';
import { makeCard } from './fixtures.mjs';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
afterEach(cleanup);

// Same name and email; d1 also has a note, d2 a phone. Field scores tie, so
// the lowest id wins: d1 is kept and gains d2's phone number.
const group = () => findDuplicateGroups([
  makeCard({ id: 'd1', name: 'Bob Smith', emails: ['bob@x.de'], notes: { n: { note: 'Friend' } } }),
  makeCard({ id: 'd2', name: 'Bob Smith', emails: ['bob@x.de'], phones: ['+4917612345678'] }),
], {})[0];

function dialogApi(handlers = {}) {
  return fakeApi({ translations: manifest.locales, handlers: { 'ui.confirm': async () => true, ...handlers } });
}

describe('review dialog', () => {
  it('labels a hand-picked group as a deliberate choice, not a match', async () => {
    const api = dialogApi();
    const Dialog = makeReviewDialog(React, api);
    const picked = groupFromSelection([
      makeCard({ id: 'a', name: 'Ada Lovelace' }),
      makeCard({ id: 'g', name: 'Grace Hopper' }),
    ]);
    await act(async () => {
      render(React.createElement(Dialog, { groups: [picked], onResult: () => {} }));
    });

    expect(screen.getByText('Selected by you')).toBeTruthy();
    expect(screen.queryByText('Certain match')).toBeNull();
    expect(screen.queryByText('Possible match')).toBeNull();
  });

  it('hands Cancel and Merge to the host footer, no buttons in the body', async () => {
    const api = dialogApi();
    const Dialog = makeReviewDialog(React, api);
    const sent = [];
    await act(async () => {
      render(React.createElement(SlotPropsContext.Provider, { value: { setDialogButtons: (buttons) => sent.push(buttons) } },
        React.createElement(Dialog, { groups: [group()], onResult: () => {} })));
    });
    expect(sent.at(-1).map((b) => ({ id: b.id, label: b.label, variant: b.variant }))).toEqual([
      { id: 'cancel', label: 'Cancel', variant: 'secondary' },
      { id: 'merge', label: 'Merge', variant: 'primary' },
    ]);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Bob Smith · bob@x.de')).toBeTruthy();
  });

  it('merges after the confirm: patch the kept contact, then delete the duplicate', async () => {
    const api = dialogApi({ 'contacts.update': async () => {}, 'contacts.remove': async () => {} });
    const Dialog = makeReviewDialog(React, api);
    let result;
    await act(async () => {
      render(React.createElement(Dialog, { groups: [group()], onResult: (value) => { result = value; } }));
    });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Merge' })); });
    expect(api.calls().map((c) => c.method)).toEqual(['ui.confirm', 'contacts.update', 'contacts.remove']);
    expect(api.calls('ui.confirm')[0].args[0]).toMatchObject({ danger: true, confirmLabel: 'Merge' });
    expect(api.calls('ui.confirm')[0].args[0].message)
      .toBe('Keeping 1, deleting 1. You can undo this for 15 minutes on the Contact Manager page.');
    expect(api.calls('contacts.update')[0].args[0]).toBe('d1');
    // entries are copied verbatim; only the comparison key is normalised
    expect(Object.values(api.calls('contacts.update')[0].args[1].phones).map((p) => p.number))
      .toEqual(['+4917612345678']);
    expect(api.calls('contacts.remove')[0].args[0]).toBe('d2');
    await waitFor(() => expect(result).toEqual({ merged: 1, removed: 1, failed: 0, undoable: 1 }));
    // ...and the merge is undoable: the deleted card and the patch target are on record
    const [batch] = await api.storage.get('undoBatches');
    expect(batch.entries).toHaveLength(1);
    expect(batch.entries[0].keptId).toBe('d1');
    expect(batch.entries[0].removed.map((card) => card.id)).toEqual(['d2']);
  });

  it('does not promise an undo when the undo window is off', async () => {
    const api = fakeApi({
      translations: manifest.locales,
      settings: { undoMinutes: 0 },
      handlers: { 'ui.confirm': async () => false },
    });
    const Dialog = makeReviewDialog(React, api);
    await act(async () => {
      render(React.createElement(Dialog, { groups: [group()], onResult: () => {} }));
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Merge' })); });
    expect(api.calls('ui.confirm')[0].args[0].message).toBe('Keeping 1, deleting 1.');
  });

  it('offers the other name as a nickname, and can discard or promote it', async () => {
    // Same email, different names: "Bob" is kept, "Robert Smith" is the other.
    const named = () => findDuplicateGroups([
      makeCard({ id: 'n1', name: 'Bob', emails: ['bob@x.de'] }),
      makeCard({ id: 'n2', name: 'Robert Smith', emails: ['bob@x.de'] }),
    ], {})[0];
    const api = dialogApi({ 'contacts.update': async () => {}, 'contacts.remove': async () => {} });
    const Dialog = makeReviewDialog(React, api);
    await act(async () => {
      render(React.createElement(Dialog, { groups: [named()], onResult: () => {} }));
    });

    expect(screen.getByText('Different names')).toBeTruthy();
    const picker = screen.getByLabelText('“Robert Smith” (from Robert Smith)');
    expect(picker.value).toBe('nickname');
    expect(screen.getByText('+ Robert Smith')).toBeTruthy(); // previewed as added

    // discarding it leaves nothing to patch, so only the duplicate is removed
    await act(async () => { fireEvent.change(picker, { target: { value: 'drop' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Merge' })); });
    expect(api.calls('contacts.update')).toHaveLength(0);
    expect(api.calls('contacts.remove')[0].args[0]).toBe('n2');
  });

  it('can use the other name as the contact name instead of a nickname', async () => {
    const named = () => findDuplicateGroups([
      makeCard({ id: 'n1', name: 'Bob', emails: ['bob@x.de'] }),
      makeCard({ id: 'n2', name: 'Robert Smith', emails: ['bob@x.de'] }),
    ], {})[0];
    const api = dialogApi({ 'contacts.update': async () => {}, 'contacts.remove': async () => {} });
    const Dialog = makeReviewDialog(React, api);
    await act(async () => {
      render(React.createElement(Dialog, { groups: [named()], onResult: () => {} }));
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText('“Robert Smith” (from Robert Smith)'), { target: { value: 'name' } });
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Merge' })); });
    const patch = api.calls('contacts.update')[0].args[1];
    expect(patch.name).toEqual({ full: 'Robert Smith' });
    expect(patch.nicknames).toBeUndefined();
  });

  it('keeps whoever the selector says', async () => {
    const api = dialogApi({ 'contacts.update': async () => {}, 'contacts.remove': async () => {} });
    const Dialog = makeReviewDialog(React, api);
    await act(async () => {
      render(React.createElement(Dialog, { groups: [group()], onResult: () => {} }));
    });
    await act(async () => { fireEvent.change(screen.getByLabelText('Keep'), { target: { value: 'd2' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Merge' })); });
    expect(api.calls('contacts.update')[0].args[0]).toBe('d2');
    expect(api.calls('contacts.remove')[0].args[0]).toBe('d1');
  });

  it('shows the complete details of the contact to keep and marks merged values green', async () => {
    const api = dialogApi();
    const Dialog = makeReviewDialog(React, api);
    await act(async () => {
      render(React.createElement(Dialog, { groups: [group()], onResult: () => {} }));
    });

    expect(screen.getByText('Complete details of Bob Smith')).toBeTruthy();
    expect(screen.getByText('How to read this')).toBeTruthy();
    expect(screen.getByText('New — merged in from another contact')).toBeTruthy();
    expect(screen.getByText('Different — the kept contact\'s value stays, this one is not merged')).toBeTruthy();
    // Details the roster never showed are part of the complete picture.
    expect(screen.getByText('Friend')).toBeTruthy();
    expect(screen.getByText('Deleted')).toBeTruthy();
    const added = screen.getByText('+ +4917612345678');
    expect(added.getAttribute('data-tone')).toBe('success');
    expect(screen.getByText('from Bob Smith')).toBeTruthy();
  });

  it('redraws the complete details for the contact picked as Keep', async () => {
    const api = dialogApi();
    const Dialog = makeReviewDialog(React, api);
    await act(async () => {
      render(React.createElement(Dialog, { groups: [group()], onResult: () => {} }));
    });
    await act(async () => { fireEvent.change(screen.getByLabelText('Keep'), { target: { value: 'd2' } }); });

    expect(screen.getByText('Complete details of Bob Smith')).toBeTruthy();
    const phoneBadges = screen.getAllByText('+4917612345678');
    expect(phoneBadges.some((node) => node.getAttribute('data-tone') === 'neutral')).toBe(true);
    const added = screen.getByText('+ Friend');
    expect(added.getAttribute('data-tone')).toBe('success');
  });

  it('marks a differing value on another contact orange and says it is not merged', async () => {
    const api = dialogApi();
    const Dialog = makeReviewDialog(React, api);
    const conflicting = findDuplicateGroups([
      makeCard({ id: 'n1', name: 'Bob Smith', emails: ['bob@x.de'] }),
      makeCard({ id: 'n2', name: 'Robert Smith', emails: ['bob@x.de'] }),
    ], {})[0];
    await act(async () => {
      render(React.createElement(Dialog, { groups: [conflicting], onResult: () => {} }));
    });

    const different = screen.getByText('≠ Robert Smith');
    expect(different.getAttribute('data-tone')).toBe('warning');
    // #49: the differing name is also offered as a nickname, so it counts as new
    expect(screen.getByText('2 kept · 1 new · 0 changed · 1 not merged')).toBeTruthy();
    expect(screen.getByText('Resolve differences')).toBeTruthy();
    expect(screen.getByText('Different names')).toBeTruthy();
  });

  it('resolves a conflicting field with a value from another contact', async () => {
    const api = dialogApi({ 'contacts.update': async () => {}, 'contacts.remove': async () => {} });
    const Dialog = makeReviewDialog(React, api);
    const conflicting = findDuplicateGroups([
      makeCard({ id: 'n1', name: 'Bob Smith', emails: ['bob@x.de'] }),
      makeCard({ id: 'n2', name: 'Robert Smith', emails: ['bob@x.de'] }),
    ], {})[0];
    await act(async () => {
      render(React.createElement(Dialog, { groups: [conflicting], onResult: () => {} }));
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'n2' } });
    });

    expect(screen.getByText('~ Robert Smith').getAttribute('data-tone')).toBe('warning');
    expect(screen.getByText('was Bob Smith')).toBeTruthy();
    expect(screen.getByText('1 kept · 0 new · 1 changed · 0 not merged')).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Merge' })); });
    expect(api.calls('contacts.update')[0].args[1].name).toEqual({ full: 'Robert Smith' });
    expect(api.calls('contacts.remove')[0].args[0]).toBe('n2');
  });

  it('disables Merge for an unchecked group; Cancel closes with null', async () => {
    const api = dialogApi({ 'contacts.update': async () => {}, 'contacts.remove': async () => {} });
    const Dialog = makeReviewDialog(React, api);
    let result = 'unset';
    await act(async () => {
      render(React.createElement(Dialog, { groups: [group()], onResult: (value) => { result = value; } }));
    });
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: /Include this group/ })); });
    expect(screen.getByRole('button', { name: 'Merge' }).disabled).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
    expect(result).toBeNull();
  });

  it('says so when there is nothing to review', async () => {
    const api = dialogApi();
    const Dialog = makeReviewDialog(React, api);
    await act(async () => {
      render(React.createElement(Dialog, { groups: [], onResult: () => {} }));
    });
    expect(screen.getByText('No duplicates in this selection.')).toBeTruthy();
  });
});

describe('contact detail section', () => {
  const contact = makeCard({ id: 'x1', name: 'Jane Roe', emails: ['jane@x.io'] });

  it('finds duplicates of the open contact and opens the dialog for them', async () => {
    const twin = makeCard({ id: 'x2', name: 'Roe, Jane', emails: ['jane@x.io'] });
    const api = fakeApi({
      translations: manifest.locales,
      handlers: { 'contacts.search': async () => [contact, twin], 'ui.openDialog': async () => null },
    });
    const Section = makeDuplicateSection(React, api);
    await act(async () => { render(React.createElement(Section, { contact })); });
    await waitFor(() => screen.getByText('1 possible duplicates'));
    expect(screen.getByText(/Same email address: jane@x\.io/)).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Review duplicates' })); });
    const groups = api.calls('ui.openDialog')[0].args[0].extraProps.groups;
    expect(groups[0].members.map((m) => m.id)).toEqual(['x1', 'x2']);
  });

  it('shows the quiet line when there is nothing', async () => {
    const api = fakeApi({
      translations: manifest.locales,
      handlers: { 'contacts.search': async () => [] },
    });
    const Section = makeDuplicateSection(React, api);
    await act(async () => { render(React.createElement(Section, { contact })); });
    await waitFor(() => screen.getByText('No possible duplicates found.'));
  });
});
