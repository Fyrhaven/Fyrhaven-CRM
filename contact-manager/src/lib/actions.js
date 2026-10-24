// The plugin's actions, in one place.
//
// The command palette, the contact-list toolbar and the main page's menu all run
// **these** functions. They used to live in `index.js`, which the page cannot
// reach: the palette actions run in the host's background frame while a page
// runs in its own frame, so a menu on the page had nothing to call — and a
// second copy of the same logic would be the thing that drifts.
//
// They read the api and write through it; no DOM.

import { detectionOptions, loadCards } from './contacts.js';
import { findDuplicateGroups, readDismissed } from './duplicates.js';
import { toastMergeResult } from './labels.js';
import { openEditor, toastEditorResult } from './open-editor.js';
import { openProject, toastProjectResult } from './open-project.js';
import { undoLastMerge } from './undo.js';

/** Duplicate groups over all contacts, or over `scopeIds` when given. */
export async function scanGroups(api, scopeIds = null) {
  const cards = await loadCards(api);
  const list = scopeIds ? cards.filter((card) => scopeIds.has(card.id)) : cards;
  const dismissed = scopeIds ? [] : await readDismissed(api);
  return findDuplicateGroups(list, await detectionOptions(api), dismissed);
}

/** Scan, then open the review dialog; toast the outcome. */
export async function findDuplicates(api, scopeIds = null) {
  let groups;
  try {
    groups = await scanGroups(api, scopeIds);
  } catch (err) {
    api.toast.error(api.i18n.t('scan.failed', { reason: String(err?.message ?? err) }));
    return;
  }
  if (!groups.length) {
    api.toast.info(api.i18n.t('toast.clean'));
    return;
  }
  const result = await api.ui.openDialog({
    title: api.i18n.t('dialog.title'),
    slot: 'plugin-dialog',
    extraProps: { groups },
  });
  toastMergeResult(api, result);
}

/** Undo the newest merge record; report how much was restored. */
export async function undoMerge(api) {
  let result;
  try {
    result = await undoLastMerge(api);
  } catch (err) {
    api.toast.error(api.i18n.t('undo.failed', { reason: String(err?.message ?? err) }));
    return;
  }
  if (!result.total) {
    api.toast.info(api.i18n.t('undo.none'));
    return;
  }
  const vars = { restored: result.restored, reverted: result.reverted, failed: result.failed };
  if (result.failed) api.toast.warning(api.i18n.t('undo.partial', vars));
  else api.toast.success(api.i18n.t('undo.done', vars));
}

/** The contact editor, in create mode. */
export async function newContact(api) {
  toastEditorResult(api, await openEditor(api, { mode: 'create' }));
}

/** The contact editor, in create mode, as a company. */
export async function newCompany(api) {
  toastEditorResult(api, await openEditor(api, { mode: 'create', company: true }));
}

/** The project editor, in create mode. */
export async function newProject(api) {
  toastProjectResult(api, await openProject(api, { mode: 'create' }));
}
