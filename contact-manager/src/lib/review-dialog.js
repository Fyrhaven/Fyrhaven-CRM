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
import { memberLabel, mergeLabel, reasonLine, strengthKey, undoWindowMinutes } from './labels.js';
import { previewFields, previewCounts, conflictFields, memberDetails } from './preview.js';
import { buildEntry, saveUndo } from './undo.js';

export function makeReviewDialog(React, api) {
  const { createElement: h, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function ReviewDialog(props) {
    const groups = (Array.isArray(props.groups) ? props.groups : [])
      .filter((group) => Array.isArray(group.members) && group.members.length > 1);
    const [included, setIncluded] = useState(() => new Set(groups.map((g) => g.signature)));
    const [keepBy, setKeepBy] = useState(() =>
      Object.fromEntries(groups.map((g) => [g.signature, planMerge(g).primary?.id ?? ''])));
    const [choicesBy, setChoicesBy] = useState({});
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
      const minutes = undoWindowMinutes(api.plugin?.settings);
      const ok = await api.ui.confirm({
        title: mergeLabel(t, chosen.length),
        message: [
          t('dialog.confirmBody', { keep: chosen.length, remove: removeCount }),
          minutes ? t('dialog.confirmUndoable', { minutes }) : '',
        ].filter(Boolean).join(' '),
        confirmLabel: mergeLabel(t, chosen.length),
        danger: true,
      });
      if (!ok) return;
      setBusy(true);
      try {
        const journal = [];
        const result = await mergeGroups(api, chosen, keepBy, choicesBy, journal);
        // Remember what the merge changed before the dialog closes, so the
        // page and the command palette can offer an undo for a while.
        let undoable = 0;
        try {
          undoable = await saveUndo(api, journal.map((item) => buildEntry(item.plan, item.removedCards)));
        } catch {
          undoable = 0; // undo is a safety net, not a reason to fail the merge
        }
        close({ merged: result.merged, removed: result.removed, failed: result.failed.length, undoable });
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
        legendLine('warning', '~', t('dialog.legendChanged')),
        legendLine('warning', '≠', t('dialog.legendConflict')),
        legendLine('neutral', '✓', t('dialog.legendKept'))));

    const renderFieldPreview = (fieldPreview, donorById) => {
      const { field, labelKey, kept, added, changed, conflicts, previous = [] } = fieldPreview;
      const sources = [...new Set([...added, ...changed, ...conflicts]
        .map((entry) => donorById[entry.fromId] || entry.fromId))];

      return h(Stack, { key: field, gap: 1 },
        h(Row, { gap: 2, wrap: true },
          h(Text, { style: { fontWeight: '600', minWidth: '120px', whiteSpace: 'nowrap' } }, t(labelKey)),
          ...kept.map((value, i) => h(Badge, { key: `k${i}`, tone: 'neutral' }, value)),
          ...changed.map((entry, i) => h(Badge, { key: `h${i}`, tone: 'warning' }, `~ ${entry.value}`)),
          ...added.map((entry, i) => h(Badge, { key: `a${i}`, tone: 'success' }, `+ ${entry.value}`)),
          ...conflicts.map((entry, i) => h(Badge, { key: `c${i}`, tone: 'warning' }, `≠ ${entry.value}`))),
        previous.length > 0
          ? h(Text, { tone: 'muted', style: { fontSize: '11px' } },
            t('dialog.wasValue', { value: previous.join(', ') }))
          : null,
        sources.length > 0
          ? h(Text, { tone: 'muted', style: { fontSize: '11px' } }, t('dialog.addedFrom', { name: sources.join(', ') }))
          : null);
    };

    const renderNicknamePicker = (suggestions, donorById, signature) => {
      if (!suggestions.length) return null;
      const state = choicesBy[signature] ?? {};
      return h(Section, { title: t('dialog.nicknameTitle') },
        h(Text, { tone: 'muted', style: { fontSize: '12px' } }, t('dialog.nicknameHint')),
        ...suggestions.map((suggestion) => {
          const value = state.nicknames?.[suggestion.key] ?? 'nickname';
          return h(Field, { key: suggestion.key, label: t('dialog.nicknameLabel', {
            value: suggestion.value,
            name: donorById[suggestion.fromId] || suggestion.fromId,
          }) },
            h(Select, {
              value,
              options: [
                { value: 'nickname', label: t('dialog.nicknameOption') },
                { value: 'name', label: t('dialog.nameOption') },
                { value: 'drop', label: t('dialog.dropOption') },
              ],
              onChange: (next) => setChoicesBy((previous) => {
                const groupChoices = { ...(previous[signature] ?? {}) };
                const nicknames = { ...(groupChoices.nicknames ?? {}) };
                if (next === 'nickname') delete nicknames[suggestion.key];
                else nicknames[suggestion.key] = next;
                if (Object.keys(nicknames).length) groupChoices.nicknames = nicknames;
                else delete groupChoices.nicknames;
                // "Use as the name" reuses the existing name-conflict choice.
                if (next === 'name') groupChoices.name = suggestion.fromId;
                else if (groupChoices.name === suggestion.fromId) delete groupChoices.name;
                return { ...previous, [signature]: groupChoices };
              }),
            }));
        }));
    };

    const renderResolver = (conflicts, donorById, signature) => {
      if (!conflicts.length) return null;
      return h(Section, { title: t('dialog.resolveTitle') },
        h(Text, { tone: 'muted', style: { fontSize: '12px' } }, t('dialog.resolveHint')),
        ...conflicts.map(({ field, labelKey, kept, options }) => h(Field, { key: field, label: t(labelKey) },
          h(Select, {
            value: choicesBy[signature]?.[field] || 'keep',
            options: [
              { value: 'keep', label: t('dialog.keepValue', { value: kept.join(', ') }) },
              ...options.map((option) => ({
                value: option.fromId,
                label: t('dialog.useValue', {
                  value: option.value,
                  name: donorById[option.fromId] || option.fromId,
                }),
              })),
            ],
            onChange: (value) => setChoicesBy((previous) => {
              const groupChoices = { ...(previous[signature] ?? {}) };
              if (value === 'keep') delete groupChoices[field];
              else groupChoices[field] = value;
              return { ...previous, [signature]: groupChoices };
            }),
          }))));
    };

    return h(Stack, { gap: 4 },
      h(Text, { tone: 'muted' }, t('dialog.intro')),
      renderLegend(),
      ...groups.map((group) => {
        const signature = group.signature;
        const keepId = keepBy[signature] || planMerge(group).primary?.id || '';
        const choices = choicesBy[signature] ?? {};
        const basePlan = planMerge(group, keepId);
        const plan = planMerge(group, keepId, choices);
        const nameById = Object.fromEntries(group.members.map((m) => [m.id, contactName(m) || m.id]));
        const keptName = contactName(plan.primary) || plan.primary?.id || '';
        const detailFields = plan.primary ? previewFields(plan) : [];
        const detailCounts = previewCounts(detailFields);
        const fieldConflicts = basePlan.primary ? conflictFields(basePlan) : [];

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
                onChange: (value) => {
                  setKeepBy((previous) => ({ ...previous, [signature]: value }));
                  // Field choices refer to the previous kept contact's values.
                  setChoicesBy((previous) => ({ ...previous, [signature]: {} }));
                },
              })),
            // Member roster — full details so duplicates that share a name can be told apart.
            h(Section, { title: t('dialog.membersTitle') },
              ...group.members.map((member) => renderMember(member, keepId))),
            // Field-by-field conflict resolution: keep the current value or
            // take one from a duplicate before the preview is built.
            renderResolver(fieldConflicts, nameById, signature),
            // Different names: offer the donor names as nicknames so a merge
            // never loses the name the contact was saved under (#49).
            renderNicknamePicker(basePlan.primary ? basePlan.nameSuggestions : [], nameById, signature),
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
