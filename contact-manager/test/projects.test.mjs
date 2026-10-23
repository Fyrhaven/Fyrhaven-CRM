// The project model: local records, repair on read, links, and milestones as
// real tasks.
import { describe, expect, it } from 'vitest';
import { fakeApi } from '../test-utils/fake-api.mjs';
import {
  EXPORT_FORMAT, PROJECTS_KEY, billableExpenses, billableMinutes, deleteProject,
  emptyExpense, emptyMilestone, emptyProject, emptyTimeEntry, exportPayload,
  formatAmount, formatMinutes, importProjects, mergeProjects, milestoneTaskDraft,
  normalizeProject, normalizeProjects, openMilestoneIds, parseExport, projectTotal,
  projectsForCompany, projectsForContact, readProjects, saveProject, timeAmount,
  totalMinutes, validateProject,
} from '../src/lib/projects.js';

describe('normalizeProject', () => {
  it('repairs a stored record', () => {
    const project = normalizeProject({
      id: 'p1', name: '  Website  ', status: 'nope', currency: 'eur', hourlyRate: '90',
      contactIds: ['a', 'a', '', 'b'],
      milestones: [{ id: 'm1', title: ' Kickoff ', taskId: 't1' }, { id: '', title: 'x' }],
    });
    expect(project).toMatchObject({
      id: 'p1', name: 'Website', status: 'active', currency: 'EUR', hourlyRate: 90, contactIds: ['a', 'b'],
    });
    expect(project.milestones).toEqual([{ id: 'm1', title: 'Kickoff', taskId: 't1', due: '' }]);
  });

  it('rejects a record without an id or a name', () => {
    expect(normalizeProject(null)).toBeNull();
    expect(normalizeProject({ id: 'p1' })).toBeNull();
    expect(normalizeProject({ name: 'x' })).toBeNull();
  });

  it('de-duplicates a stored list by id', () => {
    const projects = normalizeProjects([{ id: 'p1', name: 'A' }, { id: 'p1', name: 'B' }, 'junk']);
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ id: 'p1', name: 'A' });
  });
});

describe('validateProject', () => {
  it('requires a name and a numeric, non-negative rate', () => {
    expect(validateProject(emptyProject('p1'))).toEqual(['name']);
    expect(validateProject(emptyProject('p1', { name: 'A', hourlyRate: 'x' }))).toEqual(['hourlyRate']);
    expect(validateProject(emptyProject('p1', { name: 'A', hourlyRate: -1 }))).toEqual(['hourlyRate']);
    expect(validateProject(emptyProject('p1', { name: 'A', hourlyRate: 90 }))).toEqual([]);
    expect(validateProject(emptyProject('p1', { name: 'A', hourlyRate: null }))).toEqual([]);
  });
});

describe('links and milestones', () => {
  const projects = [
    emptyProject('p1', { name: 'Website', companyId: 'co', contactIds: ['a', 'b'] }),
    emptyProject('p2', { name: 'App', companyId: 'co2', contactIds: ['b'] }),
  ];

  it('finds the projects of a contact and of a company', () => {
    expect(projectsForContact(projects, 'b').map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(projectsForContact(projects, 'a').map((p) => p.id)).toEqual(['p1']);
    expect(projectsForCompany(projects, 'co').map((p) => p.id)).toEqual(['p1']);
    expect(projectsForCompany(projects, '')).toEqual([]);
  });

  it('builds the task payload for a milestone', () => {
    expect(milestoneTaskDraft(projects[0], emptyMilestone('m1', { title: 'Kickoff', due: '2026-11-01' })))
      .toEqual({ title: 'Website: Kickoff', description: '', due: '2026-11-01' });
    expect(milestoneTaskDraft(projects[0], emptyMilestone('m1', { title: 'Kickoff' })).due).toBeUndefined();
  });

  it('reports which milestones are still open', () => {
    const project = emptyProject('p1', {
      milestones: [
        { id: 'm1', title: 'A', taskId: 't1' },
        { id: 'm2', title: 'B', taskId: 't2' },
      ],
    });
    expect(openMilestoneIds(project, [{ id: 't1' }])).toEqual(['m1']);
    expect(openMilestoneIds(project, [])).toEqual([]);
  });
});

describe('project storage', () => {
  it('saves, reads, replaces and deletes records', async () => {
    const api = fakeApi();
    expect(await readProjects(api)).toEqual([]);

    await saveProject(api, emptyProject('p1', { name: 'Website' }));
    await saveProject(api, emptyProject('p2', { name: 'App' }));
    expect((await readProjects(api)).map((p) => p.name)).toEqual(['Website', 'App']);

    await saveProject(api, emptyProject('p1', { name: 'Website v2' }));
    expect((await readProjects(api)).find((p) => p.id === 'p1').name).toBe('Website v2');

    expect(await deleteProject(api, 'p1')).toBe(1);
    expect((await readProjects(api)).map((p) => p.id)).toEqual(['p2']);
    expect(await deleteProject(api, 'p2')).toBe(1);
    expect(api.storageSnapshot()[PROJECTS_KEY]).toBeUndefined();
  });

  it('drops junk from storage on read', async () => {
    const api = fakeApi();
    await api.storage.set(PROJECTS_KEY, [{ id: 'p1', name: 'A' }, { id: '' }, 'nope']);
    expect((await readProjects(api)).map((p) => p.id)).toEqual(['p1']);
    expect(api.storageSnapshot()[PROJECTS_KEY]).toHaveLength(1);
  });

  it('refuses to save an unusable record', async () => {
    const api = fakeApi();
    await expect(saveProject(api, { id: '', name: '' })).rejects.toThrow('invalid project');
  });
});

describe('time, expenses and totals', () => {
  const project = emptyProject('p1', {
    hourlyRate: 90,
    timeEntries: [
      emptyTimeEntry('t1', { minutes: 60, billable: true }),
      emptyTimeEntry('t2', { minutes: 30, billable: true }),
      emptyTimeEntry('t3', { minutes: 45, billable: false }),
    ],
    expenses: [
      emptyExpense('e1', { amount: 12.5, billable: true }),
      emptyExpense('e2', { amount: 99, billable: false }),
    ],
  });

  it('adds up the recorded time and the billable part', () => {
    expect(totalMinutes(project)).toBe(135);
    expect(billableMinutes(project)).toBe(90);
  });

  it('values the billable time at the hourly rate and adds the billable expenses', () => {
    expect(timeAmount(project)).toBe(135);          // 90 min at 90/h
    expect(billableExpenses(project)).toBe(12.5);
    expect(projectTotal(project)).toBe(147.5);
  });

  it('rounds time amounts and expenses to cents', () => {
    const odd = emptyProject('p2', {
      hourlyRate: 33.33,
      timeEntries: [emptyTimeEntry('t1', { minutes: 20 })],
      expenses: [emptyExpense('e1', { amount: 0.005 })],
    });
    expect(timeAmount(odd)).toBe(11.11);            // 20 min at 33.33/h
    expect(billableExpenses(odd)).toBe(0.01);       // 0.005 rounds up to a cent
    expect(projectTotal(odd)).toBe(11.12);
  });

  it('formats minutes and amounts', () => {
    expect(formatMinutes(0)).toBe('0 min');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(150)).toBe('2 h 30 min');
    expect(formatAmount(147.5, 'EUR')).toBe('147.50 EUR');
    expect(formatAmount(9, '')).toBe('9.00');
  });
});

describe('export and import', () => {
  it('wraps the projects in a portable, local-only payload', () => {
    const payload = exportPayload([emptyProject('p1', { name: 'Website' })], 0);
    expect(payload).toMatchObject({ format: EXPORT_FORMAT, schemaVersion: 1, localOnly: true });
    expect(payload.exportedAt).toBe(new Date(0).toISOString());
    expect(payload.note).toMatch(/browser only/);
    expect(payload.projects.map((p) => p.name)).toEqual(['Website']);
  });

  it('reads the payload back, and a bare array too', () => {
    const payload = exportPayload([emptyProject('p1', { name: 'Website' })]);
    expect(parseExport(JSON.stringify(payload)).map((p) => p.id)).toEqual(['p1']);
    expect(parseExport(JSON.stringify([{ id: 'p2', name: 'App' }])).map((p) => p.id)).toEqual(['p2']);
    expect(parseExport('{"projects": null}')).toEqual([]);
  });

  it('rejects text that is not JSON', () => {
    expect(() => parseExport('nope')).toThrow('not-json');
  });

  it('merges imported projects over the stored ones by id', () => {
    const merged = mergeProjects(
      [emptyProject('p1', { name: 'Old' }), emptyProject('p2', { name: 'Kept' })],
      [emptyProject('p1', { name: 'New' }), emptyProject('p3', { name: 'Added' })],
    );
    expect(merged.map((p) => p.name)).toEqual(['New', 'Kept', 'Added']);
  });

  it('imports into storage', async () => {
    const api = fakeApi();
    await saveProject(api, emptyProject('p1', { name: 'Old' }));
    const total = await importProjects(api, [
      emptyProject('p1', { name: 'New' }),
      emptyProject('p2', { name: 'Added' }),
    ]);
    expect(total).toBe(2);
    expect((await readProjects(api)).map((p) => p.name)).toEqual(['New', 'Added']);
  });
});
