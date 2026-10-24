/**
 * Contact Manager — a Bulwark Mail plugin that finds and merges duplicate
 * contacts. Structure follows the official plugin template:
 * slots (React components in iframes), hooks (plain handlers in the hidden
 * background frame) and a one-shot activate().
 *
 * Surfaces used (each with its permission in manifest.json):
 *   app-page                 ui:app-page     the Contact Manager page
 *   plugin-dialog            ui:observe      the shared review/merge dialog
 *   contact-detail-section   ui:contacts     duplicate hint on a contact
 *   command-palette action   ui:commands     "Find duplicate contacts"
 *   contact-list-actions     ui:contacts     "Find duplicates in selection"
 */

const React = require('react');
const api = require('@plugin-host');

import { detectionOptions, loadCards } from './lib/contacts.js';
import { findDuplicateGroups, readDismissed } from './lib/duplicates.js';
import { toastMergeResult, undoWindowMinutes } from './lib/labels.js';
import { undoLastMerge, readUndo } from './lib/undo.js';
import { warnAboutDuplicates } from './lib/watch.js';
import { makeManagerPage } from './lib/manager-page.js';
import { makeReviewDialog } from './lib/review-dialog.js';
import { makeDuplicateSection } from './lib/detail-section.js';
import { makeEditorDialog } from './lib/editor-dialog.js';
import { makeAppShell } from './lib/app-shell.js';
import { makeProfilePage } from './lib/profile-page.js';
import { makeProjectsPage } from './lib/projects-page.js';
import { makeProjectDialog } from './lib/project-dialog.js';
import { makeBulkDialog } from './lib/bulk-dialog.js';
import { makeNormaliseDialog } from './lib/normalise-dialog.js';
import { openEditor, toastEditorResult } from './lib/open-editor.js';
import { openProject, toastProjectResult } from './lib/open-project.js';
import { detectCapabilities, describeCapabilities, unavailableNamespaces } from './lib/capabilities.js';

const enabled = (pluginApi) => pluginApi.plugin.settings.enabled !== false;

/** Duplicate groups over all contacts, or over `scopeIds` when given. */
async function scanGroups(pluginApi, scopeIds = null) {
  const cards = await loadCards(pluginApi);
  const list = scopeIds
    ? cards.filter((card) => scopeIds.has(card.id))
    : cards;
  const dismissed = scopeIds ? [] : await readDismissed(pluginApi);
  return findDuplicateGroups(list, await detectionOptions(pluginApi), dismissed);
}

/** Scan, then open the review dialog; toast the outcome. */
async function scanAndReview(pluginApi, scopeIds = null) {
  let groups;
  try {
    groups = await scanGroups(pluginApi, scopeIds);
  } catch (err) {
    pluginApi.toast.error(pluginApi.i18n.t('scan.failed', { reason: String(err?.message ?? err) }));
    return;
  }
  if (!groups.length) {
    pluginApi.toast.info(pluginApi.i18n.t('toast.clean'));
    return;
  }
  const result = await pluginApi.ui.openDialog({
    title: pluginApi.i18n.t('dialog.title'),
    slot: 'plugin-dialog',
    extraProps: { groups },
  });
  toastMergeResult(pluginApi, result);
}

/** Undo the newest merge record; report how much was restored. */
async function undoMerge(pluginApi) {
  let result;
  try {
    result = await undoLastMerge(pluginApi);
  } catch (err) {
    pluginApi.toast.error(pluginApi.i18n.t('undo.failed', { reason: String(err?.message ?? err) }));
    return;
  }
  if (!result.total) {
    pluginApi.toast.info(pluginApi.i18n.t('undo.none'));
    return;
  }
  const vars = { restored: result.restored, reverted: result.reverted, failed: result.failed };
  if (result.failed) pluginApi.toast.warning(pluginApi.i18n.t('undo.partial', vars));
  else pluginApi.toast.success(pluginApi.i18n.t('undo.done', vars));
}

// ─── Slots ─────────────────────────────────────────────────────

// One app-page slot carries the whole plugin: a single navigation-rail entry
// whose body is split into sub-tabs — Duplicates, Contacts and Projects.
const AppShell = makeAppShell(React, api, {
  duplicates: makeManagerPage(React, api),
  contacts: makeProfilePage(React, api),
  projects: makeProjectsPage(React, api),
});

// One dialog slot serves five purposes: the review/merge dialog, the contact
// editor, the project editor, the bulk editor for a selection and the cleanup
// preview. The `extraProps` marker picks which component the host renders.
const ReviewDialog = makeReviewDialog(React, api);
const EditorDialog = makeEditorDialog(React, api);
const ProjectDialog = makeProjectDialog(React, api);
const BulkDialog = makeBulkDialog(React, api);
const NormaliseDialog = makeNormaliseDialog(React, api);
function DialogSlot(props) {
  if (props?.editor) return React.createElement(EditorDialog, props);
  if (props?.projectEditor) return React.createElement(ProjectDialog, props);
  if (props?.bulkEditor) return React.createElement(BulkDialog, props);
  if (props?.normalise) return React.createElement(NormaliseDialog, props);
  return React.createElement(ReviewDialog, props);
}

export const slots = {
  // The Contact Manager page: Duplicates, Contacts and Projects in sub-tabs.
  'app-page': {
    component: AppShell,
    shouldShow: () => enabled(api),
  },
  // Review/merge and the contact editor, both opened with api.ui.openDialog.
  'plugin-dialog': {
    component: DialogSlot,
  },
  // The duplicate hint in a contact's details.
  'contact-detail-section': {
    component: makeDuplicateSection(React, api),
    shouldShow: () => enabled(api),
  },
};

// ─── Hooks ─────────────────────────────────────────────────────

export const hooks = {
  // Clicks on the buttons declared with api.ui.setActions — no own permission.
  async onAction({ surface, actionId, context }) {
    if (actionId === 'scan') {
      await scanAndReview(api);
      return;
    }
    if (actionId === 'scan-selection') {
      const ids = context?.contactIds;
      if (!Array.isArray(ids) || !ids.length) {
        api.toast.info(api.i18n.t('toast.needSelection'));
        return;
      }
      await scanAndReview(api, new Set(ids));
      return;
    }
    if (actionId === 'undo-merge') {
      await undoMerge(api);
      return;
    }
    if (actionId === 'new-contact') {
      toastEditorResult(api, await openEditor(api, { mode: 'create' }));
      return;
    }
    if (actionId === 'new-company') {
      toastEditorResult(api, await openEditor(api, { mode: 'create', company: true }));
      return;
    }
    if (actionId === 'new-project') {
      toastProjectResult(api, await openProject(api, { mode: 'create' }));
    }
  },

  // Never block a save: both are observers. They only say what the new
  // contact looks like next to the ones already in the address books.
  async onAfterContactCreate(contact) {
    await warnAboutDuplicates(api, contact);
  },
  async onAfterContactUpdate(contact) {
    await warnAboutDuplicates(api, contact);
  },
};

// ─── Activate (one-shot init) ──────────────────────────────────

// Publishes (or clears) the page entry and the action buttons. Re-run on
// locale and settings changes, so labels and the enabled switch stay right.
async function publish(pluginApi) {
  if (!enabled(pluginApi)) {
    await pluginApi.ui.setPages([]);
    await pluginApi.ui.setActions('command-palette', []);
    await pluginApi.ui.setActions('contact-list-actions', []);
    return;
  }
  const t = (key) => pluginApi.i18n.t(key);
  await pluginApi.ui.setPages([
    { id: 'contact-manager', title: t('page.title'), icon: 'users' },
  ]);
  const undoOn = undoWindowMinutes(pluginApi.plugin.settings) > 0;
  const pending = undoOn ? await readUndo(pluginApi) : [];
  await pluginApi.ui.setActions('command-palette', [
    { id: 'scan', label: t('action.scanCommand'), icon: 'copy' },
    { id: 'new-contact', label: t('action.newContact'), icon: 'user-plus' },
    { id: 'new-company', label: t('action.newCompany'), icon: 'building' },
    { id: 'new-project', label: t('action.newProject'), icon: 'folder' },
    ...(pending.length ? [{ id: 'undo-merge', label: t('action.undoCommand'), icon: 'undo' }] : []),
  ]);
  await pluginApi.ui.setActions('contact-list-actions', [
    { id: 'scan-selection', label: t('action.selectionCommand'), icon: 'copy' },
  ]);
}

export async function activate(pluginApi) {
  // Say once, loudly, when an optional API is not there — with the method names
  // the host does expose, which is what makes a wrong method name findable.
  // Stays silent on a host that has everything.
  try {
    const capabilities = detectCapabilities(pluginApi);
    const unavailable = unavailableNamespaces(capabilities);
    if (unavailable.length) {
      pluginApi.log.warn(
        `optional APIs unavailable (${unavailable.join(', ')}) — host exposes ${describeCapabilities(capabilities)}`,
      );
    }
  } catch (err) {
    pluginApi.log.warn(`capability check failed: ${err.message}`);
  }
  // Drop undo records that outlived their window before anything reads them.
  try {
    await readUndo(pluginApi);
  } catch (err) {
    pluginApi.log.warn(`undo purge failed: ${err.message}`);
  }
  try {
    await publish(pluginApi);
  } catch (err) {
    // Missing permission or an older webmail: the plugin still runs, just
    // without the page entry and buttons.
    pluginApi.log.warn(`publish failed: ${err.message}`);
  }
  pluginApi.i18n.onLocaleChange(() => { void publish(pluginApi).catch(() => {}); });
  pluginApi.plugin.onSettingsChange(() => { void publish(pluginApi).catch(() => {}); });
}
