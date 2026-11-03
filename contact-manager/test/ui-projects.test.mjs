// @vitest-environment jsdom
// The Projects page and the project dialog.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fakeApi } from '../test-utils/fake-api.mjs';
import { filesHost } from '../test-utils/files-host.mjs';
import { makeProjectsPage } from '../src/lib/projects-page.js';
import { makeProjectDialog } from '../src/lib/project-dialog.js';
import { write } from '../src/lib/store.js';
import { readProjects } from '../src/lib/projects.js';
import { makeCard } from './fixtures.mjs';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'manifest.json'), 'utf8'));
afterEach(cleanup);

// jsdom has no Blob URL support; the export download needs it.
const createObjectURL = vi.fn(() => 'blob:test');
const revokeObjectURL = vi.fn();
URL.createObjectURL = createObjectURL;
URL.revokeObjectURL = revokeObjectURL;

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

const TIME_PROJECT = {
  ...PROJECT,
  timeEntries: [
    { id: 'te1', at: '2026-10-10', minutes: 60, note: 'Kickoff call', billable: true },
    { id: 'te2', at: '2026-10-11', minutes: 30, note: 'Internal', billable: false },
  ],
  expenses: [{ id: 'ex1', at: '2026-10-12', amount: 12.5, note: 'Domain', billable: true }],
};

function projectsApi(handlers = {}) {
  // Projects are records now (#68), so the fake needs a server to put them on:
  // the customer's own Files storage, which is the first choice.
  const files = filesHost();
  return fakeApi({
    translations: manifest.locales,
    host: files.host,
    handlers: {
      ...files.handlers,
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
    await write(api, 'projects', [PROJECT]);
    await renderPage(api);

    await waitFor(() => expect(screen.getAllByText('Website').length).toBeGreaterThan(0));
    expect(screen.getByText('Rebuild')).toBeTruthy();
    expect(screen.getByText('People: Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('Acme Ltd')).toBeTruthy();
    // the milestone is a task that is still open
    expect(screen.getByText('Kickoff')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
  });

  it('creates a project through the dialog and stores it', async () => {
    const api = projectsApi({
      'ui.openDialog': async () => ({ saved: 'created', project: { ...PROJECT, id: 'p9', name: 'Intranet' } }),
    });
    await renderPage(api);
    expect(screen.getByText('No projects yet. Create one to track client work.')).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'New project' })[0]); });

    await waitFor(async () => expect((await readProjects(api))).toHaveLength(1));
    expect((await readProjects(api))[0]).toMatchObject({ id: 'p9', name: 'Intranet' });
    // the page reloads, so the new project is listed and selected
    await waitFor(() => expect(screen.getAllByText('Intranet').length).toBeGreaterThan(0));
    expect(api.calls('toast.success').at(-1).args[0]).toBe('Project created.');
  });

  it('stores an edited project', async () => {
    const api = projectsApi({
      'ui.openDialog': async () => ({ saved: 'updated', project: { ...PROJECT, name: 'Website v2' } }),
    });
    await write(api, 'projects', [PROJECT]);
    await renderPage(api);
    await waitFor(() => expect(screen.getAllByText('Website').length).toBeGreaterThan(0));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Edit project' })); });

    await waitFor(async () => expect((await readProjects(api))[0].name).toBe('Website v2'));
    expect(api.calls('toast.success').at(-1).args[0]).toBe('Project updated.');
  });

  it('reports a storage failure instead of claiming the project was created', async () => {
    const api = projectsApi({
      'ui.openDialog': async () => ({ saved: 'created', project: { ...PROJECT, id: 'p9', name: 'Intranet' } }),
    });
    // Break the store the record actually goes to, not the browser (#68).
    api.files.create = async () => { throw new Error('quota exceeded'); };
    await renderPage(api);

    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'New project' })[0]); });

    await waitFor(() => expect(api.calls('toast.error')).toHaveLength(1));
    expect(api.calls('toast.error')[0].args[0]).toBe('Could not save the project: quota exceeded');
    expect(api.calls('toast.success')).toHaveLength(0);
  });

  it('lays the project list and the project detail out as a split', async () => {
    const api = projectsApi();
    await write(api, 'projects', [PROJECT]);
    await renderPage(api);
    await waitFor(() => expect(screen.getAllByText('Website').length).toBeGreaterThan(0));

    const split = document.querySelector('[data-pane="split"]');
    const list = document.querySelector('[data-pane="list"]');
    const detail = document.querySelector('[data-pane="detail"]');
    expect(split.style.display).toBe('flex');
    expect(list.parentElement).toBe(split);
    expect(detail.parentElement).toBe(split);
  });

  it('hides the import file input without relying on the kit to forward style', async () => {
    const api = projectsApi();
    await renderPage(api);

    const input = document.querySelector('input[type="file"]');
    expect(input).toBeTruthy();
    expect(input.parentElement.style.display).toBe('none');
  });

  it('marks a milestone done when its task is no longer open', async () => {
    const api = projectsApi({ 'tasks.list': async () => [] });
    await write(api, 'projects', [PROJECT]);
    await renderPage(api);
    await waitFor(() => expect(screen.getByText('Kickoff')).toBeTruthy());
    expect(screen.getByText('Done')).toBeTruthy();
  });

  it('creates a milestone as a task and stores it on the project', async () => {
    const api = projectsApi();
    await write(api, 'projects', [PROJECT]);
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
    const stored = (await readProjects(api)).find((project) => project.id === 'p1');
    expect(stored.milestones.map((milestone) => milestone.title)).toEqual(['Kickoff', 'Launch']);
    expect(stored.milestones[1].taskId).toBe('t-new');
  });

  it('deletes a project after a confirmation, without touching its tasks', async () => {
    const api = projectsApi({ 'ui.confirm': async () => true });
    await write(api, 'projects', [PROJECT]);
    await renderPage(api);
    await waitFor(() => expect(screen.getAllByText('Website').length).toBeGreaterThan(0));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete project' })); });
    await waitFor(async () => expect((await readProjects(api))).toEqual([]));
    expect(api.calls('tasks.remove')).toHaveLength(0);
    expect(api.calls('toast.success').at(-1).args[0]).toBe('Project deleted.');
  });

  it('adds time and shows the running totals', async () => {
    const api = projectsApi();
    await write(api, 'projects', [TIME_PROJECT]);
    await renderPage(api);
    await waitFor(() => expect(screen.getAllByText('Website').length).toBeGreaterThan(0));

    // 90 recorded minutes (60 billable) at 90/h plus a 12.50 billable expense
    expect(screen.getByText('Time: 1 h 30 min · billable 1 h')).toBeTruthy();
    expect(screen.getByText('Billable 102.50 EUR · expenses 12.50 EUR')).toBeTruthy();
    expect(screen.getByText('Kickoff call')).toBeTruthy();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '45' } });
      fireEvent.change(screen.getAllByLabelText('Note')[0], { target: { value: 'Extra' } });
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add time' })); });

    await waitFor(async () => expect((await readProjects(api))[0].timeEntries).toHaveLength(3));
    expect((await readProjects(api))[0].timeEntries[2])
      .toMatchObject({ minutes: 45, note: 'Extra', billable: true });
  });

  it('adds an expense and removes a time entry', async () => {
    const api = projectsApi();
    await write(api, 'projects', [TIME_PROJECT]);
    await renderPage(api);
    await waitFor(() => expect(screen.getAllByText('Website').length).toBeGreaterThan(0));

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '7.25' } });
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add expense' })); });
    await waitFor(async () => expect((await readProjects(api))[0].expenses).toHaveLength(2));
    expect((await readProjects(api))[0].expenses[1]).toMatchObject({ amount: 7.25, billable: true });

    // the first Remove button belongs to the first time entry
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]); });
    await waitFor(async () => expect((await readProjects(api))[0].timeEntries).toHaveLength(1));
    expect((await readProjects(api))[0].timeEntries[0].id).toBe('te2');
  });

  it('exports the projects through the host, the only way out of the sandbox', async () => {
    const api = projectsApi();
    await write(api, 'projects', [TIME_PROJECT]);
    await renderPage(api);
    await waitFor(() => expect(screen.getAllByText('Website').length).toBeGreaterThan(0));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Export' })); });

    // the plugin frame has no `allow-downloads`, so the host saves the file
    const call = api.calls('ui.downloadFile')[0];
    expect(call.args[0]).toBe('contact-manager-projects.json');
    expect(JSON.parse(call.args[1]).format).toBe('bulwark-contact-manager-projects');
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
