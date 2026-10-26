// The main page: the plugin's landing window.
//
// It answers "what needs attention" and offers "what can I do", and every row
// leads into the section it summarises. The menu runs **the same actions as the
// command palette** (`lib/actions.js`), so the two can never disagree about what
// a task does.
//
// The counts come from one load of the contacts, shared with the health rules
// and the duplicate scan — the same work the Duplicates tab does when you press
// its scan button, done once here instead of on every visit to a section.

import {
  Badge, Button, Card, EmptyState, Heading, InfoBar, List, ListRow, Page, PageHeader, Section, Stack, Text,
} from '@plugin-host/ui';
import { bookNamesById, loadBooks, loadCards, matchOptions } from './contacts.js';
import { findDuplicateGroups, LAST_SCAN_KEY } from './duplicates.js';
import { readProjects } from './projects.js';
import { healthSummary } from './health.js';
import { readRegion } from './normalise.js';
import { findDuplicates, importContacts, newCompany, newContact, newProject, undoMerge } from './actions.js';
import { undoWindowMinutes } from './labels.js';
import { readUndo } from './undo.js';
import { ACTION_BAR } from './layout.js';
import { readPolicies, readIgnore } from './book-policies.js';

export function makeHomePage(React, api) {
  const { createElement: h, useRef, useCallback, useEffect, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function HomePage({ onNavigate, revision, onDataChanged } = {}) {
    const [state, setState] = useState({ status: 'loading' });
    const go = (tab) => { if (typeof onNavigate === 'function') onNavigate(tab); };

    const load = useCallback(async () => {
      setState({ status: 'loading' });
      try {
        const [cards, bookList, projects, region, undo, lastScan, policies, ignore] = await Promise.all([
          loadCards(api),
          loadBooks(api),
          readProjects(api),
          readRegion(api),
          undoWindowMinutes(api.plugin?.settings) > 0 ? readUndo(api) : Promise.resolve([]),
          api.storage.get(LAST_SCAN_KEY),
          readPolicies(api),
          readIgnore(api),
        ]);
        const books = bookNamesById(bookList);
        const groups = findDuplicateGroups(cards, { ...matchOptions(api.plugin?.settings), region, policies, ignore }, []);
        setState({
          status: 'ready',
          cards,
          books,
          projects,
          groups,
          health: healthSummary(cards, {
            books,
            region,
            duplicates: new Set(groups.flatMap((group) => group.members.map((member) => member.id))),
          }),
          undoable: undo.length,
          lastScan: lastScan && typeof lastScan === 'object' ? lastScan : null,
        });
      } catch {
        setState({ status: 'error' });
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

    const duplicateLine = () => t('home.duplicatesLine', {
      groups: state.groups?.length ?? 0,
      contacts: (state.groups ?? []).reduce((n, group) => n + group.members.length, 0),
    });

    const menu = () => h('div', { 'data-pane': 'menu', style: ACTION_BAR },
      h(Button, { icon: 'search', onClick: () => void findDuplicates(api).then(() => onDataChanged?.()) }, t('action.scanCommand')),
      h(Button, { variant: 'secondary', icon: 'user-plus', onClick: () => void newContact(api).then(() => onDataChanged?.()) }, t('action.newContact')),
      h(Button, { variant: 'secondary', icon: 'building', onClick: () => void newCompany(api).then(() => onDataChanged?.()) }, t('action.newCompany')),
      h(Button, { variant: 'secondary', icon: 'folder', onClick: () => void newProject(api).then(() => onDataChanged?.()) }, t('action.newProject')),
      h(Button, { variant: 'secondary', icon: 'upload', onClick: () => void importContacts(api).then(() => onDataChanged?.()) }, t('action.importContacts')),
      undoWindowMinutes(api.plugin?.settings) > 0 && state.undoable
        ? h(Button, { variant: 'secondary', icon: 'undo', onClick: () => void undoMerge(api).then(() => onDataChanged?.()) }, t('action.undoCommand'))
        : null);

    const row = (key, title, line, badge, tab) => h(ListRow, {
      key,
      title,
      subtitle: line,
      meta: badge ? [h(Badge, { key: 'badge', tone: badge.tone ?? 'neutral' }, badge.label)] : [],
      actions: h(Button, { size: 'sm', variant: 'secondary', onClick: () => go(tab) }, t('home.open')),
    });

    return h(Page, null,
      h(PageHeader, { title: t('page.title'), description: t('home.description') }),
      state.status === 'loading' ? h(Text, { tone: 'muted' }, t('home.loading')) : null,
      state.status === 'error' ? h(EmptyState, { title: t('home.unavailable') }) : null,
      state.status === 'ready'
        ? h(Stack, { gap: 4 },
            h(InfoBar, { tone: state.groups.length ? 'warning' : 'success' },
              state.groups.length ? duplicateLine() : t('home.duplicatesClean')),
            h(Card, null,
              h(Stack, { gap: 2 },
                h(Heading, { level: 2 }, t('home.menu')),
                h(Text, { tone: 'muted' }, t('home.menuHint')),
                menu())),
            h(Section, { title: t('home.sections') },
              h(List, { label: t('home.sections') },
                row('duplicates', t('tab.duplicates'), duplicateLine(),
                  state.groups.length ? null : { label: t('home.clear'), tone: 'success' }, 'duplicates'),
                row('contacts', t('page.contactsTitle'), t('home.contactsLine', { count: state.cards.length }), null, 'contacts'),
                row('projects', t('page.projectsTitle'), t('home.projectsLine', { count: state.projects.length }), null, 'projects'),
                row('health', t('health.title'), t('home.healthLine', {
                  average: state.health.average,
                  band: t(`health.band.${state.health.band}`),
                }), { label: t(`health.band.${state.health.band}`) }, 'health'))),
            state.lastScan
              ? h(Text, { tone: 'muted' }, t('home.lastScan', {
                  when: new Date(state.lastScan.when).toLocaleString(api.i18n.getLocale()),
                  contacts: state.lastScan.contacts,
                  books: state.lastScan.books,
                }))
              : h(Text, { tone: 'muted' }, t('home.neverScanned')))
        : null);
  };
}
