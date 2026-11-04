// One place that opens the automation rule builder (#33), so the command
// palette and the main page behave the same way. The dialog writes the rules
// itself; this only supplies what it needs — the rules, the contacts for the
// dry run, and the address books the `book:` condition reads — and toasts the
// outcome.

import { bookNamesById, loadBooks, loadCards } from './contacts.js';
import { readAutomation } from './automation.js';

export async function openAutomation(api) {
  const [rules, cards, bookList] = await Promise.all([
    readAutomation(api),
    loadCards(api).catch(() => []),
    loadBooks(api).catch(() => []),
  ]);
  return api.ui.openDialog({
    title: api.i18n.t('automation.title'),
    slot: 'plugin-dialog',
    extraProps: { automationEditor: { rules, cards, books: bookNamesById(bookList) } },
  });
}

/** The toast for whatever the builder returned (null when cancelled). */
export function toastAutomationResult(api, result) {
  if (!result) return;
  if (result.saved) api.toast.success(api.i18n.t('automation.savedToast', { count: result.saved }));
  if (result.removed) api.toast.info(api.i18n.t('automation.removedToast', { count: result.removed }));
}

/** The palette action / page button: open the builder. */
export async function manageAutomation(api) {
  return toastAutomationResult(api, await openAutomation(api));
}
