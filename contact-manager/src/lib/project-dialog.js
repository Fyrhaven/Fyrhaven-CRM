// The project editor dialog: create a local project or change one. Projects
// live in this browser only (api.storage); the linked company and people are
// real contacts, chosen here and never modified by this dialog.
//
// The host passes api.ui.openDialog's `extraProps` as props — `{ projectEditor:
// { mode, project }, cards }` — plus `onResult(value)`. It resolves to
// `{ saved: 'created' | 'updated', project }` or null.

import {
  Checkbox, DialogButtons, Field, InfoBar, Input, Row, Section, Select,
  Stack, Text, Textarea,
} from '@plugin-host/ui';
import { contactName, emailEntries } from './contacts.js';
import { isCompany } from './profile.js';
import { PROJECT_STATUSES, emptyProject, newId, validateProject } from './projects.js';

export function makeProjectDialog(React, api) {
  const { createElement: h, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function ProjectDialog(props) {
    const editor = props.projectEditor ?? {};
    const mode = editor.mode === 'edit' ? 'edit' : 'create';
    const cards = Array.isArray(props.cards) ? props.cards : [];
    const companies = cards.filter((card) => isCompany(card));
    const people = cards.filter((card) => !isCompany(card));
    const [draft, setDraft] = useState(() => (editor.project
      ? { ...emptyProject(editor.project.id), ...editor.project }
      : emptyProject(newId())));
    const [errors, setErrors] = useState([]);

    const close = (value) => props.onResult?.(value);
    const set = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
    const togglePerson = (id, on) => setDraft((current) => ({
      ...current,
      contactIds: on
        ? [...new Set([...current.contactIds, id])]
        : current.contactIds.filter((entry) => entry !== id),
    }));
    const label = (card) => contactName(card) || emailEntries(card)[0]?.address || card.id;
    const has = (field) => errors.includes(field);

    const save = () => {
      const problems = validateProject(draft);
      setErrors(problems);
      if (problems.length) return;
      const project = {
        ...draft,
        name: draft.name.trim(),
        hourlyRate: draft.hourlyRate === '' ? null : draft.hourlyRate,
      };
      close({ saved: mode === 'create' ? 'created' : 'updated', project });
    };

    return h(Stack, { gap: 3 },
      h(InfoBar, { tone: 'neutral' }, t('projects.localNotice')),
      has('name') ? h(Text, { tone: 'danger' }, t('projects.error.name')) : null,
      h(Field, { label: t('projects.name') },
        h(Input, { value: draft.name, onChange: (event) => set('name', event.target.value) })),
      h(Row, { gap: 2, wrap: true },
        h(Field, { label: t('projects.status') },
          h(Select, {
            value: draft.status,
            onChange: (value) => set('status', value),
            options: PROJECT_STATUSES.map((status) => ({ value: status, label: t(`projects.status.${status}`) })),
          })),
        h(Field, { label: t('projects.currency') },
          h(Input, { value: draft.currency, onChange: (event) => set('currency', event.target.value) })),
        h(Field, {
          label: t('projects.hourlyRate'),
          hint: has('hourlyRate') ? t('projects.error.rate') : undefined,
        },
          h(Input, { value: draft.hourlyRate ?? '', onChange: (event) => set('hourlyRate', event.target.value) }))),
      h(Field, { label: t('projects.company') },
        h(Select, {
          value: draft.companyId,
          onChange: (value) => set('companyId', value),
          options: [
            { value: '', label: t('projects.noCompany') },
            ...companies.map((card) => ({ value: card.id, label: label(card) })),
          ],
        })),
      h(Section, { title: t('projects.people'), description: t('projects.peopleHint') },
        people.length
          ? h(Stack, { gap: 1 }, ...people.map((person) => h(Checkbox, {
            key: person.id,
            checked: draft.contactIds.includes(person.id),
            label: label(person),
            onChange: (on) => togglePerson(person.id, on),
          })))
          : h(Text, { tone: 'muted' }, t('projects.noPeople'))),
      h(Field, { label: t('projects.description') },
        h(Textarea, { value: draft.description, rows: 3, onChange: (event) => set('description', event.target.value) })),
      h(DialogButtons, {
        buttons: [
          { id: 'cancel', label: t('dialog.cancel'), variant: 'secondary' },
          { id: 'save', label: mode === 'create' ? t('projects.create') : t('projects.save'), variant: 'primary' },
        ],
        onClick: (id) => { if (id === 'save') save(); else close(null); },
      }));
  };
}
