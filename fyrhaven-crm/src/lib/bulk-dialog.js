// The bulk editor for a hand-picked selection: tags and address books.
//
// The host passes api.ui.openDialog's `extraProps` as props — `{ bulkEditor:
// { cards, books } }` — plus `onResult(value)`, which resolves to
// `{ tags: { add, remove }, books: { add, remove } }` or null when cancelled.
//
// It only collects *what* to change. `src/lib/bulk.js` does the writing, so the
// map-replacement rules (a complete keyword map, never leaving a contact in no
// book at all) live in exactly one place.

import {
  Checkbox, DialogButtons, Field, InfoBar, Input, Section, Select, Stack, Text,
} from '@plugin-host/ui';
import { parseTags } from './bulk.js';

export function makeBulkDialog(React, api) {
  const { createElement: h, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function BulkDialog(props) {
    const editor = props.bulkEditor ?? {};
    const cards = Array.isArray(editor.cards) ? editor.cards : [];
    const books = Array.isArray(editor.books) ? editor.books : [];

    const [addTags, setAddTags] = useState('');
    const [removeTags, setRemoveTags] = useState('');
    const [bookAction, setBookAction] = useState('add');
    const [bookIds, setBookIds] = useState(() => new Set());

    const close = (value) => props.onResult?.(value);
    const toggleBook = (id, on) => setBookIds((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

    const apply = () => {
      const ids = [...bookIds];
      if (!addTags.trim() && !removeTags.trim() && !ids.length) return;
      close({
        tags: { add: parseTags(addTags), remove: parseTags(removeTags) },
        books: bookAction === 'remove' ? { add: [], remove: ids } : { add: ids, remove: [] },
      });
    };

    return h(Stack, { gap: 3 },
      h(InfoBar, { tone: 'neutral' }, t('bulk.notice', { count: cards.length })),
      h(Field, { label: t('bulk.addTags'), hint: t('bulk.tagsHint') },
        h(Input, { value: addTags, onChange: (event) => setAddTags(event.target.value) })),
      h(Field, { label: t('bulk.removeTags'), hint: t('bulk.tagsHint') },
        h(Input, { value: removeTags, onChange: (event) => setRemoveTags(event.target.value) })),
      h(Section, { title: t('bulk.books'), description: t('bulk.booksHint') },
        books.length
          ? h(Stack, { gap: 1 },
              h(Field, { label: t('bulk.bookAction') },
                h(Select, {
                  value: bookAction,
                  onChange: setBookAction,
                  options: [
                    { value: 'add', label: t('bulk.bookAdd') },
                    { value: 'remove', label: t('bulk.bookRemove') },
                  ],
                })),
              ...books.map((book) => h(Checkbox, {
                key: book.id,
                checked: bookIds.has(book.id),
                label: book.name || book.id,
                onChange: (on) => toggleBook(book.id, on),
              })))
          : h(Text, { tone: 'muted' }, t('bulk.noBooks'))),
      h(DialogButtons, {
        buttons: [
          { id: 'cancel', label: t('dialog.cancel'), variant: 'secondary' },
          { id: 'apply', label: t('bulk.apply'), variant: 'primary' },
        ],
        onClick: (id) => { if (id === 'apply') apply(); else close(null); },
      }));
  };
}
