// Reporting a failure: the host's alert when it has one, a toast otherwise.
import { describe, expect, it } from 'vitest';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { reportError } from '../src/lib/report.js';

const api = (handlers = {}) => fakeApi({ translations: { en: { 'error.title': 'Something went wrong' } }, handlers });

describe('reportError', () => {
  it('stops the user with the host alert, under a title', async () => {
    const subject = api({ 'ui.alert': async () => {} });

    await reportError(subject, 'Could not read the address books');

    expect(subject.calls('ui.alert')[0].args[0]).toEqual({
      title: 'Something went wrong',
      message: 'Could not read the address books',
    });
    expect(subject.calls('toast.error')).toHaveLength(0);
  });

  it('falls back to a toast when the host refuses the alert', async () => {
    const subject = api({ 'ui.alert': async () => { throw new Error('no alert'); } });

    await reportError(subject, 'Could not read the address books');

    expect(subject.calls('toast.error').at(-1).args[0]).toBe('Could not read the address books');
  });

  it('falls back to a toast when the host has no alert at all', async () => {
    const subject = api();
    subject.ui = {};

    await reportError(subject, 'Could not read the address books');

    expect(subject.calls('toast.error').at(-1).args[0]).toBe('Could not read the address books');
  });

  it('takes a title of its own', async () => {
    const subject = api({ 'ui.alert': async () => {} });

    await reportError(subject, 'body', { title: 'Undo failed' });

    expect(subject.calls('ui.alert')[0].args[0].title).toBe('Undo failed');
  });
});
