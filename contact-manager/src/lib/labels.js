// Display glue shared by the page, the dialog and the detail section:
// i18n-keyed labels and toasts, no logic of their own.

import { contactName, primaryEmail, primaryPhone } from './contacts.js';
import { undoWindowMs } from './undo.js';

export const strengthKey = (group) => (group.strength === 'strong' ? 'group.strongBadge' : 'group.possibleBadge');

const REASON_KEYS = { email: 'group.reasonEmail', phone: 'group.reasonPhone', name: 'group.reasonName' };

/** "Same email address: a@b.de · Same name" — what made this a group. */
export function reasonLine(t, group) {
  const parts = (group?.reasons ?? []).map((reason) => {
    const label = t(REASON_KEYS[reason.type] ?? 'group.reasonName');
    return reason.type === 'name' ? label : `${label}: ${reason.value}`;
  });
  return parts.join(' · ');
}

/** "Ada Lovelace · ada@example.org · +49 176 1234567" for one row. */
export function memberLabel(card) {
  return [contactName(card), primaryEmail(card), primaryPhone(card)].filter(Boolean).join(' · ');
}

/** "Merge" up to one group, "Merge {count} groups" for several. */
export const mergeLabel = (t, count) => (count <= 1 ? t('dialog.mergeOne') : t('dialog.mergeN', { count }));

/** The toast for a merge the review dialog handed back through onResult. */
export function toastMergeResult(api, result) {
  if (!result) return;
  const vars = { groups: result.merged, removed: result.removed, failed: result.failed };
  if (result.failed) api.toast.warning(api.i18n.t('toast.partial', vars));
  else api.toast.success(api.i18n.t('toast.merged', vars));
  // Toasts have no action buttons, so the undo lives on the page and in the
  // command palette — the toast just says how long it stays available.
  if (result.undoable) {
    api.toast.info(api.i18n.t('toast.undoHint', { minutes: undoWindowMinutes(api.plugin?.settings) }));
  }
}

/** The `undoMinutes` setting as a whole number of minutes (0 = undo off). */
export const undoWindowMinutes = (settings) => Math.round(undoWindowMs(settings) / 60_000);
