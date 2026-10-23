// One place that opens the project dialog and toasts the outcome, used by the
// command palette and by the Projects page.
import { loadCards } from './contacts.js';

export async function openProject(api, { mode = 'create', project = null } = {}) {
  const cards = await loadCards(api).catch(() => []);
  return api.ui.openDialog({
    title: api.i18n.t(mode === 'edit' ? 'projects.editTitle' : 'projects.newTitle'),
    slot: 'plugin-dialog',
    extraProps: { projectEditor: { mode, project }, cards },
  });
}

export function toastProjectResult(api, result) {
  if (!result) return;
  if (result.deleted) api.toast.success(api.i18n.t('projects.deleted'));
  else api.toast.success(api.i18n.t(result.saved === 'created' ? 'projects.created' : 'projects.updated'));
}
