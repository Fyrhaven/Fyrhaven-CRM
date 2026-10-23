// Projects: client work tracked **locally** in this browser. Bulwark gives a
// plugin no server-side custom object store, so a project record lives in
// api.storage — per account *and* per browser — and does not sync between
// devices. Milestones are the deliberate exception: each one is a real task
// created with `api.tasks.create`, so its due date and completion are shared
// like any other task and survive a reload.
//
// Pure model plus api.storage / api.tasks calls; no DOM.

export const PROJECTS_KEY = 'projects';
export const PROJECT_SCHEMA_VERSION = 1;
export const PROJECT_STATUSES = ['active', 'paused', 'done'];

const text = (value) => (typeof value === 'string' ? value : '');
const asArray = (value) => (Array.isArray(value) ? value : []);
const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
/** Money and amounts, rounded to cents. */
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/** A stable unique id for a new local record. */
export function newId(prefix = 'p') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A fresh project record. `id` is passed in so the model stays deterministic. */
export function emptyProject(id, overrides = {}) {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: text(id),
    name: '',
    status: 'active',
    companyId: '',
    contactIds: [],
    description: '',
    currency: '',
    hourlyRate: null,
    createdAt: Date.now(),
    milestones: [],
    timeEntries: [],
    expenses: [],
    ...overrides,
  };
}

/** A milestone record: a title, an optional due date and the task it created. */
export function emptyMilestone(id, overrides = {}) {
  return { id: text(id), title: '', taskId: '', due: '', ...overrides };
}

/** A time entry: whole minutes on a date, optionally not billable. */
export function emptyTimeEntry(id, overrides = {}) {
  return { id: text(id), at: '', minutes: 0, note: '', billable: true, ...overrides };
}

/** An expense: an amount on a date, optionally not billable. */
export function emptyExpense(id, overrides = {}) {
  return { id: text(id), at: '', amount: 0, note: '', billable: true, ...overrides };
}

/** Repairs a stored record; returns null when it cannot be used at all. */
export function normalizeProject(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = text(raw.id).trim();
  const name = text(raw.name).trim();
  if (!id || !name) return null;
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id,
    name,
    status: PROJECT_STATUSES.includes(raw.status) ? raw.status : 'active',
    companyId: text(raw.companyId),
    contactIds: [...new Set(asArray(raw.contactIds).map((value) => text(value)).filter(Boolean))],
    description: text(raw.description),
    currency: text(raw.currency).toUpperCase().slice(0, 3),
    hourlyRate: numberOrNull(raw.hourlyRate),
    createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : 0,
    milestones: asArray(raw.milestones)
      .map((milestone) => ({
        id: text(milestone?.id),
        title: text(milestone?.title).trim(),
        taskId: text(milestone?.taskId),
        due: text(milestone?.due),
      }))
      .filter((milestone) => milestone.id && milestone.title),
    timeEntries: asArray(raw.timeEntries)
      .map((entry) => ({
        id: text(entry?.id),
        at: text(entry?.at),
        minutes: Math.max(0, Math.round(Number(entry?.minutes) || 0)),
        note: text(entry?.note),
        billable: entry?.billable !== false,
      }))
      .filter((entry) => entry.id && entry.minutes > 0),
    expenses: asArray(raw.expenses)
      .map((entry) => ({
        id: text(entry?.id),
        at: text(entry?.at),
        amount: round2(entry?.amount),
        note: text(entry?.note),
        billable: entry?.billable !== false,
      }))
      .filter((entry) => entry.id && entry.amount > 0),
  };
}

/** Every usable record in a stored list, repaired and de-duplicated by id. */
export function normalizeProjects(raw) {
  const out = new Map();
  for (const item of asArray(raw)) {
    const project = normalizeProject(item);
    // The first record with an id wins; a later duplicate is corruption.
    if (project && !out.has(project.id)) out.set(project.id, project);
  }
  return [...out.values()];
}

/** What is wrong with a project, as a list of field keys (empty = valid). */
export function validateProject(project) {
  const problems = [];
  if (!text(project?.name).trim()) problems.push('name');
  const rate = project?.hourlyRate;
  const hasRate = rate !== null && rate !== undefined && rate !== '';
  if (hasRate && !Number.isFinite(Number(rate))) problems.push('hourlyRate');
  else if (hasRate && Number(rate) < 0) problems.push('hourlyRate');
  return problems;
}

/** Projects a contact is linked to. */
export function projectsForContact(projects, contactId) {
  return asArray(projects).filter((project) => asArray(project?.contactIds).includes(contactId));
}

/** Projects a company is linked to. */
export function projectsForCompany(projects, companyId) {
  return asArray(projects).filter((project) => project?.companyId && project.companyId === companyId);
}

/** The `api.tasks.create` payload for a milestone: "Project: Milestone". */
export function milestoneTaskDraft(project, milestone) {
  const name = text(project?.name).trim();
  const title = text(milestone?.title).trim();
  return {
    title: [name, title].filter(Boolean).join(': '),
    description: text(project?.description),
    due: text(milestone?.due) || undefined,
  };
}

/** Milestone ids whose task is still in the open-task list. */
export function openMilestoneIds(project, openTasks) {
  const ids = new Set(asArray(openTasks).map((task) => text(task?.id)).filter(Boolean));
  return asArray(project?.milestones)
    .filter((milestone) => milestone.taskId && ids.has(milestone.taskId))
    .map((milestone) => milestone.id);
}

/** Every minute recorded on the project. */
export function totalMinutes(project) {
  return asArray(project?.timeEntries).reduce((sum, entry) => sum + (Number(entry?.minutes) || 0), 0);
}

/** The minutes marked billable. */
export function billableMinutes(project) {
  return asArray(project?.timeEntries)
    .filter((entry) => entry?.billable !== false)
    .reduce((sum, entry) => sum + (Number(entry?.minutes) || 0), 0);
}

/** The billable expenses' amounts, in the project's currency. */
export function billableExpenses(project) {
  return round2(asArray(project?.expenses)
    .filter((entry) => entry?.billable !== false)
    .reduce((sum, entry) => sum + (Number(entry?.amount) || 0), 0));
}

/** What the billable time is worth at the project's hourly rate. */
export function timeAmount(project) {
  return round2((billableMinutes(project) / 60) * (Number(project?.hourlyRate) || 0));
}

/** Billable time plus billable expenses. */
export function projectTotal(project) {
  return round2(timeAmount(project) + billableExpenses(project));
}

/** "45 min", "1 h", "2 h 30 min". */
export function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** "90.00 EUR" (just "90.00" when the project has no currency). */
export function formatAmount(value, currency) {
  const amount = round2(value).toFixed(2);
  return currency ? `${amount} ${currency}` : amount;
}

export const EXPORT_FORMAT = 'bulwark-contact-manager-projects';

/** The portable copy of every project: one JSON file per account. */
export function exportPayload(projects, now = Date.now()) {
  return {
    format: EXPORT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    exportedAt: new Date(now).toISOString(),
    localOnly: true,
    note: 'Projects live in one browser only. This file is the portable copy — keep it to move or back up your data.',
    projects: normalizeProjects(projects),
  };
}

/**
 * Projects from an exported file (or a bare array), repaired. Throws when the
 * text is not JSON at all.
 */
export function parseExport(text) {
  let data;
  try {
    data = JSON.parse(String(text));
  } catch {
    throw new Error('not-json');
  }
  return normalizeProjects(Array.isArray(data) ? data : data?.projects);
}

/** Merges imported projects into a list; the import wins per id. */
export function mergeProjects(existing, incoming) {
  const byId = new Map(normalizeProjects(existing).map((project) => [project.id, project]));
  for (const project of normalizeProjects(incoming)) byId.set(project.id, project);
  return [...byId.values()];
}

/** Merges an imported list into storage; returns how many projects are stored. */
export async function importProjects(api, incoming) {
  const merged = mergeProjects(await readProjects(api), incoming);
  if (merged.length) await api.storage.set(PROJECTS_KEY, merged);
  return merged.length;
}

/** The projects in storage, repaired. Rewrites storage when it dropped junk. */
export async function readProjects(api) {
  const stored = await api.storage.get(PROJECTS_KEY);
  const list = asArray(stored);
  const projects = normalizeProjects(list);
  const changed = projects.length !== list.length || list.some((item) => !normalizeProject(item));
  if (changed) {
    if (projects.length) await api.storage.set(PROJECTS_KEY, projects);
    else await api.storage.remove(PROJECTS_KEY);
  }
  return projects;
}

/** Creates or replaces one project; returns the stored record. */
export async function saveProject(api, project) {
  const clean = normalizeProject(project);
  if (!clean) throw new Error('invalid project');
  const projects = await readProjects(api);
  await api.storage.set(PROJECTS_KEY, [...projects.filter((p) => p.id !== clean.id), clean]);
  return clean;
}

/** Drops the local record only — linked tasks and contacts are untouched. */
export async function deleteProject(api, id) {
  const projects = await readProjects(api);
  const next = projects.filter((project) => project.id !== id);
  if (next.length) await api.storage.set(PROJECTS_KEY, next);
  else await api.storage.remove(PROJECTS_KEY);
  return projects.length - next.length;
}
