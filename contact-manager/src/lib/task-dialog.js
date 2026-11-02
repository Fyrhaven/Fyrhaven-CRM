// The follow-up task editor (#36): a title, a due date, a priority and notes for
// one contact. It returns a **draft** and writes nothing — open-task.js creates
// the task, the same funnel as the other editors (README §9.2).

import { DialogButtons, Field, Input, Row, Select, Stack, Text, Textarea } from '@plugin-host/ui';
import { contactName, primaryEmail } from './contacts.js';
import { PRIORITIES, followUpDescription, followUpDraft, isValidDraft } from './tasks.js';

export function makeTaskDialog(React, api) {
  const { createElement: h, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function TaskDialog(props) {
    const contact = props.contact ?? null;
    const name = contact ? (contactName(contact) || primaryEmail(contact) || '') : '';
    // The email goes in the description, so the task is findable from the contact
    // even when the name is one short word `tasksForContact` ignores.
    const contactLine = contact ? (primaryEmail(contact) || name) : '';

    const [title, setTitle] = useState(() => (
      name ? t('tasks.followUpTitle', { name }) : t('tasks.defaultTitle')
    ));
    const [due, setDue] = useState('');
    const [priority, setPriority] = useState('normal');
    const [notes, setNotes] = useState('');
    const [touched, setTouched] = useState(false);

    const close = (value) => props.onResult?.(value);

    // Priority is not a field the host task has, so it rides at the end of the
    // title, where every task list shows it.
    const composeTitle = () => {
      const base = title.trim();
      const suffix = priority === 'normal' ? '' : ` \u00b7 ${t(`tasks.priority.${priority}`)}`;
      return `${base}${suffix}`;
    };

    const draft = followUpDraft({
      title: composeTitle(),
      description: followUpDescription(contactLine, notes),
      due,
    });
    const valid = isValidDraft(draft);

    // The save button stays enabled: a click that changes nothing must say *why*
    // (the error appears), not sit there greyed out with no explanation.
    const save = () => {
      setTouched(true);
      if (!valid) return;
      close({ draft });
    };

    return h(Stack, { gap: 3 },
      h(Text, { tone: 'muted' }, t('tasks.intro', { name: name || t('tasks.noContact') })),

      h(Field, {
        label: t('tasks.titleLabel'),
        error: touched && !valid ? t('tasks.titleRequired') : undefined,
      }, h(Input, { value: title, onChange: (event) => setTitle(event.target.value) })),

      h(Row, { gap: 3, wrap: true },
        h(Field, { label: t('tasks.dueLabel') },
          h(Input, { type: 'date', value: due, onChange: (event) => setDue(event.target.value) })),
        h(Field, { label: t('tasks.priorityLabel') },
          h(Select, {
            value: priority,
            options: PRIORITIES.map((value) => ({ value, label: t(`tasks.priority.${value}`) })),
            onChange: (value) => setPriority(value),
          }))),

      h(Field, { label: t('tasks.notesLabel') },
        h(Textarea, { value: notes, rows: 3, onChange: (event) => setNotes(event.target.value) })),

      h(DialogButtons, {
        buttons: [
          { id: 'cancel', label: t('dialog.cancel'), variant: 'secondary' },
          { id: 'save', label: t('tasks.save'), variant: 'primary' },
        ],
        onClick: (id) => { if (id === 'save') save(); else close(null); },
      }));
  };
}
