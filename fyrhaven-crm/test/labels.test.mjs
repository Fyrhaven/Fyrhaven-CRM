// The shared display helpers (#36 moved `formatDate` here): one date formatter
// for the Overview and the profile. Pure.
import { describe, expect, it } from 'vitest';
import { formatDate } from '../src/lib/labels.js';

describe('formatDate', () => {
  it('formats a plain date and a timestamp the same way', () => {
    expect(formatDate('2026-11-02')).toBe(formatDate('2026-11-02T00:00:00Z'));
  });

  it('is empty for an empty value, so a caller can render nothing', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
  });

  it('shows a value that is not a date as it is, not as Invalid Date', () => {
    expect(formatDate('someday')).toBe('someday');
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});
