// The project model: local records, repair on read, links, and milestones as
// real tasks.
import { describe, expect, it } from 'vitest';
import { fakeApi } from '../test-utils/fake-api.mjs';
import {
  PROJECTS_KEY, deleteProject, emptyMilestone, emptyProject, milestoneTaskDraft,
  normalizeProject, normalizeProjects, openMilestoneIds, projectsForCompany,
  projectsForContact, readProjects, saveProject, validateProject,
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
