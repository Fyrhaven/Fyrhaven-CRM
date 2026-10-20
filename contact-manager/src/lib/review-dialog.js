// The plugin-dialog slot: review duplicate groups and merge them. Every merge
// path (page, command palette, contact list toolbar, contact details) funnels
// through this dialog, so exactly one place decides what is kept and deletes
// contacts.
//
// The host passes api.ui.openDialog's `extraProps` as props — `{ groups }` —
// plus `onResult(value)` which closes the dialog with that value.

import { DialogButtons, Field, Select, Checkbox, Badge, Card, Row, Stack, Text, Chip, Section, InfoBar } from '@plugin-host/ui';
import { contactName } from './contacts.js';
import { mergeGroups, planMerge } from './duplicates.js';
import { memberLabel, mergeLabel, reasonLine, strengthKey } from './labels.js';
import { previewFields, previewCounts, memberDetails } from './preview.js';

export function makeReviewDialog(React, api) {
  const { createElement: h, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function ReviewDialog(props) {
    const groups = (Array.isArray(props.groups) ? props.groups : [])
      .filter((group) => Array.isArray(group.members) && group.members.length > 1);
    const [included, setIncluded] = useState(() => new Set(groups.map((g) => g.signature)));
    const [keepBy, setKeepBy] = useState(() =>
      Object.fromEntries(groups.map((g) => [g.signature, planMerge(g).primary?.id ?? ''])));
    const [busy, setBusy] = useState(false);

    const close = (value) => props.onResult?.(value);
    const chosen = groups.filter((group) => included.has(group.signature));
    const removeCount = chosen.reduce((n, group) => n + group.members.length - 1, 0);

    const toggle = (signature, on) => setIncluded((previous) => {
      const next = new Set(previous);
      if (on) next.add(signature);
      else next.delete(signature);
      return next;
    });

    const merge = async () => {
      if (!chosen.length || busy) return;
      const ok = await api.ui.confirm({
        title: mergeLabel(t, chosen.length),
        message: t('dialog.confirmBody', { keep: chosen.length, remove: removeCount }),
        confirmLabel: mergeLabel(t, chosen.length),
        danger: true,
      });
      if (!ok) return;
      setBusy(true);
      try {
        const result = await mergeGroups(api, chosen, keepBy);
        close({ merged: result.merged, removed: result.removed, failed: result.failed.length });
      } catch (err) {
        api.toast.error(t('scan.failed', { reason: String(err?.message ?? err) }));
        setBusy(false);
      }
    };

    if (!groups.length) {
      return h(Stack, { gap: 4 },
        h(Text, { tone: 'muted' }, t('dialog.none')),
        h(DialogButtons, {
          buttons: [{ id: 'cancel', label: t('dialog.cancel'), variant: 'secondary' }],
          onClick: () => close(null),
        }));
    }

    const renderMember = (member, keepId) => {
      const isKeep = member.id === keepId;
      const details = memberDetails(member);
      return h(Row, { key: member.id, gap: 2, wrap: true },
        h(Text, {
          tone: isKeep ? undefined : 'muted',
          style: { fontWeight: isKeep ? 'bold' : 'normal', whiteSpace: 'nowrap' },
        }, contactName(member) || member.id),
        h(Badge, { tone: isKeep ? 'success' : 'danger' },
          t(isKeep ? 'dialog.keepBadge' : 'dialog.deleteBadge')),
        details.emails.length > 0
          ? h(Stack, { gap: 0 },
            ...details.emails.map((email, i) => h(Chip, { key: `e${i}`, label: email })))
          : null,
        details.phones.length > 0
          ? h(Stack, { gap: 0 },
            ...details.phones.map((phone, i) => h(Chip, { key: `p${i}`, label: phone })))
          : null,
        details.meta ? h(Text, { tone: 'muted', style: { fontSize: '11px' } }, details.meta) : null,
      );
    };

    const legendLine = (tone, symbol, text) => h(Row, { key: text, gap: 2, wrap: true },
      h(Badge, { tone }, symbol),
      h(Text, { tone: 'muted', style: { fontSize: '12px' } }, text));

    const renderLegend = () => h(InfoBar, { tone: 'info', title: t('dialog.legendTitle') },
      h(Stack, { gap: 1 },
        h(Text, { key: 'note', tone: 'muted', style: { fontSize: '12px' } }, t('dialog.previewNote')),
        legendLine('success', '+', t('dialog.legendNew')),
        legendLine('warning', '≠', t('dialog.legendConflict')),
        legendLine('neutral', '✓', t('dialog.legendKept'))));

    const renderFieldPreview = (fieldPreview, donorById) => {
      const { field, labelKey, kept, added, conflicts } = fieldPreview;
      const sources = [...new Set([...added, ...conflicts].map((entry) => donorById[entry.fromId] || entry.fromId))];

      return h(Stack, { key: field, gap: 1 },
        h(Row, { gap: 2, wrap: true },
          h(Text, { style: { fontWeight: '600', minWidth: '120px', whiteSpace: 'nowrap' } }, t(labelKey)),
          ...kept.map((value, i) => h(Badge, { key: `k${i}`, tone: 'neutral' }, value)),
          ...added.map((entry, i) => h(Badge, { key: `a${i}`, tone: 'success' }, `+ ${entry.value}`)),
          ...conflicts.map((entry, i) => h(Badge, { key: `c${i}`, tone: 'warning' }, `≠ ${entry.value}`))),
        sources.length > 0
          ? h(Text, { tone: 'muted', style: { fontSize: '11px' } }, t('dialog.addedFrom', { name: sources.join(', ') }))
          : null);
    };

    return h(Stack, { gap: 4 },
      h(Text, { tone: 'muted' }, t('dialog.intro')),
      renderLegend(),
      ...groups.map((group) => {
        const signature = group.signature;
        const keepId = keepBy[signature] || planMerge(group).primary?.id || '';
        const plan = planMerge(group, keepId);
        const nameById = Object.fromEntries(group.members.map((m) => [m.id, contactName(m) || m.id]));
        const keptName = contactName(plan.primary) || plan.primary?.id || '';
        const detailFields = plan.primary ? previewFields(plan) : [];
        const detailCounts = previewCounts(detailFields);

        return h(Card, { key: signature },
          h(Stack, { gap: 2 },
            h(Row, { gap: 2 },
              h(Checkbox, {
                checked: included.has(signature),
                label: t('dialog.include'),
                ariaLabel: `${t('dialog.include')}: ${group.members.map(contactName).join(', ')}`,
                onChange: (on) => toggle(signature, on),
              }),
              h(Badge, { tone: group.strength === 'strong' ? 'success' : 'warning' }, t(strengthKey(group))),
              h(Text, { tone: 'muted' }, t('group.members', { count: group.members.length }))),
            h(Text, { tone: 'muted' }, reasonLine(t, group)),
            h(Field, { label: t('dialog.keep') },
              h(Select, {
                value: keepId,
                options: group.members.map((m) => ({ value: m.id, label: memberLabel(m) })),
                onChange: (value) => setKeepBy((previous) => ({ ...previous, [signature]: value })),
              })),
            // Member roster — full details so duplicates that share a name can be told apart.
            h(Section, { title: t('dialog.membersTitle') },
              ...group.members.map((member) => renderMember(member, keepId))),
            // Complete details of the contact to keep: what stays, what the
            // merge adds, and which duplicate values will not be merged.
            plan && plan.primary ? h(Section, { title: t('dialog.previewTitle', { name: keptName }) },
              detailFields.length
                ? h(Text, { tone: 'muted', style: { fontSize: '12px' } }, t('dialog.previewSummary', detailCounts))
                : h(Text, { tone: 'muted' }, t('dialog.noChanges')),
              ...detailFields.map((fieldPreview) => renderFieldPreview(fieldPreview, nameById)))
            : null,
          ));
      }),
      h(DialogButtons, {
        buttons: [
          { id: 'cancel', label: t('dialog.cancel'), variant: 'secondary' },
          { id: 'merge', label: mergeLabel(t, chosen.length), variant: 'primary', disabled: !chosen.length || busy, busy },
        ],
        onClick: (id) => { if (id === 'merge') void merge(); else close(null); },
      }));
  };
}
