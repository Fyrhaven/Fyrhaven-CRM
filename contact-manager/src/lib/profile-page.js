// The Contacts page: a searchable contact list on the left and a 360° profile
// on the right — the record view the rest of the CRM hangs off. It reads
// contacts, recent mail and tasks; it writes nothing itself (the editor does).

import {
  Badge, Button, Card, EmptyState, Heading, List, ListRow, Page, PageHeader,
  Row, SearchInput, Section, Stack, Text,
} from '@plugin-host/ui';
import {
  addressLabel, addressLine, bookNamesById, contactName, emailEntries, loadBooks, loadCards, nicknameLine,
  notesLine, orgName, phoneEntries, titleName,
} from './contacts.js';
import { makeDuplicateSection } from './detail-section.js';
import { makeNotesSection } from './notes-section.js';
import {
  attachmentsForMessages, companyDomains, companyNameOf, companyOf, eventsForContact,
  calendarRange, formatBytes, isCompany, peopleOfCompany, tasksForContact, timelineForContact,
} from './profile.js';
import { openEditor, toastEditorResult } from './open-editor.js';
import { openFollowUpTask } from './open-task.js';
import { taskBuckets } from './tasks.js';
import { saveFile } from './download.js';
import { reportError } from './report.js';
import { optionalCall } from './optional.js';
import { ACTION_BAR, CONTENT_PANE, ROW_WITH_AVATAR, SAVED_ITEM, SCROLL_AREA, SPLIT, sidePane } from './layout.js';
import { avatarFor } from './avatar.js';
import { makeAvatar } from './avatar-view.js';
import { groupFromSelection } from './duplicates.js';
import { toastMergeResult } from './labels.js';
import { applyBulkEdit, deleteContacts } from './bulk.js';
import { contactsToFile } from './export.js';
import { buildIndex, countsForIndex, isBlankQuery, matchIndexed, parseQuery } from './search.js';
import { deleteSaved, readSaved, saveSearch } from './saved-searches.js';
import { applyNormalisation, readCleanup, readRegion, undoCleanup } from './normalise.js';
import { applyRulesResult, openRules } from './open-rules.js';
import { canManage, canPerform, effectiveRole, hasRoles, readRoles } from './book-roles.js';
import { PAGE_SIZE, isPaged, pageSlice } from './paging.js';

export function makeProfilePage(React, api) {
  const { createElement: h, useRef, useCallback, useEffect, useMemo, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);
  const Duplicates = makeDuplicateSection(React, api);
  const Notes = makeNotesSection(React, api);
  const Avatar = makeAvatar(React);

  return function ProfilePage({ revision } = {}) {
    const [cards, setCards] = useState([]);
    const [bookList, setBookList] = useState([]);
    const [status, setStatus] = useState('loading'); // loading | ready | error
    const [query, setQuery] = useState('');
    const [selectedId, setSelectedId] = useState('');
    const [context, setContext] = useState({ status: 'idle', messages: [], tasks: [], events: [], files: [], degraded: [] });
    const [picked, setPicked] = useState(() => new Set());
    const [page, setPage] = useState(0);
    const [saved, setSaved] = useState([]);
    const [cleanup, setCleanup] = useState(null);
    const [roles, setRoles] = useState({}); // per-address-book roles (#23), advisory
    // A handle on the list pane, so the `/` shortcut can reach its search box
    // (#39) without adding a wrapper element to the pane skeleton.
    const listPane = useRef(null);
    // Bumped after a follow-up task is created, so the open contact's task list
    // reloads — the context effect is keyed on the contact, not on its tasks.
    const [taskTick, setTaskTick] = useState(0);

    const load = useCallback(async () => {
      setStatus('loading');
      try {
        const [list, addressBooks, savedList, cleanupRecord, bookRoles] = await Promise.all([
          loadCards(api), loadBooks(api), readSaved(api), readCleanup(api), readRoles(api),
        ]);
        setCards(list);
        setBookList(addressBooks);
        setSaved(savedList);
        setCleanup(cleanupRecord);
        setRoles(bookRoles);
        setSelectedId((current) => (list.some((card) => card.id === current) ? current : list[0]?.id ?? ''));
        // A deleted or no-longer-matching contact must not stay selected.
        setPicked((current) => {
          const next = new Set([...current].filter((id) => list.some((card) => card.id === id)));
          return next.size === current.size ? current : next;
        });
        setStatus('ready');
      } catch {
        setStatus('error');
      }
    }, []);

    useEffect(() => { void load(); }, [load]);
    // Reload when another page reports a change. A ref remembers the revision
    // this instance started at, so mounting does not read everything twice.
    const seenRevision = useRef(revision ?? 0);
    useEffect(() => {
      if ((revision ?? 0) === seenRevision.current) return;
      seenRevision.current = revision ?? 0;
      void load();
    }, [revision]);

    // Off unless the user turned it on: Gravatar learns a hash of the address.
    const gravatarOn = api.plugin?.settings?.gravatar === true;
    const avatarOf = (card, size) => avatarFor(card, { gravatar: gravatarOn, size });
    const avatarTitle = (card, size) => h('span', { style: ROW_WITH_AVATAR },
      h(Avatar, { avatar: avatarOf(card, size), size }), contactName(card) || card.id);
    const books = useMemo(() => bookNamesById(bookList), [bookList]);
    // One read of the cards serves the list and every saved-search count.
    const searchIndex = useMemo(() => buildIndex(cards, { books }), [cards, books]);
    const parsed = useMemo(() => parseQuery(query), [query]);
    const visible = useMemo(
      () => (isBlankQuery(parsed)
        ? cards
        : searchIndex.filter((entry) => matchIndexed(entry, parsed)).map((entry) => entry.card)),
      [searchIndex, parsed, cards],
    );
    // The rendered page (#39): a view of the match set, never a limit on it.
    // The counts and *Select all* still read `visible`.
    const paged = useMemo(() => pageSlice(visible, page, PAGE_SIZE), [visible, page]);
    // A new query starts at the first page; a shrinking list is clamped by
    // pageSlice, so a page index can never point past the end.
    useEffect(() => { setPage(0); }, [query]);

    // Keyboard shortcuts (#39): `/` jumps to the search box, Esc clears it.
    // Scoped to this page's own search box, so it never swallows a keystroke
    // meant for a dialog or another field.
    useEffect(() => {
      const onKeyDown = (event) => {
        const target = event.target;
        const typing = Boolean(target && (
          target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
        ));
        if (event.key === '/' && !typing) {
          const input = listPane.current?.querySelector('input');
          if (input) {
            event.preventDefault();
            input.focus();
          }
          return;
        }
        // Esc clears the search only when the search box has the focus, so a
        // dialog's own Esc still reaches the host.
        if (event.key === 'Escape' && target?.tagName === 'INPUT' && listPane.current?.contains(target)) {
          setQuery('');
        }
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, []);
    const chipCounts = useMemo(
      () => countsForIndex(searchIndex, saved.map((entry) => entry.query)),
      [searchIndex, saved],
    );
    const selected = useMemo(
      () => cards.find((card) => card.id === selectedId) ?? null,
      [cards, selectedId],
    );

    // Recent messages and open tasks are optional context: a missing
    // permission or a failing API must leave the profile readable.
    useEffect(() => {
      if (!selected) {
        setContext({ status: 'idle', messages: [], tasks: [], events: [], files: [], degraded: [] });
        return undefined;
      }
      let live = true;
      setContext({ status: 'loading', messages: [], tasks: [], events: [], files: [], degraded: [] });
      const companyRecord = isCompany(selected);
      const relevant = companyRecord ? [selected, ...peopleOfCompany(cards, selected)] : [selected];
      const email = emailEntries(selected)[0]?.address;
      const text = companyRecord
        ? (companyDomains(cards, selected)[0] || contactName(selected))
        : (email || contactName(selected));
      const messages = text
        ? optionalCall(() => api.email.search({ text, limit: 10 }))
        : Promise.resolve([]);
      const { from, to } = calendarRange();
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
          // Name what is missing rather than guessing: each optional call that
          // came back null is one of these.
          degraded: [
            found === null ? 'email' : null,
            diary === null ? 'calendar' : null,
            open === null ? 'tasks' : null,
          ].filter(Boolean),
        });
      });
      return () => { live = false; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected?.id, cards, taskTick]);

    // Create a follow-up task for the open contact, then reload its task list.
    const followUp = async () => {
      if (!selected) return;
      const created = await openFollowUpTask(api, selected);
      if (created) setTaskTick((tick) => tick + 1);
    };

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

    // The open contact's tasks, overdue first (#36): a task whose due date has
    // passed is badged, so it is visible without opening the task itself.
    const taskRows = () => {
      const { overdue, rest } = taskBuckets(context.tasks);
      return [...overdue.map((task) => [task, true]), ...rest.map((task) => [task, false])]
        .map(([task, late]) => h(Row, { key: task.id, gap: 2, wrap: true },
          h(Text, null, task.title),
          late ? h(Badge, { tone: 'danger' }, t('profile.taskOverdue')) : null,
          task.due ? h(Text, { tone: 'muted' }, formatDate(task.due, api.i18n.getLocale())) : null));
    };

    const createCompany = async () => {
      toastEditorResult(api, await openEditor(api, { mode: 'create', company: true }));
      void load();
    };

    // Saves an attachment of the interaction history. The bytes are streamed
    // straight to the browser; nothing is copied to the server or to storage.
    // named for what it saves: the shared `saveFile` helper would otherwise be
    // shadowed, and this called itself
    const saveAttachment = async (file) => {
      try {
        const data = await api.email.getAttachment(file.emailId, file.blobId);
        await saveFile(api, data, file.name);
      } catch (err) {
        await reportError(api, t('profile.downloadFailed', { name: file.name, reason: String(err?.message ?? err) }));
      }
    };

    const pickedCards = cards.filter((card) => picked.has(card.id));

    const togglePicked = (id, on) => setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

    // A saved search (or any query) used as a bulk scope (#34): everything the
    // list shows becomes the selection, so the actions above apply to the whole
    // set rather than to hand-picked rows.
    const selectShown = () => setPicked(new Set(visible.map((card) => card.id)));

    // A hand-picked selection carries no evidence, so it becomes a group marked
    // 'manual' and goes through the same review dialog as a duplicate group:
    // keep selector, conflict resolution, danger confirm and undo included.
    const mergePicked = async () => {
      if (pickedCards.length < 2) {
        api.toast.info(t('contacts.needTwo'));
        return;
      }
      const result = await api.ui.openDialog({
        title: t('dialog.title'),
        slot: 'plugin-dialog',
        extraProps: { groups: [groupFromSelection(pickedCards)] },
      });
      toastMergeResult(api, result);
      setPicked(new Set());
      void load();
    };

    // A delete has no plan to review, so it is confirmed here and then handed
    // to deleteContacts, which keeps an undo batch of everything it removed.
    const deletePicked = async () => {
      if (!pickedCards.length) return;
      const names = pickedCards.map((card) => contactName(card) || card.id);
      const shown = names.slice(0, 3).join(', ');
      const ok = await api.ui.confirm({
        title: t('contacts.deleteTitle', { count: names.length }),
        message: t('contacts.deleteBody', {
          names: names.length > 3 ? `${shown} +${names.length - 3}` : shown,
        }),
        confirmLabel: t('contacts.deleteConfirm'),
        danger: true,
      });
      if (!ok) return;
      const result = await deleteContacts(api, pickedCards);
      if (result.failed) {
        api.toast.warning(t('contacts.deletePartial', { deleted: result.deleted, failed: result.failed }));
      } else {
        api.toast.success(t('contacts.deleted', { count: result.deleted }));
      }
      setPicked(new Set());
      void load();
    };

    // Tags and address books are edited through one dialog and written in one
    // update per contact, because both are map fields the host replaces
    // wholesale — src/lib/bulk.js owns those rules.
    const editPicked = async () => {
      if (!pickedCards.length) return;
      const result = await api.ui.openDialog({
        title: t('bulk.title', { count: pickedCards.length }),
        slot: 'plugin-dialog',
        extraProps: { bulkEditor: { cards: pickedCards, books: bookList } },
      });
      if (!result) return;
      const outcome = await applyBulkEdit(api, pickedCards, result);
      if (outcome.failed) api.toast.warning(t('bulk.partial', { updated: outcome.updated, failed: outcome.failed }));
      else if (outcome.updated) api.toast.success(t('bulk.done', { updated: outcome.updated }));
      else api.toast.info(t('bulk.nothing'));
      setPicked(new Set());
      void load();
    };

    // The selection, or everything the search shows, as vCard or CSV. Built
    // here because this is where the cards are; nothing is sent to the server.
    const exportPicked = async () => {
      const choice = await api.ui.openDialog({
        title: t('export.title'),
        slot: 'plugin-dialog',
        extraProps: { exportSelection: { selected: pickedCards.length, shown: visible.length } },
      });
      if (!choice) return;
      const cards = choice.scope === 'selected' ? pickedCards : visible;
      const file = contactsToFile(cards, choice.format);
      if (!file.body) {
        api.toast.warning(t('contacts.exportEmpty'));
        return;
      }
      // The host saves it when it can. The sandbox forbids an anchor download, so
      // when it cannot, the file itself is shown: a success toast with no file
      // behind it is the bug this replaces.
      const saved = await saveFile(api, file.body, file.name, file.type);
      if (!saved) {
        await api.ui.openDialog({
          title: t('export.resultTitle'),
          slot: 'plugin-dialog',
          extraProps: { exportResult: { name: file.name, body: file.body } },
        });
      }
      api.toast.success(t('contacts.exported', { count: cards.length }));
    };

    const removeSavedSearch = async (name) => {
      setSaved(await deleteSaved(api, name));
    };

    const saveCurrent = async () => {
      const name = query.trim();
      if (!name) return;
      setSaved(await saveSearch(api, name, name));
      api.toast.success(t('search.savedToast', { name }));
    };

    // The one line under the box: what is wrong with the query, how many
    // matched, or what the operators are.
    const searchNote = () => {
      if (parsed.errors.length) {
        return h(Text, { tone: 'warning' }, parsed.errors
          .map((error) => t(`search.error.${error.reason}`, { field: error.field, value: error.value ?? '' }))
          .join(' '));
      }
      if (query.trim()) {
        return h(Text, { tone: 'muted' }, t('search.count', { shown: visible.length, total: cards.length }));
      }
      return h(Text, { tone: 'muted' }, t('search.hint'));
    };

    // Saved searches are named by their own query, so no prompt API is needed:
    // the button reads as the query it runs, with its live count beside it.
    // Two plain buttons rather than a kit Chip — the kit's Chip drops its
    // onClick when it also has a remove button, which is exactly this case.
    const savedRow = () => {
      const current = query.trim();
      const alreadySaved = saved.some((entry) => entry.query === current);
      if (!saved.length && !current) return null;
      return h('div', { 'data-pane': 'saved', style: ACTION_BAR },
        ...saved.map((entry, i) => h('span', { key: entry.name, style: SAVED_ITEM },
          h(Button, {
            size: 'sm',
            variant: 'secondary',
            onClick: () => setQuery(entry.query),
          }, `${entry.name} · ${chipCounts[i] ?? 0}`),
          h(Button, {
            size: 'sm',
            variant: 'secondary',
            'aria-label': t('search.removeSaved', { name: entry.name }),
            onClick: () => void removeSavedSearch(entry.name),
          }, '×'))),
        current && !alreadySaved
          ? h(Button, { size: 'sm', variant: 'secondary', onClick: () => void saveCurrent() }, t('search.save'))
          : null);
    };

    // Normalising is a bulk edit, so it takes the selection and shows what it
    // would change first — the dialog plans, this applies.
    const cleanPicked = async () => {
      if (!pickedCards.length) return;
      const result = await api.ui.openDialog({
        title: t('cleanup.title'),
        slot: 'plugin-dialog',
        extraProps: { normalise: { cards: pickedCards, region: await readRegion(api) } },
      });
      if (!result) return;
      const outcome = await applyNormalisation(api, result.plan);
      if (outcome.failed) api.toast.warning(t('cleanup.partial', { updated: outcome.updated, failed: outcome.failed }));
      else api.toast.success(t('cleanup.done', { updated: outcome.updated }));
      setPicked(new Set());
      setCleanup(await readCleanup(api));
      void load();
    };

    // The rules dialog over the selection: the user picks the rules, sees the
    // exact edits, and the batch goes through the same apply and the same undo
    // as the cleanup — one rollback button covers both.
    const rulesPicked = async () => {
      if (!pickedCards.length) return;
      const result = await openRules(api, { cards: pickedCards });
      if (!result) return;
      await applyRulesResult(api, result);
      setPicked(new Set());
      setCleanup(await readCleanup(api));
      void load();
    };

    const undoSingleCleanup = async () => {
      const outcome = await undoCleanup(api);
      if (outcome.failed) api.toast.warning(t('cleanup.undoPartial', { restored: outcome.restored, failed: outcome.failed }));
      else api.toast.success(t('cleanup.undone', { restored: outcome.restored }));
      setCleanup(await readCleanup(api));
      void load();
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
          h(Avatar, { avatar: avatarOf(company, 48), size: 48 }),
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
          title: avatarTitle(person, 24),
          subtitle: emailEntries(person)[0]?.address ?? '',
          onClick: () => setSelectedId(person.id),
        })))
        : h(Text, { tone: 'muted' }, t('profile.noPeople')));

    return h(Page, null,
      h(PageHeader, {
        title: t('page.contactsTitle'),
        description: t('page.contactsDescription'),
        actions: h(Row, { gap: 2 },
          h(Button, { variant: 'secondary', icon: 'download', onClick: () => void exportPicked() }, t('contacts.exportSelected')),
          h(Button, { icon: 'user-plus', disabled: !canManage('edit', roles), onClick: () => void create() }, t('action.newContact')),
          h(Button, { icon: 'building', variant: 'secondary', disabled: !canManage('edit', roles), onClick: () => void createCompany() },
            t('action.newCompany'))),
      }),
      status === 'loading' ? h(Text, { tone: 'muted' }, t('profile.loading')) : null,
      status === 'error' ? h(EmptyState, { title: t('profile.unavailable') }) : null,
      status === 'ready'
        ? h('div', { 'data-pane': 'split', style: SPLIT },
            h('div', { 'data-pane': 'list', style: sidePane(320), ref: listPane },
              picked.size
                ? h('div', { 'data-pane': 'actions', style: ACTION_BAR },
                    h(Text, { tone: 'muted' }, t('contacts.selected', { count: picked.size })),
                    // The advisory role of the selection (#23): the buttons the
                    // role does not allow are disabled, and the line says why.
                    hasRoles(roles)
                      ? h(Text, { tone: 'muted' }, t('roles.limited', {
                          role: t(`roles.role.${effectiveRole(pickedCards, roles)}`),
                        }))
                      : null,
                    h(Button, {
                      size: 'sm',
                      icon: 'git-merge',
                      disabled: picked.size < 2 || !canPerform(pickedCards, 'merge', roles),
                      onClick: () => void mergePicked(),
                    }, t('contacts.mergeSelected')),
                    h(Button, {
                      size: 'sm',
                      variant: 'secondary',
                      icon: 'edit',
                      disabled: !canPerform(pickedCards, 'edit', roles),
                      onClick: () => void editPicked(),
                    }, t('contacts.editSelected')),
                    h(Button, {
                      size: 'sm',
                      variant: 'secondary',
                      icon: 'wand',
                      disabled: !canPerform(pickedCards, 'edit', roles),
                      onClick: () => void cleanPicked(),
                    }, t('cleanup.action')),
                    h(Button, {
                      size: 'sm',
                      variant: 'secondary',
                      icon: 'shield',
                      disabled: !canPerform(pickedCards, 'edit', roles),
                      onClick: () => void rulesPicked(),
                    }, t('rules.action')),
                    h(Button, {
                      size: 'sm',
                      variant: 'secondary',
                      disabled: !canPerform(pickedCards, 'delete', roles),
                      onClick: () => void deletePicked(),
                    }, t('contacts.deleteSelected')),
                    h(Button, {
                      size: 'sm',
                      variant: 'secondary',
                      onClick: () => setPicked(new Set()),
                    }, t('contacts.clearSelection')))
                : null,
              h(SearchInput, {
                value: query,
                label: t('profile.searchLabel'),
                placeholder: t('profile.searchPlaceholder'),
                onChange: setQuery,
              }),
              searchNote(),
              visible.length
                ? h('div', { 'data-pane': 'select-all', style: ACTION_BAR },
                    h(Button, {
                      size: 'sm',
                      variant: 'secondary',
                      onClick: () => selectShown(),
                    }, t('contacts.selectAll', { count: visible.length })))
                : null,
              savedRow(),
              cleanup ? h('div', { 'data-pane': 'cleanup', style: ACTION_BAR },
                h(Text, { tone: 'muted' }, t('cleanup.available')),
                h(Button, {
                  size: 'sm', variant: 'secondary', icon: 'undo', onClick: () => void undoSingleCleanup(),
                }, t('cleanup.undo'))) : null,
              // The pager (#39) sits above the scroll area, so it does not
              // scroll away with a long list. Shown only when there is more
              // than one page.
              isPaged(visible.length)
                ? h('div', { 'data-pane': 'pager', style: ACTION_BAR },
                    h(Button, {
                      size: 'sm', variant: 'secondary', disabled: paged.page === 0,
                      onClick: () => setPage(paged.page - 1),
                    }, t('contacts.prevPage')),
                    h(Text, { tone: 'muted' }, t('contacts.pageRange', {
                      page: paged.page + 1,
                      pages: paged.pages,
                      from: paged.from,
                      to: paged.to,
                      total: paged.total,
                    })),
                    h(Button, {
                      size: 'sm', variant: 'secondary', disabled: paged.page >= paged.pages - 1,
                      onClick: () => setPage(paged.page + 1),
                    }, t('contacts.nextPage')))
                : null,
              h('div', { 'data-pane': 'list-scroll', style: SCROLL_AREA },
                visible.length
                  ? h(List, { label: t('page.contactsTitle') }, ...paged.items.map((card) => h(ListRow, {
                    key: card.id,
                    title: avatarTitle(card, 24),
                    subtitle: bookLabel(card),
                    selected: card.id === selectedId,
                    checked: picked.has(card.id),
                    onCheck: (on) => togglePicked(card.id, on),
                    checkLabel: t('contacts.selectRow', { name: contactName(card) || card.id }),
                    onClick: () => setSelectedId(card.id),
                  })))
                  : h(Text, { tone: 'muted' }, t('profile.noMatch')))),
            selected
              ? h('div', { 'data-pane': 'detail', style: CONTENT_PANE },
                  company ? companyCard() : h(Card, null,
                    h(Stack, { gap: 2 },
                      h(Row, { gap: 2 },
                        h(Avatar, { avatar: avatarOf(selected, 48), size: 48 }),
                        h(Heading, { level: 2 }, contactName(selected) || selected.id)),
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
                        h(Button, { size: 'sm', icon: 'edit', disabled: !canPerform([selected], 'edit', roles), onClick: () => void edit() }, t('detail.edit')),
                        h(Button, { size: 'sm', variant: 'secondary', icon: 'plus', onClick: () => void followUp() }, t('profile.followUp'))))),
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
                      h(Button, { size: 'sm', variant: 'secondary', onClick: () => void saveAttachment(file) },
                        t('profile.download'))))),
                  h(Section, { title: t('profile.messages') },
                    context.status === 'loading' ? h(Text, { tone: 'muted' }, t('profile.loading')) : null,
                    context.status === 'ready' && !context.messages.length
                      ? h(Text, { tone: 'muted' }, t('profile.noMessages'))
                      : null,
                    ...context.messages.map((message) => h(Row, { key: message.id, gap: 2, wrap: true },
                      h(Text, { tone: 'muted' }, formatDate(message.receivedAt, api.i18n.getLocale())),
                      h(Text, null, message.subject || t('profile.noSubject')),
                      h(Text, { tone: 'muted' }, addressLabel(message.from))))),
                  h(Section, { title: t('profile.tasks') },
                    context.status === 'ready' && !context.tasks.length
                      ? h(Text, { tone: 'muted' }, t('profile.noTasks'))
                      : null,
                    ...taskRows()),
                  h(Notes, { contact: selected, revision }),
                  context.degraded.length
                    ? h(Text, { tone: 'muted' }, t('profile.degraded', {
                        parts: context.degraded.map((part) => t(`profile.degraded.${part}`)).join(', '),
                      }))
                    : null)
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




function formatDate(value, locale) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(locale || undefined);
}

