// @vitest-environment jsdom
// The Projects page and the project dialog.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { makeProjectsPage } from '../src/lib/projects-page.js';
import { makeProjectDialog } from '../src/lib/project-dialog.js';
import { makeCard } from './fixtures.mjs';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
afterEach(cleanup);

const CARDS = [
  makeCard({ id: 'a', name: 'Ada Lovelace', emails: ['ada@example.org'] }),
  makeCard({ id: 'g', name: 'Grace Hopper', emails: ['grace@navy.mil'] }),
];
const COMPANY = {
  id: 'co', kind: 'org', name: { full: 'Acme Ltd' }, keywords: { company: true }, addressBookIds: { b1: true },
};

const PROJECT = {
  schemaVersion: 1,
  id: 'p1',
  name: 'Website',
  status: 'active',
  companyId: 'co',
  contactIds: ['a'],
  description: 'Rebuild',
  currency: 'EUR',
  hourlyRate: 90,
  createdAt: 0,
  milestones: [{ id: 'm1', title: 'Kickoff', taskId: 't1', due: '2026-11-01' }],
};

function projectsApi(handlers = {}) {
  return fakeApi({
    translations: manifest.locales,
    handlers: {
      'contacts.list': async () => [...CARDS, COMPANY],
      'addressBooks.list': async () => [{ id: 'b1', name: 'Personal' }],
      'contacts.search': async () => [],
      'tasks.list': async () => [{ id: 't1' }],
      'tasks.create': async () => ({ id: 't-new' }),
      ...handlers,
    },
  });
}

async function renderPage(api) {
  const Page = makeProjectsPage(React, api);
  await act(async () => { render(React.createElement(Page)); });
  await waitFor(() => expect(screen.getByText('Projects')).toBeTruthy());
}

describe('projects page', () => {
  it('shows the empty state when there are no projects', async () => {
    const api = projectsApi();
    await renderPage(api);
    expect(screen.getByText('No projects yet. Create one to track client work.')).toBeTruthy();
  });

  it('lists the projects and shows the selected one with its links and milestones', async () => {
    const api = projectsApi();
    await api.storage.set('projects', [PROJECT]);
    await renderPage(api);

    await waitFor(() => expect(screen.getAllByText('Website').length).toBeGreaterThan(0));
    expect(screen.getByText('Rebuild')).toBeTruthy();
    expect(screen.getByText('People: Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('Acme Ltd')).toBeTruthy();
    // the milestone is a task that is still open
    expect(screen.getByText('Kickoff')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
  });

  it('marks a milestone done when its task is no longer open', async () => {
    const api = projectsApi({ 'tasks.list': async () => [] });
    await api.storage.set('projects', [PROJECT]);
    await renderPage(api);
    await waitFor(() => expect(screen.getByText('Kickoff')).toBeTruthy());
    expect(screen.getByText('Done')).toBeTruthy();
  });

  it('creates a milestone as a task and stores it on the project', async () => {
    const api = projectsApi();
    await api.storage.set('projects', [PROJECT]);
    await renderPage(api);
    await waitFor(() => expect(screen.getAllByText('Website').length).toBeGreaterThan(0));

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Milestone'), { target: { value: 'Launch' } });
      fireEvent.change(screen.getByLabelText('Due'), { target: { value: '2026-12-01' } });
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add milestone' })); });

    await waitFor(() => expect(api.calls('tasks.create')).toHaveLength(1));
    expect(api.calls('tasks.create')[0].args[0])
      .toEqual({ title: 'Website: Launch', description: 'Rebuild', due: '2026-12-01' });
    const stored = api.storageSnapshot().projects.find((project) => project.id === 'p1');
    expect(stored.milestones.map((milestone) => milestone.title)).toEqual(['Kickoff', 'Launch']);
    expect(stored.milestones[1].taskId).toBe('t-new');
  });

  it('deletes a project after a confirmation, without touching its tasks', async () => {
    const api = projectsApi({ 'ui.confirm': async () => true });
    await api.storage.set('projects', [PROJECT]);
    await renderPage(api);
    await waitFor(() => expect(screen.getAllByText('Website').length).toBeGreaterThan(0));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete project' })); });
    await waitFor(() => expect(api.storageSnapshot().projects).toBeUndefined());
    expect(api.calls('tasks.remove')).toHaveLength(0);
    expect(api.calls('toast.success').at(-1).args[0]).toBe('Project deleted.');
  });
});

describe('project dialog', () => {
  const open = async (api, props) => {
    const results = [];
    const Dialog = makeProjectDialog(React, api);
    await act(async () => {
      render(React.createElement(Dialog, { cards: [...CARDS, COMPANY], onResult: (v) => results.push(v), ...props }));
    });
    return results;
  };

  it('saves a new project with the chosen company and people', async () => {
    const api = projectsApi();
    const results = await open(api, { projectEditor: { mode: 'create', project: null } });

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Website' } });
      fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'co' } });
    });
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Ada Lovelace' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create project' })); });

    expect(results).toHaveLength(1);
    expect(results[0].saved).toBe('created');
    expect(results[0].project).toMatchObject({ name: 'Website', companyId: 'co', contactIds: ['a'] });
  });

  it('refuses to save without a name and keeps the dialog open', async () => {
    const api = projectsApi();
    const results = await open(api, { projectEditor: { mode: 'create' }, cards: [] });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create project' })); });

    expect(results).toEqual([]);
    expect(screen.getByText('Enter a project name.')).toBeTruthy();
  });

  it('starts from the stored record in edit mode', async () => {
    const api = projectsApi();
    const results = await open(api, { projectEditor: { mode: 'edit', project: PROJECT } });

    expect(screen.getByLabelText('Name').value).toBe('Website');
    await act(async () => { fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Website v2' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });

    expect(results[0].saved).toBe('updated');
    expect(results[0].project.name).toBe('Website v2');
    expect(results[0].project.milestones).toHaveLength(1);
  });
});
