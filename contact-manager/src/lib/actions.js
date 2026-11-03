// The plugin's actions, in one place.
//
// The command palette, the contact-list toolbar and the main page's menu all run
// **these** functions. They used to live in `index.js`, which the page cannot
// reach: the palette actions run in the host's background frame while a page
// runs in its own frame, so a menu on the page had nothing to call — and a
// second copy of the same logic would be the thing that drifts.
//
// They read the api and write through it; no DOM.

import { loadBooks, loadCards } from './contacts.js';
import { findDuplicateGroups, readDismissed } from './duplicates.js';
import { toastMergeResult } from './labels.js';
import { openEditor, toastEditorResult } from './open-editor.js';
import { openProject, toastProjectResult } from './open-project.js';
import { openGroup, toastGroupResult } from './open-group.js';
import { runRules } from './open-rules.js';
import { manageAutomation } from './open-automation.js';
import { runAutomationForCards } from './automation.js';
import { undoLastMerge } from './undo.js';
import { policyAwareOptions } from './book-policies.js';
import { contactsToFile } from './export.js';
import { saveFile } from './download.js';
import { fileNameFor } from './smart-lists.js';

/** Duplicate groups over all contacts, or over `scopeIds` when given. */
export async function scanGroups(api, scopeIds = null) {
  const cards = await loadCards(api);
  const list = scopeIds ? cards.filter((card) => scopeIds.has(card.id)) : cards;
  const [dismissed, opts] = await Promise.all([
    scopeIds ? [] : readDismissed(api), policyAwareOptions(api),
  ]);
  return findDuplicateGroups(list, opts, dismissed);
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

/** The group editor, in create mode. */
export async function newGroup(api) {
  toastGroupResult(api, await openGroup(api, { mode: 'create' }));
}

/**
 * The normalisation rules over every contact — the command palette's entry
 * point. The dialog shows the exact edits first; this applies and toasts them.
 */
export async function normalisationRules(api) {
  return runRules(api);
}

/**
 * The automation rule builder (#33) — the command palette's entry point. The
 * dialog writes the rules itself; this opens it and toasts what was saved.
 */
export async function automationRules(api) {
  return manageAutomation(api);
}

/**
 * The Help dialog (#39): the search operators, the keyboard shortcuts and a
 * short "what's new". It only reads, so there is nothing to toast.
 */
export async function openHelp(api) {
  return api.ui.openDialog({
    title: api.i18n.t('help.title'),
    slot: 'plugin-dialog',
    extraProps: { help: true },
  });
}

/**
 * The Smart lists dialog (#13, the command-palette half): the saved searches
 * with live counts, and the members of the one the user picks. The dialog
 * returns what to export and **this** performs it, so the dialog never opens a
 * dialog of its own — and the export falls back to showing the file when the
 * sandbox refuses the download, the same as the Contacts page.
 */
export async function smartLists(api) {
  const t = (key, vars) => api.i18n.t(key, vars);
  const result = await api.ui.openDialog({
    title: t('smartLists.title'),
    slot: 'plugin-dialog',
    extraProps: { smartLists: true },
  });
  if (!result?.export) return;
  const { cards, format, name } = result.export;
  const file = contactsToFile(cards, format);
  if (!file.body) {
    api.toast.warning(t('contacts.exportEmpty'));
    return;
  }
  file.name = fileNameFor(name, format);
  const saved = await saveFile(api, file.body, file.name, file.type);
  if (!saved) {
    await api.ui.openDialog({
      title: t('export.resultTitle'),
      slot: 'plugin-dialog',
      extraProps: { exportResult: { name: file.name, body: file.body } },
    });
  }
  api.toast.success(t('contacts.exported', { count: cards.length }));
}

/**
 * The address-book policies dialog (#7) — shared by the Duplicates page, the
 * command palette and the Getting started guide, so the three cannot disagree
 * about which books it lists. The books are read here rather than trusted from
 * a page's last scan: with autoScan off there may be no scan to trust, and the
 * dialog would open on "No address books found."
 *
 * `fallbackBooks` is what the caller already knows, used only when the read
 * fails; the dialog then still shows something instead of nothing.
 */
export async function managePolicies(api, { fallbackBooks = [] } = {}) {
  let books = fallbackBooks;
  try {
    books = await loadBooks(api);
  } catch {
    // keep the fallback; the dialog still shows what we know
  }
  return api.ui.openDialog({
    title: api.i18n.t('policies.title'),
    slot: 'plugin-dialog',
    extraProps: { policiesDialog: true, books },
  });
}

/**
 * The import wizard: it reads the file, shows what would happen, and returns
 * what it wrote. Duplicates the user chose to merge come back as review-dialog
 * groups — every merge goes through that dialog (see `.clinerules`) — so the action
 * opens it here, then toasts the whole outcome. The page toasts that; the
 * palette has no page to toast from, so this does it here.
 */
export async function importContacts(api) {
  const t = (key, vars) => api.i18n.t(key, vars);
  const result = await api.ui.openDialog({
    title: t('import.title'),
    slot: 'plugin-dialog',
    extraProps: { importWizard: true },
  });
  if (!result) return;

  // The import is the one event the plugin owns, so the `import` trigger runs
  // here — over the cards the wizard created, before any merge is reviewed.
  if (result.cards?.length) {
    await runAutomationForCards(api, { trigger: 'import', cards: result.cards.map((entry) => entry.card) });
  }

  let merged = 0;
  if (result.mergeGroups?.length) {
    const review = await api.ui.openDialog({
      title: t('dialog.title'),
      slot: 'plugin-dialog',
      extraProps: { groups: result.mergeGroups },
    });
    merged = review?.merged ?? 0;
    toastMergeResult(api, review);
  }

  // A merge decision was written as a contact and then folded into an existing
  // one, so it is no longer new; a merge that was skipped in the review dialog
  // leaves that contact in place, so it still counts.
  const created = Math.max(0, (result.created ?? 0) - merged);
  if (result.failed) {
    api.toast.warning(t('import.partial', { created, failed: result.failed }));
  } else if (result.skipped) {
    api.toast.success(t('import.doneSkipped', { created, skipped: result.skipped }));
  } else if (created) {
    api.toast.success(t('import.done', { created }));
  }
}

/**
 * Asks the configured server for its version — the spike that proves the path.
 *
 * It reports rather than throws, so an unconfigured plugin, an older webmail
 * without `api.proxy` and a server that is down are three different messages
 * instead of one failure.
 */
export async function checkServer(api) {
  const { serverVersion } = await import('./remote.js');
  const result = await serverVersion(api);
  const t = (key, vars) => api.i18n.t(key, vars);
  if (result.status === 'ok') api.toast.success(t('remote.ok', { version: result.version }));
  else if (result.status === 'unconfigured') api.toast.info(t('remote.unconfigured'));
  else if (result.status === 'unavailable') api.toast.warning(t('remote.unavailable'));
  else api.toast.error(t('remote.failed', { reason: result.reason ?? result.code ?? '' }));
}
