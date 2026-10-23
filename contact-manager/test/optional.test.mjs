// The guard that keeps optional host calls from taking a page down.
import { describe, expect, it } from 'vitest';
import { optionalCall } from '../src/lib/optional.js';

describe('optionalCall', () => {
  it('resolves the value of a successful call', async () => {
    await expect(optionalCall(() => Promise.resolve([1, 2]))).resolves.toEqual([1, 2]);
  });

  it('resolves null when the call throws synchronously', async () => {
    // what reading a method of a namespace the host does not expose looks like
    const missing = undefined;
    await expect(optionalCall(() => missing.method())).resolves.toBeNull();
  });

  it('resolves null when the result is not a promise', async () => {
    await expect(optionalCall(() => undefined)).resolves.toBeNull();
    await expect(optionalCall(() => [])).resolves.toBeNull();
  });

  it('resolves null when the call rejects', async () => {
    await expect(optionalCall(() => Promise.reject(new Error('missing email:read')))).resolves.toBeNull();
  });
});
