// The contact editor dialog: create a contact, or change every field the
// plugin manages. It is the plugin's own form — Bulwark has no contact form
// surface — and writes through api.contacts.create / update / remove only
// when the user saves.
//
// The host passes api.ui.openDialog's `extraProps` as props — `{ mode,
// contact, books }` — plus `onResult(value)`. It resolves to
// `{ saved: 'created' | 'updated', contact }`, `{ deleted: true }` or null.

import {
  Alert, Button, Checkbox, DialogButtons, Field, Input, Row, Section,
  Stack, Text, Textarea,
} from '@plugin-host/ui';
import { loadBooks, text } from './contacts.js';
import {
  cardFromDraft, companyCardFromDraft, companyDraftFromCard, draftFromCard, emptyCompanyDraft,
  emptyDraft, isDirty, validateCompanyDraft, validateDraft,
} from './editor.js';

export function makeEditorDialog(React, api) {
  const { createElement: h, useEffect, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function EditorDialog(props) {
    const mode = props.mode === 'edit' ? 'edit' : 'create';
    const company = props.company === true;
    const contact = props.contact ?? null;
    const [initial, setInitial] = useState(() => {
      const knownBooks = Array.isArray(props.books) ? props.books : [];
      if (contact) {
        return company ? companyDraftFromCard(contact, knownBooks) : draftFromCard(contact, knownBooks);
      }
      // A new record starts in the first address book the dialog already knows.
      const template = company ? emptyCompanyDraft() : emptyDraft();
      return { ...template, bookIds: knownBooks.length ? [knownBooks[0].id] : [] };
    });
    const [draft, setDraft] = useState(initial);
    const [books, setBooks] = useState(Array.isArray(props.books) ? props.books : []);
    const [errors, setErrors] = useState([]);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState('');

    useEffect(() => {
      if (books.length) return;
      let live = true;
      void loadBooks(api).then((list) => {
        if (!live) return;
        setBooks(list);
        if (mode === 'create' && list.length) {
          // Preselecting the first book is not a change the user made.
          setDraft((current) => (current.bookIds.length ? current : { ...current, bookIds: [list[0].id] }));
          setInitial((current) => (current.bookIds.length ? current : { ...current, bookIds: [list[0].id] }));
        }
      }).catch(() => {});
      return () => { live = false; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const close = (value) => props.onResult?.(value);
    const set = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
    const setAddress = (part, value) => setDraft((current) => ({
      ...current,
      address: { ...current.address, [part]: value },
    }));
    const updateEntry = (field, index, part, value) => setDraft((current) => ({
      ...current,
      [field]: current[field].map((entry, i) => (i === index ? { ...entry, [part]: value } : entry)),
    }));
    const addEntry = (field) => setDraft((current) => ({
      ...current,
      [field]: [...current[field], field === 'emails' ? { address: '', pref: false } : { number: '', pref: false }],
    }));
    const removeEntry = (field, index) => setDraft((current) => ({
      ...current,
      [field]: current[field].filter((_, i) => i !== index),
    }));
    const toggleBook = (id, on) => setDraft((current) => ({
      ...current,
      bookIds: on ? [...new Set([...current.bookIds, id])] : current.bookIds.filter((bookId) => bookId !== id),
    }));

    const cancel = async () => {
      if (busy) return;
      if (isDirty(draft, initial)) {
        const ok = await api.ui.confirm({
          title: t('editor.discardTitle'),
          message: t('editor.discardBody'),
          confirmLabel: t('editor.discard'),
          cancelLabel: t('dialog.cancel'),
          danger: true,
        });
        if (!ok) return;
      }
      close(null);
    };

    const save = async () => {
      if (busy) return;
      const found = (company ? validateCompanyDraft : validateDraft)(draft, mode);
      setErrors(found);
      if (found.length) return;
      setBusy(true);
      setFailure('');
      const card = (company ? companyCardFromDraft : cardFromDraft)(draft, mode);
      try {
        if (mode === 'create') await api.contacts.create(card);
        else await api.contacts.update(contact.id, card);
        close({ saved: mode === 'create' ? 'created' : 'updated', contact: card });
      } catch (err) {
        setFailure(String(err?.message ?? err));
        setBusy(false);
      }
    };

    const remove = async () => {
      if (busy || !contact) return;
      const ok = await api.ui.confirm({
        title: t('editor.deleteTitle'),
        message: t('editor.deleteBody', { name: contactLabel(contact, t) }),
        confirmLabel: t('editor.delete'),
        cancelLabel: t('dialog.cancel'),
        danger: true,
      });
      if (!ok) return;
      setBusy(true);
      try {
        await api.contacts.remove(contact.id);
        close({ deleted: true });
      } catch (err) {
        setFailure(String(err?.message ?? err));
        setBusy(false);
      }
    };

    const hasError = (field) => errors.some((error) => error.field === field);
    const errorText = (field) => {
      const error = errors.find((entry) => entry.field === field);
      return error ? t(error.key) : undefined;
    };

    if (company) {
      return h(Stack, { gap: 4 },
        failure ? h(Alert, { tone: 'danger' }, t('editor.failed', { reason: failure })) : null,
        errors.length
          ? h(Alert, { tone: 'danger' },
              h(Stack, { gap: 1 }, ...errors.map((error) => h(Text, { key: error.field }, t(error.key)))))
          : null,
        h(Text, { tone: 'muted' }, mode === 'create' ? t('editor.introCompanyCreate') : t('editor.introCompanyEdit')),
        h(Field, { label: t('editor.companyName'), error: hasError('name') ? errorText('name') : undefined },
          h(Input, {
            value: draft.name,
            placeholder: t('editor.companyNamePlaceholder'),
            onChange: (event) => set('name', event.target.value),
          })),
        h(Field, { label: t('editor.domains'), hint: t('editor.domainsHint') },
          h(Input, {
            value: draft.domains,
            placeholder: 'acme.com, acme.de',
            onChange: (event) => set('domains', event.target.value),
          })),
        h(Section, { title: t('editor.addressSection') },
          h(Field, { label: t('editor.street') },
            h(Input, { value: draft.address.street, onChange: (event) => setAddress('street', event.target.value) })),
          h(Row, { gap: 2, wrap: true },
            h(Field, { label: t('editor.postcode') },
              h(Input, { value: draft.address.postcode, onChange: (event) => setAddress('postcode', event.target.value) })),
            h(Field, { label: t('editor.locality') },
              h(Input, { value: draft.address.locality, onChange: (event) => setAddress('locality', event.target.value) })),
            h(Field, { label: t('editor.region') },
              h(Input, { value: draft.address.region, onChange: (event) => setAddress('region', event.target.value) })),
            h(Field, { label: t('editor.country') },
              h(Input, { value: draft.address.country, onChange: (event) => setAddress('country', event.target.value) })))),
        h(Section, { title: t('editor.notesSection') },
          h(Field, { label: t('editor.notes') },
            h(Textarea, { value: draft.notes, rows: 3, onChange: (event) => set('notes', event.target.value) })),
          h(Field, { label: t('editor.tags'), hint: t('editor.tagsHint') },
            h(Input, { value: draft.tags, onChange: (event) => set('tags', event.target.value) }))),
        h(Section, { title: t('editor.booksSection'), description: t('editor.booksHint') },
          books.length
            ? h(Stack, { gap: 1 }, ...books.map((book) => h(Checkbox, {
              key: book.id,
              checked: draft.bookIds.includes(book.id),
              label: book.name || book.id,
              onChange: (on) => toggleBook(book.id, on),
            })))
            : h(Text, { tone: 'muted' }, t('editor.noBooks'))),
        h(DialogButtons, {
          buttons: [
            { id: 'cancel', label: t('dialog.cancel'), variant: 'secondary', disabled: busy },
            ...(mode === 'edit' ? [{ id: 'delete', label: t('editor.delete'), variant: 'danger', disabled: busy }] : []),
            {
              id: 'save',
              label: mode === 'create' ? t('editor.createCompany') : t('editor.save'),
              variant: 'primary',
              busy,
              disabled: busy,
            },
          ],
          onClick: (id) => {
            if (id === 'save') void save();
            else if (id === 'delete') void remove();
            else void cancel();
          },
        }));
    }

    return h(Stack, { gap: 4 },
      failure ? h(Alert, { tone: 'danger' }, t('editor.failed', { reason: failure })) : null,
      errors.length
        ? h(Alert, { tone: 'danger' },
            h(Stack, { gap: 1 }, ...errors.map((error) => h(Text, { key: error.field }, t(error.key)))))
        : null,
      h(Text, { tone: 'muted' }, mode === 'create' ? t('editor.introCreate') : t('editor.introEdit')),

      h(Section, { title: t('editor.nameSection') },
        h(Row, { gap: 2, wrap: true },
          h(Field, { label: t('editor.given'), error: hasError('name') ? errorText('name') : undefined },
            h(Input, {
              value: draft.given,
              placeholder: t('editor.givenPlaceholder'),
              onChange: (event) => set('given', event.target.value),
            })),
          h(Field, { label: t('editor.surname') },
            h(Input, {
              value: draft.surname,
              placeholder: t('editor.surnamePlaceholder'),
              onChange: (event) => set('surname', event.target.value),
            }))),
        h(Field, { label: t('editor.nickname'), hint: t('editor.nicknameHint') },
          h(Input, { value: draft.nickname, onChange: (event) => set('nickname', event.target.value) }))),

      h(Section, { title: t('editor.emailsSection'), description: t('editor.preferredHint') },
        ...draft.emails.map((entry, index) => h(Row, { key: `email-${index}`, gap: 2, wrap: true },
          h(Field, {
            label: t('editor.email', { count: index + 1 }),
            error: index === 0 && hasError('emails') ? errorText('emails') : undefined,
          },
          h(Input, {
            type: 'email',
            value: entry.address,
            onChange: (event) => updateEntry('emails', index, 'address', event.target.value),
          })),
          h(Checkbox, {
            checked: entry.pref,
            label: t('editor.preferred'),
            onChange: (on) => updateEntry('emails', index, 'pref', on),
          }),
          h(Button, { size: 'sm', variant: 'secondary', onClick: () => removeEntry('emails', index) },
            t('editor.remove')))),
        h(Button, { size: 'sm', variant: 'secondary', onClick: () => addEntry('emails') }, t('editor.addEmail'))),

      h(Section, { title: t('editor.phonesSection'), description: t('editor.preferredHint') },
        ...draft.phones.map((entry, index) => h(Row, { key: `phone-${index}`, gap: 2, wrap: true },
          h(Field, {
            label: t('editor.phone', { count: index + 1 }),
            error: index === 0 && hasError('phones') ? errorText('phones') : undefined,
          },
          h(Input, {
            type: 'tel',
            value: entry.number,
            onChange: (event) => updateEntry('phones', index, 'number', event.target.value),
          })),
          h(Checkbox, {
            checked: entry.pref,
            label: t('editor.preferred'),
            onChange: (on) => updateEntry('phones', index, 'pref', on),
          }),
          h(Button, { size: 'sm', variant: 'secondary', onClick: () => removeEntry('phones', index) },
            t('editor.remove')))),
        h(Button, { size: 'sm', variant: 'secondary', onClick: () => addEntry('phones') }, t('editor.addPhone'))),

      h(Section, { title: t('editor.addressSection') },
        h(Field, { label: t('editor.street') },
          h(Input, { value: draft.address.street, onChange: (event) => setAddress('street', event.target.value) })),
        h(Row, { gap: 2, wrap: true },
          h(Field, { label: t('editor.postcode') },
            h(Input, { value: draft.address.postcode, onChange: (event) => setAddress('postcode', event.target.value) })),
          h(Field, { label: t('editor.locality') },
            h(Input, { value: draft.address.locality, onChange: (event) => setAddress('locality', event.target.value) })),
          h(Field, { label: t('editor.region') },
            h(Input, { value: draft.address.region, onChange: (event) => setAddress('region', event.target.value) })),
          h(Field, { label: t('editor.country') },
            h(Input, { value: draft.address.country, onChange: (event) => setAddress('country', event.target.value) })))),

      h(Section, { title: t('editor.workSection') },
        h(Field, { label: t('editor.organization') },
          h(Input, { value: draft.organization, onChange: (event) => set('organization', event.target.value) })),
        h(Field, { label: t('editor.title') },
          h(Input, { value: draft.title, onChange: (event) => set('title', event.target.value) }))),

      h(Section, { title: t('editor.notesSection') },
        h(Field, { label: t('editor.notes') },
          h(Textarea, { value: draft.notes, rows: 3, onChange: (event) => set('notes', event.target.value) })),
        h(Field, { label: t('editor.tags'), hint: t('editor.tagsHint') },
          h(Input, { value: draft.tags, onChange: (event) => set('tags', event.target.value) }))),

      h(Section, { title: t('editor.booksSection'), description: t('editor.booksHint') },
        books.length
          ? h(Stack, { gap: 1 }, ...books.map((book) => h(Checkbox, {
            key: book.id,
            checked: draft.bookIds.includes(book.id),
            label: book.name || book.id,
            onChange: (on) => toggleBook(book.id, on),
          })))
          : h(Text, { tone: 'muted' }, t('editor.noBooks'))),

      h(DialogButtons, {
        buttons: [
          { id: 'cancel', label: t('dialog.cancel'), variant: 'secondary', disabled: busy },
          ...(mode === 'edit' ? [{ id: 'delete', label: t('editor.delete'), variant: 'danger', disabled: busy }] : []),
          {
            id: 'save',
            label: mode === 'create' ? t('editor.create') : t('editor.save'),
            variant: 'primary',
            busy,
            disabled: busy,
          },
        ],
        onClick: (id) => {
          if (id === 'save') void save();
          else if (id === 'delete') void remove();
          else void cancel();
        },
      }));
  };
}

/** The label the delete confirmation uses: the contact's name or email. */
function contactLabel(contact, t) {
  const components = Array.isArray(contact?.name?.components) ? contact.name.components : [];
  const fromParts = components.map((part) => text(part?.value)).filter(Boolean).join(' ');
  const email = text(Object.values(contact?.emails ?? {})[0]?.address);
  return fromParts || text(contact?.name?.full) || email || contact?.id || t('editor.thisContact');
}
