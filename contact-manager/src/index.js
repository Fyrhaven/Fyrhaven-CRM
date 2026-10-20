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

import { loadCards, matchOptions } from './lib/contacts.js';
import { findDuplicateGroups, readDismissed } from './lib/duplicates.js';
import { toastMergeResult } from './lib/labels.js';
import { makeManagerPage } from './lib/manager-page.js';
import { makeReviewDialog } from './lib/review-dialog.js';
import { makeDuplicateSection } from './lib/detail-section.js';

const enabled = (pluginApi) => pluginApi.plugin.settings.enabled !== false;

/** Duplicate groups over all contacts, or over `scopeIds` when given. */
async function scanGroups(pluginApi, scopeIds = null) {
  const cards = await loadCards(pluginApi);
  const list = scopeIds
    ? cards.filter((card) => scopeIds.has(card.id))
    : cards;
  const dismissed = scopeIds ? [] : await readDismissed(pluginApi);
  return findDuplicateGroups(list, matchOptions(pluginApi.plugin.settings), dismissed);
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

// ─── Slots ─────────────────────────────────────────────────────

export const slots = {
  // The Contact Manager page at /apps/contact-manager/duplicates.
  'app-page': {
    component: makeManagerPage(React, api),
    shouldShow: () => enabled(api),
  },
  // Review and merge, opened from the page, the palette and the list toolbar.
  'plugin-dialog': {
    component: makeReviewDialog(React, api),
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
    }
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
  await pluginApi.ui.setPages([{ id: 'duplicates', title: t('page.title'), icon: 'users' }]);
  await pluginApi.ui.setActions('command-palette', [
    { id: 'scan', label: t('action.scanCommand'), icon: 'copy' },
  ]);
  await pluginApi.ui.setActions('contact-list-actions', [
    { id: 'scan-selection', label: t('action.selectionCommand'), icon: 'copy' },
  ]);
}

export async function activate(pluginApi) {
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
