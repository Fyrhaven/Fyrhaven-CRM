// Follow-up tasks (#36, the task-creation half).
//
// A follow-up *is* a host task: `api.tasks.create` with the shape the project
// milestones already use (title, description, due). The host task has no field
// this plugin can point at a contact, so the contact rides in the description —
// its email first, because `tasksForContact` matches a task by the words in its
// title and description.
//
// Pure — no DOM, no api. The dialog is task-dialog.js; the write is open-task.js.

/** The priorities the editor offers. `normal` is the default and adds no suffix. */
export const PRIORITIES = ['low', 'normal', 'high'];

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** A real calendar date, the shape `<input type=date>` writes. */
export const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(text(value));

/** Today as `YYYY-MM-DD` in the user's own time zone — never UTC, which can be a day off. */
export function todayIso(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The description we hand the host: the contact line first (so the task is
 * findable from the contact), then the notes. Empty lines are dropped.
 */
export function followUpDescription(contact, notes) {
  return [text(contact), text(notes)].filter(Boolean).join('\n');
}

/**
 * The `api.tasks.create` payload. `title` and `description` are already
 * localised by the caller; this only shapes them, and omits `due` rather than
 * sending `''` — the milestone draft's rule, so the host keeps "no due date"
 * and "due today" apart.
 */
export function followUpDraft({ title, description, due } = {}) {
  const draft = { title: text(title), description: text(description) };
  if (isDate(due)) draft.due = text(due);
  return draft;
}

/** A task with no title is a mistake, not a task. */
export function isValidDraft(draft) {
  return Boolean(text(draft?.title));
}

/** Is the task's due date before today? A task with no due date is never overdue. */
export function isOverdue(task, now = new Date()) {
  const due = text(task?.due);
  return isDate(due) && due < todayIso(now);
}

/** Due date first (undated last), then title, so the order is total and stable. */
function byDueThenTitle(a, b) {
  const dueA = isDate(a?.due) ? a.due : '9999-12-31';
  const dueB = isDate(b?.due) ? b.due : '9999-12-31';
  if (dueA !== dueB) return dueA < dueB ? -1 : 1;
  return String(a?.title ?? '').localeCompare(String(b?.title ?? ''));
}

/**
 * Split a contact's tasks into the overdue ones and the rest, each in due-date
 * order, so the profile can show what needs attention first.
 */
export function taskBuckets(tasks, now = new Date()) {
  const list = (Array.isArray(tasks) ? tasks : []).filter(Boolean).sort(byDueThenTitle);
  return {
    overdue: list.filter((task) => isOverdue(task, now)),
    rest: list.filter((task) => !isOverdue(task, now)),
  };
}

/** How far ahead "due soon" reaches, in days. */
export const UPCOMING_DAYS = 7;

/**
 * Due today or within `days` — but never an overdue task, which is its own
 * bucket. The limit is a **local calendar day** (`new Date(y, m, d + days)`),
 * so a daylight-saving change cannot shift it by an hour and drop a task.
 */
export function isDueSoon(task, now = new Date(), days = UPCOMING_DAYS) {
  const due = text(task?.due);
  if (!isDate(due)) return false;
  const today = todayIso(now);
  if (due < today) return false;
  const limit = todayIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  return due <= limit;
}

/**
 * The three buckets the Overview shows: what is overdue, what is due soon, and
 * what can wait. This is what makes an overdue task visible without opening the
 * contact it is about.
 */
export function taskSummary(tasks, now = new Date()) {
  const { overdue, rest } = taskBuckets(tasks, now);
  const soon = rest.filter((task) => isDueSoon(task, now));
  const later = rest.filter((task) => !isDueSoon(task, now));
  return { overdue, soon, later, total: overdue.length + rest.length };
}
