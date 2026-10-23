// The Contacts page: a searchable contact list on the left and a 360° profile
// on the right — the record view the rest of the CRM hangs off. It reads
// contacts, recent mail and tasks; it writes nothing itself (the editor does).

import {
  Badge, Button, Card, EmptyState, Heading, List, ListRow, Page, PageHeader,
  Row, SearchInput, Section, Stack, Text,
} from '@plugin-host/ui';
import { bookNamesById, contactName, emailEntries, loadBooks, loadCards, phoneEntries } from './contacts.js';
import { makeDuplicateSection } from './detail-section.js';
import { filterCards, tasksForContact, timelineForContact } from './profile.js';
import { openEditor, toastEditorResult } from './open-editor.js';

export function makeProfilePage(React, api) {
  const { createElement: h, useCallback, useEffect, useMemo, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);
  const Duplicates = makeDuplicateSection(React, api);

  return function ProfilePage() {
    const [cards, setCards] = useState([]);
    const [books, setBooks] = useState(new Map());
    const [status, setStatus] = useState('loading'); // loading | ready | error
    const [query, setQuery] = useState('');
    const [selectedId, setSelectedId] = useState('');
    const [context, setContext] = useState({ status: 'idle', messages: [], tasks: [], degraded: false });

    const load = useCallback(async () => {
      setStatus('loading');
      try {
        const [list, addressBooks] = await Promise.all([loadCards(api), loadBooks(api)]);
        setCards(list);
        setBooks(bookNamesById(addressBooks));
        setSelectedId((current) => (list.some((card) => card.id === current) ? current : list[0]?.id ?? ''));
        setStatus('ready');
      } catch {
        setStatus('error');
      }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const visible = useMemo(() => filterCards(cards, query), [cards, query]);
    const selected = useMemo(
      () => cards.find((card) => card.id === selectedId) ?? null,
      [cards, selectedId],
    );

    // Recent messages and open tasks are optional context: a missing
    // permission or a failing API must leave the profile readable.
    useEffect(() => {
      if (!selected) {
        setContext({ status: 'idle', messages: [], tasks: [], degraded: false });
        return undefined;
      }
      let live = true;
      setContext({ status: 'loading', messages: [], tasks: [], degraded: false });
      const email = emailEntries(selected)[0]?.address;
      const text = email || contactName(selected);
      const messages = text
        ? api.email.search({ text, limit: 10 }).catch(() => null)
        : Promise.resolve([]);
      const tasks = api.tasks.list({ includeCompleted: false }).catch(() => null);
      void Promise.all([messages, tasks]).then(([found, open]) => {
        if (!live) return;
        setContext({
          status: 'ready',
          messages: timelineForContact(found ?? [], selected).slice(0, 10),
          tasks: tasksForContact(open ?? [], selected),
          degraded: found === null || open === null,
        });
      });
      return () => { live = false; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected?.id]);

    const edit = async () => {
      if (!selected) return;
      toastEditorResult(api, await openEditor(api, { mode: 'edit', contact: selected }));
      void load();
    };

    const create = async () => {
      toastEditorResult(api, await openEditor(api, { mode: 'create' }));
      void load();
    };

    const bookLabel = (card) => Object.keys(card.addressBookIds ?? {})
      .map((id) => books.get(id)).filter(Boolean).join(', ');

    return h(Page, null,
      h(PageHeader, {
        title: t('page.contactsTitle'),
        description: t('page.contactsDescription'),
        actions: h(Button, { icon: 'user-plus', onClick: () => void create() }, t('action.newContact')),
      }),
      status === 'loading' ? h(Text, { tone: 'muted' }, t('profile.loading')) : null,
      status === 'error' ? h(EmptyState, { title: t('profile.unavailable') }) : null,
      status === 'ready'
        ? h(Row, { gap: 4 },
            h(Stack, { gap: 2, style: { flex: '0 0 320px', minWidth: '240px' } },
              h(SearchInput, {
                value: query,
                label: t('profile.searchLabel'),
                placeholder: t('profile.searchPlaceholder'),
                onChange: setQuery,
              }),
              visible.length
                ? h(List, { label: t('page.contactsTitle') }, ...visible.map((card) => h(ListRow, {
                  key: card.id,
                  title: contactName(card) || card.id,
                  subtitle: bookLabel(card),
                  selected: card.id === selectedId,
                  onClick: () => setSelectedId(card.id),
                })))
                : h(Text, { tone: 'muted' }, t('profile.noMatch'))),
            selected
              ? h(Stack, { gap: 4, style: { flex: '1 1 auto', minWidth: '0' } },
                  h(Card, null,
                    h(Stack, { gap: 2 },
                      h(Heading, { level: 2 }, contactName(selected) || selected.id),
                      orgName(selected) || titleName(selected)
                        ? h(Text, { tone: 'muted' }, [titleName(selected), orgName(selected)].filter(Boolean).join(' · '))
                        : null,
                      Object.keys(selected.keywords ?? {}).length
                        ? h(Row, { gap: 2, wrap: true },
                            ...Object.keys(selected.keywords).map((tag) => h(Badge, { key: tag, tone: 'neutral' }, tag)))
                        : null,
                      ...emailEntries(selected).map((entry) => h(Text, { key: `e-${entry.key}` },
                        h(Badge, { tone: entry.pref ? 'primary' : 'neutral' }, entry.address))),
                      ...phoneEntries(selected).map((entry) => h(Text, { key: `p-${entry.key}`, tone: 'muted' }, entry.number)),
                      nicknameLine(selected)
                        ? h(Text, { tone: 'muted' }, t('profile.nicknameLine', { name: nicknameLine(selected) }))
                        : null,
                      addressLine(selected) ? h(Text, { tone: 'muted' }, addressLine(selected)) : null,
                      notesLine(selected) ? h(Text, null, notesLine(selected)) : null,
                      h(Row, { gap: 2 },
                        h(Button, { size: 'sm', icon: 'edit', onClick: () => void edit() }, t('detail.edit'))))),
                  h(Duplicates, { contact: selected }),
                  h(Section, { title: t('profile.messages') },
                    context.status === 'loading' ? h(Text, { tone: 'muted' }, t('profile.loading')) : null,
                    context.status === 'ready' && !context.messages.length
                      ? h(Text, { tone: 'muted' }, t('profile.noMessages'))
                      : null,
                    ...context.messages.map((message) => h(Row, { key: message.id, gap: 2, wrap: true },
                      h(Text, { tone: 'muted' }, formatDate(message.receivedAt, api.i18n.getLocale())),
                      h(Text, null, message.subject || t('profile.noSubject')),
                      h(Text, { tone: 'muted' }, message.from?.email ?? message.from ?? '')))),
                  h(Section, { title: t('profile.tasks') },
                    context.status === 'ready' && !context.tasks.length
                      ? h(Text, { tone: 'muted' }, t('profile.noTasks'))
                      : null,
                    ...context.tasks.map((task) => h(Row, { key: task.id, gap: 2, wrap: true },
                      h(Text, null, task.title),
                      task.due ? h(Text, { tone: 'muted' }, formatDate(task.due, api.i18n.getLocale())) : null))),
                  context.degraded ? h(Text, { tone: 'muted' }, t('profile.degraded')) : null)
              : h(EmptyState, { title: t('profile.select') }))
        : null);
  };
}

const orgName = (card) => Object.values(card.organizations ?? {})[0]?.name ?? '';
const titleName = (card) => Object.values(card.titles ?? {})[0]?.name ?? '';

const nicknameLine = (card) => Object.values(card.nicknames ?? {})
  .map((entry) => entry?.name).filter(Boolean).join(', ');

const notesLine = (card) => Object.values(card.notes ?? {})
  .map((entry) => entry?.note).filter(Boolean).join(' · ');

function addressLine(card) {
  const address = Object.values(card.addresses ?? {})[0];
  if (!address) return '';
  return [
    address.street,
    [address.postcode, address.locality].filter(Boolean).join(' '),
    address.region,
    address.country,
  ].filter(Boolean).join(', ');
}

function formatDate(value, locale) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(locale || undefined);
}

