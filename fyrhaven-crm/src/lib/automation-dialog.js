// The automation rule builder (#33): the list of rules, a form for one rule,
// and a dry run that shows what it would change before anything is saved.
//
// A rule is written the moment it is saved, through `saveRule`. The dry run
// calls the same `previewRule` the engine uses, so the preview cannot describe
// a different change from the one a run would make.
//
// The host passes api.ui.openDialog's `extraProps` as props —
// `{ automationEditor: { rules, cards, books } }` — plus `onResult(value)`,
// which resolves to `{ saved, removed }` (counts) or null.

import {
  Badge, Button, Checkbox, DialogButtons, Field, InfoBar, Input, List, ListRow, Select, Stack, Text,
} from '@plugin-host/ui';
import { contactName, isGroupCard, text } from './contacts.js';
import {
  DEFAULT_PRIORITY, MAX_AUTOMATION_RULES, TRIGGERS, newRuleId, previewRule, removeRule, saveRule,
} from './automation.js';

/** A blank form, geared for "add a rule". */
export function emptyDraft() {
  return {
    id: newRuleId(), name: '', enabled: true, priority: DEFAULT_PRIORITY, trigger: 'create',
    condition: '', addTag: '', removeTag: '', groupId: '', proposeMerge: false,
  };
}

/** The form for an existing rule. */
export function ruleToDraft(rule) {
  const draft = { ...emptyDraft(), ...rule };
  for (const action of rule?.actions ?? []) {
    if (action.type === 'addTag') draft.addTag = action.value;
    else if (action.type === 'removeTag') draft.removeTag = action.value;
    else if (action.type === 'addToGroup') draft.groupId = action.value;
    else if (action.type === 'proposeMerge') draft.proposeMerge = true;
  }
  return draft;
}

/** The rule a form describes — the shape `saveRule` and `previewRule` take. */
export function draftToRule(draft) {
  const actions = [];
  if (text(draft?.addTag)) actions.push({ type: 'addTag', value: draft.addTag });
  if (text(draft?.removeTag)) actions.push({ type: 'removeTag', value: draft.removeTag });
  if (text(draft?.groupId)) actions.push({ type: 'addToGroup', value: draft.groupId });
  if (draft?.proposeMerge) actions.push({ type: 'proposeMerge' });
  return {
    id: draft?.id, name: draft?.name, enabled: draft?.enabled, priority: draft?.priority,
    trigger: draft?.trigger, condition: draft?.condition, actions,
  };
}

/** A one-line summary of what a rule does, for the list. */
export function actionSummary(t, rule) {
  return (rule?.actions ?? []).map((action) => (action.value
    ? `${t(`automation.action.${action.type}`)}: ${action.value}`
    : t(`automation.action.${action.type}`))).join(' · ');
}

export function makeAutomationDialog(React, api) {
  const { createElement: h, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function AutomationDialog(props) {
    const editor = props.automationEditor ?? {};
    const cards = Array.isArray(editor.cards) ? editor.cards : [];
    const books = editor.books;
    const [rules, setRules] = useState(() => (Array.isArray(editor.rules) ? editor.rules : []));
    const [draft, setDraft] = useState(() => emptyDraft());
    const [preview, setPreview] = useState(null);
    const [counts, setCounts] = useState({ saved: 0, removed: 0 });
    const [failure, setFailure] = useState('');
    const [busy, setBusy] = useState(false);

    const groups = cards.filter(isGroupCard);
    const set = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
    const close = (value) => props.onResult?.(value);

    const save = async () => {
      setBusy(true);
      setFailure('');
      try {
        setRules(await saveRule(api, draftToRule(draft)));
        setCounts((current) => ({ ...current, saved: current.saved + 1 }));
        setDraft(emptyDraft());
        setPreview(null);
      } catch (err) {
        setFailure(String(err?.message ?? err));
      } finally {
        setBusy(false);
      }
    };

    const drop = async (id) => {
      setBusy(true);
      try {
        setRules(await removeRule(api, id));
        setCounts((current) => ({ ...current, removed: current.removed + 1 }));
      } catch (err) {
        setFailure(String(err?.message ?? err));
      } finally {
        setBusy(false);
      }
    };

    const test = () => setPreview(previewRule(draftToRule(draft), cards, { books }));
    const edit = (rule) => { setDraft(ruleToDraft(rule)); setPreview(null); };
    const toggle = async (rule, on) => setRules(await saveRule(api, { ...rule, enabled: on }));

    const previewBox = () => {
      if (!preview) return null;
      if (preview.errors.length) return h(InfoBar, { tone: 'warning' }, t('automation.previewErrors'));
      return h(InfoBar, {
        tone: preview.count ? 'neutral' : 'warning',
        title: t('automation.previewCount', { count: preview.count }),
      },
      preview.changes.length
        ? h(List, { label: t('automation.previewTitle') }, ...preview.changes.map((change) => h(ListRow, {
            key: change.id,
            title: change.name,
            subtitle: change.plan.keywords
              ? `${t('automation.wouldTag')}: ${Object.keys(change.plan.keywords).join(', ') || t('automation.noTags')}`
              : t('automation.noChange'),
            meta: change.plan.proposeMerge
              ? [h(Badge, { key: 'm', tone: 'neutral' }, t('automation.action.proposeMerge'))]
              : [],
          })))
        : h(Text, { tone: 'muted' }, t('automation.previewNone')));
    };

    return h(Stack, { gap: 3 },
      h(Text, { tone: 'muted' }, t('automation.hostNote')),
      failure ? h(Text, { tone: 'danger' }, failure) : null,
      rules.length
        ? h(List, { label: t('automation.listTitle') }, ...rules.map((rule) => h(ListRow, {
            key: rule.id,
            title: rule.name || rule.id,
            subtitle: `${t(`automation.trigger.${rule.trigger}`)} · ${rule.condition || t('automation.always')} · ${actionSummary(t, rule)}`,
            meta: [
              h(Badge, { key: 'p', tone: 'neutral' }, t('automation.priority', { value: rule.priority })),
              ...(rule.enabled ? [] : [h(Badge, { key: 'off', tone: 'warning' }, t('automation.disabled'))]),
            ],
            actions: h('div', { style: { display: 'flex', gap: '0.25rem', alignItems: 'center' } },
              h(Checkbox, {
                key: 'on', checked: rule.enabled, label: t('automation.enabled'),
                onChange: (on) => void toggle(rule, on),
              }),
              h(Button, { key: 'edit', size: 'sm', variant: 'secondary', onClick: () => edit(rule) }, t('automation.edit')),
              h(Button, { key: 'rm', size: 'sm', variant: 'secondary', disabled: busy, onClick: () => void drop(rule.id) }, t('automation.remove'))),
          })))
        : h(Text, { tone: 'muted' }, t('automation.empty')),
      h(InfoBar, { tone: 'neutral', title: t('automation.formTitle') },
        h(Text, { tone: 'muted' }, t('automation.formHint'))),
      h(Field, { label: t('automation.name') },
        h(Input, { value: draft.name, onChange: (event) => set('name', event.target.value) })),
      h(Field, { label: t('automation.trigger'), hint: t('automation.triggerHint') },
        h(Select, {
          value: draft.trigger,
          onChange: (value) => set('trigger', value),
          options: TRIGGERS.map((trigger) => ({ value: trigger, label: t(`automation.trigger.${trigger}`) })),
        })),
      h(Field, { label: t('automation.priority'), hint: t('automation.priorityHint') },
        h(Input, { type: 'number', value: String(draft.priority), onChange: (event) => set('priority', Number(event.target.value)) })),
      h(Field, { label: t('automation.condition'), hint: t('automation.conditionHint') },
        h(Input, { value: draft.condition, onChange: (event) => set('condition', event.target.value) })),
      h(Field, { label: t('automation.action.addTag') },
        h(Input, { value: draft.addTag, onChange: (event) => set('addTag', event.target.value) })),
      h(Field, { label: t('automation.action.removeTag') },
        h(Input, { value: draft.removeTag, onChange: (event) => set('removeTag', event.target.value) })),
      groups.length
        ? h(Field, { label: t('automation.action.addToGroup') },
            h(Select, {
              value: draft.groupId,
              onChange: (value) => set('groupId', value),
              options: [{ value: '', label: t('automation.noGroup') },
                ...groups.map((group) => ({ value: group.id, label: contactName(group) || group.id }))],
            }))
        : null,
      h(Checkbox, {
        checked: draft.proposeMerge,
        label: t('automation.action.proposeMerge'),
        onChange: (on) => set('proposeMerge', on),
      }),
      previewBox(),
      h(DialogButtons, {
        buttons: [
          { id: 'test', label: t('automation.test'), variant: 'secondary', disabled: busy },
          { id: 'save', label: t('automation.save'), variant: 'primary', disabled: busy },
          { id: 'close', label: t('dialog.cancel'), variant: 'secondary' },
        ],
        onClick: (id) => {
          if (id === 'test') test();
          else if (id === 'save') void save();
          else close(counts);
        },
      }),
      h(Text, { tone: 'muted' }, t('automation.limit', { max: MAX_AUTOMATION_RULES })));
  };
}
