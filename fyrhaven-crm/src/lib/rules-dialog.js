// The rules dialog: choose the normalisation rules, add your own, and see the
// exact edits before any of them is written.
//
// The host passes api.ui.openDialog's `extraProps` as props —
// `{ rulesEditor: { cards, rules, region } }` — plus `onResult(value)`, which
// resolves to `{ rules, plan }` or null when cancelled. The rules are stored
// here (the user chose them); the plan is applied by the caller through
// src/lib/normalise.js, so a rules batch is undone by the same button as a
// cleanup.

import {
  Badge, Button, Checkbox, DialogButtons, Field, InfoBar, Input, List, ListRow, Row, Section,
  Select, Stack, Text,
} from '@plugin-host/ui';
import { PREVIEW_AREA } from './layout.js';
import {
  BUILTIN_RULES, PREVIEW_CAP, USER_FIELDS, newRuleId, normalizeRules, orderedRules, planRules,
  ruleCounts, writeRules,
} from './rules.js';

/** The i18n key for a built-in rule's label. */
const LABEL = {
  'name.space': 'nameSpace',
  'name.case': 'nameCase',
  'org.space': 'orgSpace',
  'org.case': 'orgCase',
  'org.suffix': 'orgSuffix',
  'phone.e164': 'phoneE164',
  'email.case': 'emailCase',
};
const labelKey = (id) => `rules.builtin.${LABEL[id] ?? id}`;

export function makeRulesDialog(React, api) {
  const { createElement: h, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function RulesDialog(props) {
    const setup = props.rulesEditor ?? {};
    const cards = Array.isArray(setup.cards) ? setup.cards : [];
    const region = setup.region ?? '';
    const [rules, setRules] = useState(() => normalizeRules(setup.rules));
    const [draft, setDraft] = useState(() => ({ field: 'organization', from: '', to: '' }));
    const [busy, setBusy] = useState(false);

    const close = (value) => props.onResult?.(value);
    const ordered = orderedRules(rules);
    const plan = planRules(cards, ordered, { region });
    const counts = ruleCounts(plan);

    const isOn = (id) => rules.some((rule) => rule.builtin && rule.id === id);
    const toggleBuiltin = (id, on) => setRules((current) => {
      const without = current.filter((rule) => rule.id !== id);
      if (!on) return without;
      const meta = BUILTIN_RULES.find((rule) => rule.id === id);
      return [...without, { id, field: meta.field, builtin: true }];
    });
    const removeRule = (id) => setRules((current) => current.filter((rule) => rule.id !== id));
    const addRule = () => {
      if (!draft.from.trim()) return;
      setRules((current) => [...current, {
        id: newRuleId(), field: draft.field, from: draft.from, to: draft.to,
      }]);
      setDraft({ field: draft.field, from: '', to: '' });
    };

    const apply = async () => {
      if (busy) return;
      setBusy(true);
      try {
        const stored = await writeRules(api, rules);
        close({ rules: stored, plan });
      } finally {
        setBusy(false);
      }
    };

    const own = ordered.filter((rule) => !rule.builtin);

    return h(Stack, { gap: 3 },
      h(InfoBar, { tone: 'neutral' }, t('rules.notice', { count: cards.length })),
      h(Section, { title: t('rules.builtinTitle'), description: t('rules.builtinHint') },
        ...BUILTIN_RULES.map((rule) => h(Checkbox, {
          key: rule.id,
          checked: isOn(rule.id),
          label: t(labelKey(rule.id)),
          hint: t(`${labelKey(rule.id)}Hint`),
          onChange: (on) => toggleBuiltin(rule.id, on),
        }))),
      h(Section, { title: t('rules.ownTitle'), description: t('rules.ownHint') },
        own.length
          ? h(List, { label: t('rules.ownTitle') }, ...own.map((rule) => h(ListRow, {
              key: rule.id,
              title: t('rules.ruleLine', {
                field: t(`rules.field.${rule.field}`),
                from: rule.from,
                to: rule.to || t('rules.toNothing'),
              }),
              actions: h(Button, {
                size: 'sm',
                variant: 'secondary',
                onClick: () => removeRule(rule.id),
              }, t('rules.remove')),
            })))
          : h(Text, { tone: 'muted' }, t('rules.ownEmpty')),
        h(Row, { gap: 2, wrap: true },
          h(Field, { label: t('rules.field') },
            h(Select, {
              value: draft.field,
              onChange: (value) => setDraft((current) => ({ ...current, field: value })),
              options: USER_FIELDS.map((field) => ({ value: field, label: t(`rules.field.${field}`) })),
            })),
          h(Field, { label: t('rules.find') },
            h(Input, {
              value: draft.from,
              onChange: (event) => setDraft((current) => ({ ...current, from: event.target.value })),
            })),
          h(Field, { label: t('rules.replace') },
            h(Input, {
              value: draft.to,
              onChange: (event) => setDraft((current) => ({ ...current, to: event.target.value })),
            })),
          h(Button, {
            variant: 'secondary',
            disabled: !draft.from.trim(),
            onClick: addRule,
          }, t('rules.add'))),
        h(Text, { tone: 'muted' }, t('rules.orderHint'))),
      plan.length
        ? h(Section, { title: t('rules.previewTitle'), description: t('rules.summary', counts) },
            h('div', { 'data-pane': 'rules-list', style: PREVIEW_AREA },
              ...plan.slice(0, PREVIEW_CAP).map((item) => h(Stack, { key: item.id, gap: 1 },
                h(Text, null, item.name),
                ...item.changes.map((change) => h(Row, {
                  key: `${item.id}-${change.field}-${change.from}`,
                  gap: 2,
                  wrap: true,
                },
                h(Badge, { tone: 'neutral' }, t(`rules.field.${change.field}`)),
                h(Text, { tone: 'muted' }, change.from),
                h(Text, null, '→'),
                h(Text, null, change.to)))))),
            plan.length > PREVIEW_CAP
              ? h(Text, { tone: 'muted' }, t('rules.more', { rest: plan.length - PREVIEW_CAP }))
              : null)
        : h(InfoBar, { tone: 'success' }, t('rules.nothing', { count: cards.length })),
      h(DialogButtons, {
        buttons: [
          { id: 'cancel', label: t('dialog.cancel'), variant: 'secondary' },
          { id: 'apply', label: t('rules.apply'), variant: 'primary', disabled: !plan.length, busy },
        ],
        onClick: (id) => { if (id === 'apply') void apply(); else close(null); },
      }));
  };
}

