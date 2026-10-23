// The Contacts page: a searchable contact list on the left and a 360° profile
// on the right — the record view the rest of the CRM hangs off. It reads
// contacts, recent mail and tasks; it writes nothing itself (the editor does).

import {
  Badge, Button, Card, EmptyState, Heading, List, ListRow, Page, PageHeader,
  Row, SearchInput, Section, Stack, Text,
} from '@plugin-host/ui';
import { bookNamesById, contactName, emailEntries, loadBooks, loadCards, phoneEntries } from './contacts.js';
import { makeDuplicateSection } from './detail-section.js';
import {
  attachmentsForMessages, companyDomains, companyNameOf, companyOf, eventsForContact, filterCards,
  formatBytes, isCompany, peopleOfCompany, tasksForContact, timelineForContact,
} from './profile.js';
import { openEditor, toastEditorResult } from './open-editor.js';
import { downloadBlob } from './download.js';
import { optionalCall } from './optional.js';

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
    const [context, setContext] = useState({ status: 'idle', messages: [], tasks: [], events: [], files: [], degraded: false });

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
        setContext({ status: 'idle', messages: [], tasks: [], events: [], files: [], degraded: false });
        return undefined;
      }
      let live = true;
      setContext({ status: 'loading', messages: [], tasks: [], events: [], files: [], degraded: false });
      const companyRecord = isCompany(selected);
      const relevant = companyRecord ? [selected, ...peopleOfCompany(cards, selected)] : [selected];
      const email = emailEntries(selected)[0]?.address;
      const text = companyRecord
        ? (companyDomains(cards, selected)[0] || contactName(selected))
        : (email || contactName(selected));
      const messages = text
        ? optionalCall(() => api.email.search({ text, limit: 10 }))
        : Promise.resolve([]);
      const now = new Date();
      const from = new Date(now.getTime() - 180 * 24 * 3600 * 1000).toISOString();
      const to = new Date(now.getTime() + 90 * 24 * 3600 * 1000).toISOString();
      const tasks = optionalCall(() => api.tasks.list({ includeCompleted: false }));
      const events = optionalCall(() => api.calendar.getEvents({ from, to }));
      void Promise.all([messages, tasks, events]).then(([found, open, diary]) => {
        if (!live) return;
        const byId = (items) => [...new Map(items.map((item) => [item.id, item])).values()];
        const timeline = byId(relevant.flatMap((card) => timelineForContact(found ?? [], card)))
          .sort((a, b) => String(b.receivedAt ?? '').localeCompare(String(a.receivedAt ?? '')))
          .slice(0, 10);
        setContext({
          status: 'ready',
          messages: timeline,
          tasks: byId(relevant.flatMap((card) => tasksForContact(open ?? [], card))),
          events: byId(relevant.flatMap((card) => eventsForContact(diary ?? [], card))).slice(0, 10),
          files: attachmentsForMessages(timeline).slice(0, 10),
          degraded: found === null || open === null || diary === null,
        });
      });
      return () => { live = false; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected?.id, cards]);

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

    const createCompany = async () => {
      toastEditorResult(api, await openEditor(api, { mode: 'create', company: true }));
      void load();
    };

    // Saves an attachment of the interaction history. The bytes are streamed
    // straight to the browser; nothing is copied to the server or to storage.
    const saveFile = async (file) => {
      try {
        const data = await api.email.getAttachment(file.emailId, file.blobId);
        downloadBlob(data, file.name);
      } catch (err) {
        api.toast.error(t('profile.downloadFailed', { name: file.name, reason: String(err?.message ?? err) }));
      }
    };

    const company = selected && isCompany(selected) ? selected : null;
    const people = company ? peopleOfCompany(cards, company) : [];
    const domains = company ? companyDomains(cards, company) : [];
    const companyTags = company
      ? Object.keys(company.keywords ?? {}).filter((tag) => tag !== 'company')
      : [];

    const companyCard = () => h(Card, null,
      h(Stack, { gap: 2 },
        h(Row, { gap: 2, wrap: true },
          h(Heading, { level: 2 }, contactName(company) || company.id),
          h(Badge, { tone: 'primary' }, t('profile.companyBadge'))),
        domains.length
          ? h(Row, { gap: 2, wrap: true },
              ...domains.map((domain) => h(Badge, { key: domain, tone: 'neutral' }, domain)))
          : null,
        companyTags.length
          ? h(Row, { gap: 2, wrap: true },
              ...companyTags.map((tag) => h(Badge, { key: tag, tone: 'neutral' }, tag)))
          : null,
        addressLine(company) ? h(Text, { tone: 'muted' }, addressLine(company)) : null,
        notesLine(company) ? h(Text, null, notesLine(company)) : null,
        h(Row, { gap: 2 },
          h(Button, { size: 'sm', icon: 'edit', onClick: () => void edit() }, t('profile.editCompany')))));

    const peopleSection = () => h(Section, {
      title: t('profile.people'),
      description: t('profile.peopleCount', { count: people.length }),
    },
      people.length
        ? h(List, { label: t('profile.people') }, ...people.map((person) => h(ListRow, {
          key: person.id,
          title: contactName(person) || person.id,
          subtitle: emailEntries(person)[0]?.address ?? '',
          onClick: () => setSelectedId(person.id),
        })))
        : h(Text, { tone: 'muted' }, t('profile.noPeople')));

    return h(Page, null,
      h(PageHeader, {
        title: t('page.contactsTitle'),
        description: t('page.contactsDescription'),
        actions: h(Row, { gap: 2 },
          h(Button, { icon: 'user-plus', onClick: () => void create() }, t('action.newContact')),
          h(Button, { icon: 'building', variant: 'secondary', onClick: () => void createCompany() },
            t('action.newCompany'))),
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
                  company ? companyCard() : h(Card, null,
                    h(Stack, { gap: 2 },
                      h(Heading, { level: 2 }, contactName(selected) || selected.id),
                      orgName(selected) || titleName(selected)
                        ? h(Text, { tone: 'muted' }, [titleName(selected), orgName(selected)].filter(Boolean).join(' · '))
                        : null,
                      companyNameOf(selected)
                        ? h(Text, { tone: 'muted' }, companyLine(selected, cards, t))
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
                  company ? peopleSection() : null,
                  company ? null : h(Duplicates, { contact: selected }),
                  h(Section, { title: t('profile.meetings') },
                    context.status === 'ready' && !context.events.length
                      ? h(Text, { tone: 'muted' }, t('profile.noMeetings'))
                      : null,
                    ...context.events.map((event) => h(Row, { key: event.id, gap: 2, wrap: true },
                      h(Text, { tone: 'muted' }, formatDate(event.start, api.i18n.getLocale())),
                      h(Text, null, event.title || t('profile.noTitle'))))),
                  h(Section, { title: t('profile.files') },
                    context.status === 'ready' && !context.files.length
                      ? h(Text, { tone: 'muted' }, t('profile.noFiles'))
                      : null,
                    ...context.files.map((file) => h(Row, { key: `${file.emailId}-${file.name}`, gap: 2, wrap: true },
                      h(Text, null, file.name),
                      fileMeta(file) ? h(Text, { tone: 'muted' }, fileMeta(file)) : null,
                      file.receivedAt
                        ? h(Text, { tone: 'muted' }, formatDate(file.receivedAt, api.i18n.getLocale()))
                        : null,
                      file.subject ? h(Text, { tone: 'muted' }, file.subject) : null,
                      h(Button, { size: 'sm', variant: 'secondary', onClick: () => void saveFile(file) },
                        t('profile.download'))))),
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

function companyLine(card, cards, t) {
  const name = companyNameOf(card);
  const company = companyOf(cards, card);
  const people = company ? peopleOfCompany(cards, company).length : 0;
  return company
    ? t('profile.companyWithPeople', { name, count: people })
    : t('profile.companyLine', { name });
}

const fileMeta = (file) => [file.type, formatBytes(file.size)].filter(Boolean).join(' · ');

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

