// Opening the group editor from anywhere — the command palette and the Groups
// tab — and toasting the outcome. The dialog does the writing; this only
// supplies the props it needs: the cards for the member search, the address
// books, and the detection options behind the "duplicates in this list"
// warning (the same options the Duplicates page scans with).
import { loadBooks, loadCards } from './contacts.js';
import { policyAwareOptions } from './book-policies.js';

export async function openGroup(api, { mode = 'create', group = null } = {}) {
  const [cards, books] = await Promise.all([
    loadCards(api).catch(() => []),
    loadBooks(api).catch(() => []),
  ]);
  const detectOptions = await policyAwareOptions(api).catch(() => ({}));
  return api.ui.openDialog({
    title: api.i18n.t(mode === 'edit' ? 'groups.editTitle' : 'groups.newTitle'),
    slot: 'plugin-dialog',
    extraProps: { groupEditor: { mode, group }, cards, books, detectOptions },
  });
}

/** The toast for whatever the group dialog returned (null when cancelled). */
export function toastGroupResult(api, result) {
  if (!result) return;
  if (result.deleted) api.toast.success(api.i18n.t('groups.deleted'));
  else api.toast.success(api.i18n.t(result.saved === 'created' ? 'groups.created' : 'groups.updated'));
}
