// What the host really exposes, which is what tells a wrong method name from a
// missing API.
import { describe, expect, it } from 'vitest';
import {
  detectCapabilities, describeCapabilities, unavailableNamespaces,
} from '../src/lib/capabilities.js';

describe('detectCapabilities', () => {
  it('reports a namespace that exposes everything the plugin wants', () => {
    const caps = detectCapabilities({ email: { search() {}, getAttachment() {} } });

    expect(caps.email.present).toBe(true);
    expect(caps.email.missing).toEqual([]);
  });

  it('reports the keys a namespace does expose, which is how a wrong name is found', () => {
    const caps = detectCapabilities({ email: { query() {}, fetchAttachment() {} } });

    expect(caps.email.missing).toEqual(['search', 'getAttachment']);
    expect(describeCapabilities(caps)).toContain('email: fetchAttachment, query');
  });

  it('reports a namespace that is there but empty', () => {
    const caps = detectCapabilities({ email: {} });

    expect(caps.email.present).toBe(true);
    expect(caps.email.keys).toEqual([]);
    expect(describeCapabilities(caps)).toContain('email: present but exposes no keys');
  });

  it('survives a namespace that throws when it is read', () => {
    const hostile = new Proxy({}, { get() { throw new Error('nope'); }, ownKeys() { throw new Error('nope'); } });

    expect(detectCapabilities(hostile).email.present).toBe(false);
  });

  it('names every namespace the plugin cannot use', () => {
    const caps = detectCapabilities({ email: { search() {} } });

    expect(unavailableNamespaces(caps)).toEqual(['email', 'tasks', 'calendar']);
    expect(unavailableNamespaces(detectCapabilities({}))).toEqual(['email', 'tasks', 'calendar']);
  });

  it('says nothing is unavailable when everything is there', () => {
    const caps = detectCapabilities({
      email: { search() {}, getAttachment() {} },
      tasks: { list() {}, create() {} },
      calendar: { getEvents() {} },
    });

    expect(unavailableNamespaces(caps)).toEqual([]);
  });
});
