// The Smart lists dialog (#13, the command-palette half): the saved searches
// with live counts, the members of the selected one, and an export.
//
// Opened from the command palette. It reads and returns a *choice*; the action
// (lib/actions.js) does the export, so the dialog never opens a dialog of its
// own — a nested dialog is a host behaviour this plugin does not rely on.

import { Button, EmptyState, List, ListRow, Row, Section, Stack, Text } from '@plugin-host/ui';
import { bookNamesById, contactName, loadBooks, loadCards } from './contacts.js';
import { buildIndex, countsForIndex } from './search.js';
import { readSaved } from './saved-searches.js';
import { ALL_KEY, matchesFor, smartLists } from './smart-lists.js';
import { PAGE_SIZE, isPaged, pageSlice } from './paging.js';
import { reportError } from './report.js';

export function makeSmartListsDialog(React, api) {
  const { createElement: h, useEffect, useMemo, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function SmartListsDialog(props) {
    const [status, setStatus] = useState('loading'); // loading | ready | error
    const [cards, setCards] = useState([]);
    const [books, setBooks] = useState(() => new Map());
    const [saved, setSaved] = useState([]);
    const [selected, setSelected] = useState(ALL_KEY);
    const [page, setPage] = useState(0);

    useEffect(() => {
      Promise.all([loadCards(api), loadBooks(api), readSaved(api)])
        .then(([list, bookList, savedList]) => {
          setCards(list);
          setBooks(bookNamesById(bookList));
          setSaved(savedList);
          setStatus('ready');
        })
        .catch(async (err) => {
          setStatus('error');
          await reportError(api, t('smartLists.loadFailed', { reason: String(err?.message ?? err) }));
        });
    }, []);

    // One read of the cards serves every list's count and the selected list's
    // members, so the two can never disagree.
    const index = useMemo(() => buildIndex(cards, { books }), [cards, books]);
    const counts = useMemo(
      () => countsForIndex(index, saved.map((entry) => entry.query)),
      [index, saved],
    );
    const lists = useMemo(
      () => smartLists(saved, { total: cards.length, counts }),
      [saved, counts, cards.length],
    );
    const current = lists.find((entry) => entry.key === selected) ?? lists[0];
    const matches = useMemo(() => matchesFor(index, current), [index, current]);
    const paged = useMemo(() => pageSlice(matches, page, PAGE_SIZE), [matches, page]);

    // A different list starts at its first page.
    useEffect(() => { setPage(0); }, [selected]);

    const close = (value) => props.onResult?.(value);
    const label = (entry) => (entry.all ? t('smartLists.all') : entry.name);
    const bookLabel = (card) => Object.keys(card.addressBookIds ?? {})
      .map((id) => books.get(id)).filter(Boolean).join(', ');

    if (status === 'loading') return h(Stack, { gap: 3 }, h(Text, null, '…'));
    if (status === 'error') return h(EmptyState, { title: t('smartLists.unavailable') });

    return h(Stack, { gap: 4 },
      h(Text, { tone: 'muted' }, t('smartLists.intro')),

      h(Section, { title: t('smartLists.lists') },
        h(Row, { gap: 2, wrap: true },
          ...lists.map((entry) => h(Button, {
            key: entry.key,
            size: 'sm',
            variant: entry.key === current.key ? 'primary' : 'secondary',
            onClick: () => setSelected(entry.key),
          }, `${label(entry)} · ${entry.count}`)))),

      saved.length
        ? null
        : h(Text, { tone: 'muted' }, t('smartLists.noSaved')),

      h(Stack, { gap: 2 },
        h(Text, { weight: 'semibold' }, t('smartLists.count', { count: matches.length })),
        isPaged(matches.length)
          ? h(Row, { gap: 2 },
              h(Button, {
                size: 'sm', variant: 'secondary', disabled: paged.page === 0,
                onClick: () => setPage(paged.page - 1),
              }, t('contacts.prevPage')),
              h(Text, { tone: 'muted' }, t('contacts.pageRange', {
                page: paged.page + 1, pages: paged.pages, from: paged.from, to: paged.to, total: paged.total,
              })),
              h(Button, {
                size: 'sm', variant: 'secondary', disabled: paged.page >= paged.pages - 1,
                onClick: () => setPage(paged.page + 1),
              }, t('contacts.nextPage')))
          : null,
        paged.items.length
          ? h(List, { label: label(current) }, ...paged.items.map((card) => h(ListRow, {
              key: card.id,
              title: contactName(card) || card.id,
              subtitle: bookLabel(card),
            })))
          : h(Text, { tone: 'muted' }, t('smartLists.empty'))),

      h(Row, { gap: 2, wrap: true },
        h(Button, {
          icon: 'download',
          disabled: matches.length === 0,
          onClick: () => close({ export: { cards: matches, format: 'vcard', name: current.name } }),
        }, t('smartLists.exportVcard')),
        h(Button, { variant: 'secondary', onClick: () => close(null) }, t('smartLists.close'))));
  };
}
