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
import { previewFields, memberDetails } from './preview.js';

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
        },
          `${isKeep ? '✓ ' : ''}${contactName(member) || member.id}`),
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

    const renderFieldPreview = (fieldPreview, donorById) => {
      const { field, labelKey, kept, added } = fieldPreview;
      const label = t(labelKey);

      return h(Row, { key: field, gap: 2, wrap: true },
        h(Text, { style: { fontWeight: '600', minWidth: '120px', whiteSpace: 'nowrap' } }, label),
        h(Text, { tone: 'muted', style: { fontSize: '11px' } }, `kept:`),
        kept.length > 0
          ? h(Stack, { gap: 0 },
            ...kept.map((value, i) => h(Chip, { key: `k${i}`, label: value })))
          : h(Text, { tone: 'muted', style: { fontSize: '11px' } }, '—'),
        added.length > 0
          ? h(Stack, { gap: 0 },
            ...added.map((entry, i) => h(Chip, {
              key: `a${i}`,
              label: `+ ${entry.value}`,
              tone: 'success',
            })))
          : null,
        added.length > 0
          ? h(Text, { tone: 'muted', style: { fontSize: '10px' } },
            `from ${added.map((e) => donorById[e.fromId] || e.fromId).join(', ')}`)
          : null,
      );
    };

    return h(Stack, { gap: 4 },
      h(Text, { tone: 'muted' }, t('dialog.intro')),
      ...groups.map((group) => {
        const signature = group.signature;
        const keepId = keepBy[signature] || planMerge(group).primary?.id || '';
        const plan = planMerge(group, keepId);
        const nameById = Object.fromEntries(group.members.map((m) => [m.id, contactName(m) || m.id]));
        const keptName = contactName(plan.primary) || plan.primary?.id || '';

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
            // Comprehensive merge preview: every field that exists or will be added.
            plan && plan.added.length > 0 ? h(Section, { title: t('dialog.previewTitle', { name: keptName }) },
              ...previewFields(plan).map((fieldPreview) => renderFieldPreview(fieldPreview, nameById)),
              h(InfoBar, { tone: 'info', title: t('dialog.previewNote') }))
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
