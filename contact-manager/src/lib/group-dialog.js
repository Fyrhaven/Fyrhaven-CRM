// The group editor dialog: create or change a distribution list and choose its
// members. A group is a real JSContact card (`kind: 'group'`) written through
// api.contacts.create / update / remove — never a local record — so it is
// shared, searchable and exportable like a company.
//
// The host passes api.ui.openDialog's `extraProps` as props —
// `{ groupEditor: { mode, group }, cards, books, detectOptions }` — plus
// `onResult(value)`. It resolves to `{ saved: 'created' | 'updated', group }`,
// `{ deleted: true }` or null.

import {
  Alert, Badge, Button, Checkbox, DialogButtons, Field, InfoBar, Input, List, ListRow,
  SearchInput, Section, Stack, Text,
} from '@plugin-host/ui';
import { contactName, loadBooks } from './contacts.js';
import {
  duplicatesInGroup, emptyGroupDraft, groupCardFromDraft, groupDraftFromCard,
  groupMemberLabel, memberCandidates, validateGroupDraft,
} from './groups.js';

export function makeGroupDialog(React, api) {
  const { createElement: h, useEffect, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function GroupDialog(props) {
    const editor = props.groupEditor ?? {};
    const mode = editor.mode === 'edit' ? 'edit' : 'create';
    const group = editor.group ?? null;
    const cards = Array.isArray(props.cards) ? props.cards : [];
    const detectOptions = props.detectOptions ?? {};
    const knownBooks = Array.isArray(props.books) ? props.books : [];
    const [draft, setDraft] = useState(() => (group
      ? groupDraftFromCard(group, knownBooks)
      : { ...emptyGroupDraft(), bookIds: knownBooks.length ? [knownBooks[0].id] : [] }));
    const [books, setBooks] = useState(knownBooks);
    const [errors, setErrors] = useState([]);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState('');
    const [query, setQuery] = useState('');

    // The books are optional at open time, so fetch them the way the contact
    // editor does; a create preselects the first one, which is not a user edit.
    useEffect(() => {
      if (books.length) return undefined;
      let live = true;
      void loadBooks(api).then((list) => {
        if (!live) return;
        setBooks(list);
        if (mode === 'create' && list.length) {
          setDraft((current) => (current.bookIds.length ? current : { ...current, bookIds: [list[0].id] }));
        }
      }).catch(() => {});
      return () => { live = false; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const close = (value) => props.onResult?.(value);
    const set = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
    const hasError = (field) => errors.some((error) => error.field === field);
    const errorText = (field) => {
      const error = errors.find((entry) => entry.field === field);
      return error ? t(error.key) : undefined;
    };
    const toggle = (field, id, on) => setDraft((current) => ({
      ...current,
      [field]: on
        ? [...new Set([...current[field], id])]
        : current[field].filter((entry) => entry !== id),
    }));

    const byId = new Map(cards.map((card) => [card.id, card]));
    const chosen = draft.memberIds;
    const candidates = memberCandidates(cards, query, { exclude: chosen, limit: 20 });
    // Computed on the *draft*, so the warning follows the edit instead of
    // describing the card as it was opened.
    const duplicateGroups = duplicatesInGroup(groupCardFromDraft(draft), cards, detectOptions);
    const duplicateIds = new Set(duplicateGroups.flatMap((entry) => entry.members.map((member) => member.id)));

    const save = async () => {
      if (busy) return;
      const found = validateGroupDraft(draft, mode);
      setErrors(found);
      if (found.length) return;
      setBusy(true);
      setFailure('');
      const card = groupCardFromDraft(draft, mode);
      try {
        if (mode === 'create') await api.contacts.create(card);
        else await api.contacts.update(group.id, card);
        close({ saved: mode === 'create' ? 'created' : 'updated', group: card });
      } catch (err) {
        setFailure(String(err?.message ?? err));
        setBusy(false);
      }
    };

    const remove = async () => {
      if (busy || !group) return;
      const ok = await api.ui.confirm({
        title: t('groups.deleteTitle'),
        message: t('groups.deleteBody', { name: contactName(group) || draft.name }),
        confirmLabel: t('groups.delete'),
        cancelLabel: t('dialog.cancel'),
        danger: true,
      });
      if (!ok) return;
      setBusy(true);
      setFailure('');
      try {
        await api.contacts.remove(group.id);
        close({ deleted: true });
      } catch (err) {
        setFailure(String(err?.message ?? err));
        setBusy(false);
      }
    };

    const memberRow = (id, isChosen) => {
      const card = byId.get(id);
      return h(ListRow, {
        key: id,
        title: card ? groupMemberLabel(card, id) : id,
        meta: duplicateIds.has(id)
          ? [h(Badge, { key: 'duplicate', tone: 'warning' }, t('groups.duplicateBadge'))]
          : [],
        actions: h(Button, {
          size: 'sm',
          variant: 'secondary',
          onClick: () => toggle('memberIds', id, !isChosen),
        }, t(isChosen ? 'groups.remove' : 'groups.add')),
      });
    };

    return h(Stack, { gap: 3 },
      failure ? h(Alert, { tone: 'danger' }, t('groups.failed', { reason: failure })) : null,
      errors.length
        ? h(Alert, { tone: 'danger' },
            h(Stack, { gap: 1 }, ...errors.map((error) => h(Text, { key: error.field }, t(error.key)))))
        : null,
      h(Text, { tone: 'muted' }, t(mode === 'create' ? 'groups.introCreate' : 'groups.introEdit')),
      h(Field, { label: t('groups.name'), error: hasError('name') ? errorText('name') : undefined },
        h(Input, {
          value: draft.name,
          placeholder: t('groups.namePlaceholder'),
          onChange: (event) => set('name', event.target.value),
        })),
      h(Section, { title: t('groups.members'), description: t('groups.membersHint') },
        h(Field, { label: t('groups.searchMembers') },
          h(SearchInput, {
            value: query,
            label: t('groups.searchMembers'),
            placeholder: t('groups.searchPlaceholder'),
            onChange: setQuery,
          })),
        h(Text, { tone: 'muted' }, t('groups.chosenCount', { count: chosen.length })),
        chosen.length
          ? h(List, { label: t('groups.chosen') }, ...chosen.map((id) => memberRow(id, true)))
          : h(Text, { tone: 'muted' }, t('groups.noMembers')),
        candidates.length
          ? h(List, { label: t('groups.candidates') }, ...candidates.map((card) => memberRow(card.id, false)))
          : h(Text, { tone: 'muted' }, t('groups.noCandidates')),
        duplicateGroups.length
          ? h(InfoBar, { tone: 'warning', title: t('groups.duplicates', { count: duplicateGroups.length }) },
              h(Text, { tone: 'muted' }, t('groups.duplicatesHint')))
          : null),
      books.length
        ? h(Section, { title: t('editor.booksSection'), description: t('editor.booksHint') },
            ...books.map((book) => h(Checkbox, {
              key: book.id,
              checked: draft.bookIds.includes(book.id),
              label: book.name,
              onChange: (on) => toggle('bookIds', book.id, on),
            })))
        : null,
      h(DialogButtons, {
        buttons: [
          ...(mode === 'edit' && group ? [{ id: 'delete', label: t('groups.delete'), variant: 'secondary' }] : []),
          { id: 'cancel', label: t('dialog.cancel'), variant: 'secondary' },
          { id: 'save', label: t(mode === 'create' ? 'groups.create' : 'groups.save'), variant: 'primary' },
        ],
        onClick: (id) => {
          if (id === 'save') void save();
          else if (id === 'delete') void remove();
          else close(null);
        },
      }));
  };
}

