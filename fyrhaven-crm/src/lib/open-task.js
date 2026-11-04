// One place that opens the follow-up task editor and creates the task (#36).
//
// The dialog is pure: it returns a draft. The write lives here, like the other
// open* funnels (open-editor, open-project, open-group), so the dialog cannot
// decide to write on its own. A failed create is reported, never toasted as a
// success — and a host without `api.tasks` fails inside the try, not before it.

import { reportError } from './report.js';

export async function openFollowUpTask(api, contact) {
  const t = (key, vars) => api.i18n.t(key, vars);
  const result = await api.ui.openDialog({
    title: t('tasks.title'),
    slot: 'plugin-dialog',
    extraProps: { taskEditor: { contact } },
  });
  if (!result?.draft) return null;
  try {
    const created = await api.tasks.create(result.draft);
    api.toast.success(t('tasks.created', { title: result.draft.title }));
    return created ?? true;
  } catch (err) {
    await reportError(api, t('tasks.createFailed', { reason: String(err?.message ?? err) }));
    return null;
  }
}
