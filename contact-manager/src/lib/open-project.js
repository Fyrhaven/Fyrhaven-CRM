// One place that opens the project dialog and toasts the outcome, used by the
// command palette and by the Projects page. The dialog only collects the
// draft; storing it happens here, so every entry point saves the same way.
import { loadCards } from './contacts.js';
import { saveProject } from './projects.js';

export async function openProject(api, { mode = 'create', project = null } = {}) {
  const cards = await loadCards(api).catch(() => []);
  const result = await api.ui.openDialog({
    title: api.i18n.t(mode === 'edit' ? 'projects.editTitle' : 'projects.newTitle'),
    slot: 'plugin-dialog',
    extraProps: { projectEditor: { mode, project }, cards },
  });
  if (!result || result.deleted) return result;
  try {
    await saveProject(api, result.project);
    return result;
  } catch (err) {
    api.toast.error(api.i18n.t('projects.saveFailed', { reason: String(err?.message ?? err) }));
    return null;
  }
}

export function toastProjectResult(api, result) {
  if (!result) return;
  if (result.deleted) api.toast.success(api.i18n.t('projects.deleted'));
  else api.toast.success(api.i18n.t(result.saved === 'created' ? 'projects.created' : 'projects.updated'));
}
