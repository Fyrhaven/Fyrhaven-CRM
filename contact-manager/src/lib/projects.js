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
    ...overrides,
  };
}

/** A milestone record: a title, an optional due date and the task it created. */
export function emptyMilestone(id, overrides = {}) {
  return { id: text(id), title: '', taskId: '', due: '', ...overrides };
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
