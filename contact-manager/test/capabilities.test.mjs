// What the host really exposes, which is what tells a wrong method name from a
// missing API.
import { describe, expect, it } from 'vitest';
import {
  describeCapabilities, describeSurface, detectCapabilities, probeOptionalApis, unavailableNamespaces,
} from '../src/lib/capabilities.js';
import { fakeApi } from '../test-utils/fake-api.mjs';

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

describe('probeOptionalApis', () => {
  it('reports nothing when every call answers', async () => {
    const api = {
      email: { search: async () => [] },
      tasks: { list: async () => [] },
      calendar: { getEvents: async () => [] },
    };

    expect(await probeOptionalApis(api)).toEqual([]);
  });

  it('names the namespace and the reason when a call is refused', async () => {
    const api = {
      email: { search: async () => [] },
      tasks: { list: async () => [] },
      calendar: { getEvents: async () => { throw new Error('missing calendar:read'); } },
    };

    // this is the difference between "the API is not there" and "the call failed"
    expect(await probeOptionalApis(api)).toEqual(['calendar: missing calendar:read']);
  });

  it('reports a namespace that is not there at all, without throwing', async () => {
    const failures = await probeOptionalApis({});

    // one per namespace, each naming the namespace and what went wrong
    expect(failures).toHaveLength(3);
    expect(failures.map((entry) => entry.split(':')[0])).toEqual(['email', 'tasks', 'calendar']);
    for (const failure of failures) expect(failure).toContain('undefined');
  });
});

describe('describeSurface', () => {
  it('names the namespaces and their methods, so an unknown one is findable', () => {
    const line = describeSurface({
      ui: { openDialog: () => {}, openEmail: () => {} },
      email: { search: () => {} },
      tasks: { list: () => {} },
    });

    expect(line).toContain('ui: openDialog, openEmail');
    expect(line).toContain('email: search');
    expect(line).toContain('tasks: list');
    expect(line).toContain('calendar: (none)');
  });

  it('survives a namespace it cannot read', () => {
    const hostile = new Proxy({}, { get() { throw new Error('nope'); }, ownKeys() { throw new Error('nope'); } });

    expect(describeSurface(hostile)).toContain('(unreadable)');
  });
});

// The probe against the same fake the rest of the suite uses. The fake can now
// declare a host shape, so "the method was renamed" is something a test can say
// rather than something only a hand-built object could describe (#75).
describe('the probe through the fake api', () => {
  it('tells a renamed method from a missing namespace', () => {
    const api = fakeApi({ host: { absent: ['calendar'], exposes: { email: ['query', 'send'] } } });
    const caps = detectCapabilities(api);

    expect(caps.email.present).toBe(true);
    expect(caps.email.missing).toEqual(['search', 'getAttachment']);
    expect(caps.calendar.present).toBe(false);
    expect(describeCapabilities(caps)).toContain('email: query, send');
  });

  it('reports a namespace the fake exposes in full as usable', () => {
    const api = fakeApi({ host: { exposes: { email: ['search', 'getAttachment'] } } });
    expect(detectCapabilities(api).email.missing).toEqual([]);
  });

  it('still invents methods when no host shape is declared, which is the point', () => {
    // Documented rather than accidental: the permissive fake keeps most tests
    // short, and is exactly why a shape-sensitive test must declare one.
    const api = fakeApi({});
    expect(typeof api.email.search).toBe('function');
  });
});
