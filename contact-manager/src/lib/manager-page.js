// The app-page slot: the Contact Manager page — statistics, duplicate groups
// with hide/restore and multi-select, and a Review… button that opens the
// shared merge dialog. Scanning is a full fresh load of the address books;
// nothing is cached (api.storage holds only the settings and hidden groups).

import { List, ListRow, Page, PageHeader, InfoBar, Alert, EmptyState, Card, Badge, Checkbox, Button, Row, Stack, Text, Heading } from '@plugin-host/ui';
import { bookIds, bookNamesById, contactName, loadBooks, loadCards, matchOptions } from './contacts.js';
import { LAST_SCAN_KEY, findDuplicateGroups, planMerge, readDismissed, writeDismissed } from './duplicates.js';
import { memberLabel, mergeLabel, reasonLine, strengthKey, toastMergeResult } from './labels.js';

const FOCUS_COOLDOWN_MS = 5000;

export function makeManagerPage(React, api) {
  const { createElement: h, useCallback, useEffect, useRef, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function ManagerPage() {
    const [status, setStatus] = useState('idle'); // idle | scanning | ready | error
    const [error, setError] = useState('');
    const [groups, setGroups] = useState([]);
    const [hiddenGroups, setHiddenGroups] = useState([]);
    const [stats, setStats] = useState(null);
    const [bookNames, setBookNames] = useState(() => new Map());
    const [showHidden, setShowHidden] = useState(false);
    const [selected, setSelected] = useState(() => new Set());
    const [run, setRun] = useState(0); // bump to scan again
    const lastScanAt = useRef(0);

    const scan = useCallback(async () => {
      lastScanAt.current = Date.now();
      setStatus('scanning');
      setError('');
      try {
        const [cards, books, dismissed] = await Promise.all([loadCards(api), loadBooks(api), readDismissed(api)]);
        const hiddenSet = new Set(dismissed);
        const found = findDuplicateGroups(cards, matchOptions(api.plugin.settings), []);
        const when = new Date().toISOString();
        setBookNames(bookNamesById(books));
        setGroups(found.filter((group) => !hiddenSet.has(group.signature)));
        setHiddenGroups(found.filter((group) => hiddenSet.has(group.signature)));
        setStats({ when, contacts: cards.length, books: books.length });
        setSelected(new Set());
        setStatus('ready');
        await api.storage.set(LAST_SCAN_KEY, {
          at: when,
          contacts: cards.length,
          books: books.length,
          groups: found.filter((group) => !hiddenSet.has(group.signature)).length,
        });
      } catch (err) {
        setError(String(err?.message ?? err));
        setStatus('error');
      }
    }, []);

    // Scan once when the page opens (unless autoScan is off); `scan` is
    // stable, so this effect runs at mount only.
    useEffect(() => {
      if (api.plugin.settings.autoScan !== false) void scan();
      return undefined;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scan]);

    // Rescan on demand (Rescan / Retry buttons).
    useEffect(() => {
      if (run > 0) void scan();
      return undefined;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [run, scan]);

    // A merge started elsewhere (command palette, contact list) happens in
    // another frame; pick it up when the window gets the focus back.
    useEffect(() => {
      if (api.plugin.settings.autoScan === false) return undefined;
      const onFocus = () => {
        if (Date.now() - lastScanAt.current > FOCUS_COOLDOWN_MS) void scan();
      };
      window.addEventListener('focus', onFocus);
      return () => window.removeEventListener('focus', onFocus);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scan]);

    const openReview = async (list) => {
      if (!list.length) {
        api.toast.info(t('toast.selectFirst'));
        return;
      }
      const result = await api.ui.openDialog({
        title: t('dialog.title'),
        slot: 'plugin-dialog',
        extraProps: { groups: list },
      });
      toastMergeResult(api, result);
      if (result) void scan();
    };

    const hide = async (group) => {
      const next = await readDismissed(api);
      if (!next.includes(group.signature)) next.push(group.signature);
      await writeDismissed(api, next);
      setGroups((previous) => previous.filter((g) => g.signature !== group.signature));
      setHiddenGroups((previous) => [...previous, group]);
      setSelected((previous) => {
        const updated = new Set(previous);
        updated.delete(group.signature);
        return updated;
      });
      api.toast.info(t('toast.hidden'));
    };

    const restore = async (group) => {
      await writeDismissed(api, (await readDismissed(api)).filter((s) => s !== group.signature));
      setHiddenGroups((previous) => previous.filter((g) => g.signature !== group.signature));
      setGroups((previous) => [...previous, group]);
      api.toast.info(t('toast.restored'));
    };

    const toggleSelected = (signature, on) => setSelected((previous) => {
      const next = new Set(previous);
      if (on) next.add(signature);
      else next.delete(signature);
      return next;
    });

    const bookLabel = (member) => {
      const ids = bookIds(member);
      return ids.length ? (bookNames.get(ids[0]) ?? '') : '';
    };

    const groupCard = (group) => {
      const plan = planMerge(group);
      const keepId = plan.primary?.id;
      const names = group.members.map(contactName).join(', ');
      return h(Card, { key: group.signature },
        h(Stack, { gap: 2 },
          h(Row, { gap: 2 },
            h(Checkbox, {
              checked: selected.has(group.signature),
              ariaLabel: t('group.select', { name: names }),
              onChange: (on) => toggleSelected(group.signature, on),
            }),
            h(Badge, { tone: group.strength === 'strong' ? 'success' : 'warning' }, t(strengthKey(group))),
            h(Text, { tone: 'muted' }, t('group.members', { count: group.members.length }))),
          h(Text, { tone: 'muted' }, reasonLine(t, group)),
          h(List, { label: names },
            group.members.map((member) => h(ListRow, {
              key: member.id,
              title: memberLabel(member),
              subtitle: bookLabel(member),
              meta: member.id === keepId ? [h(Badge, { key: 'keep', tone: 'primary' }, t('group.keepBadge'))] : [],
            }))),
          h(Row, { gap: 2 },
            h(Button, { size: 'sm', icon: 'git-merge', onClick: () => void openReview([group]) }, t('action.review')),
            h(Button, { size: 'sm', variant: 'secondary', icon: 'eye-off', onClick: () => void hide(group) }, t('action.hide')))));
    };

    const strongCount = groups.filter((group) => group.strength === 'strong').length;
    const summary = stats
      ? t('scan.summary', {
          contacts: stats.contacts,
          books: stats.books,
          groups: groups.length,
          strong: strongCount,
          possible: groups.length - strongCount,
        })
      : '';

    return h(Page, null,
      h(PageHeader, {
        title: t('page.title'),
        description: t('page.description'),
        actions: h(Row, { gap: 2 },
          h(Button, { icon: 'refresh', busy: status === 'scanning', onClick: () => setRun((n) => n + 1) },
            status === 'ready' ? t('action.rescan') : t('action.scan')),
          status === 'ready' && (showHidden || hiddenGroups.length)
            ? h(Button, { variant: 'secondary', icon: showHidden ? 'eye' : 'eye-off', onClick: () => setShowHidden((v) => !v) },
                showHidden ? t('action.hideHidden') : t('action.showHidden'))
            : null),
      }),
      status === 'scanning' ? h(InfoBar, { tone: 'primary', title: t('scan.running') }) : null,
      status === 'error'
        ? h(Stack, { gap: 2 },
            h(Alert, { tone: 'danger' }, t('scan.failed', { reason: error })),
            h(Row, null, h(Button, { icon: 'refresh', onClick: () => setRun((n) => n + 1) }, t('action.retry'))))
        : null,
      status === 'idle'
        ? h(EmptyState, {
            title: t('empty.title'),
            description: t('scan.idle'),
            actions: h(Button, { icon: 'search', onClick: () => void scan() }, t('empty.action')),
          })
        : null,
      status === 'ready'
        ? h(Stack, { gap: 4 },
            h(InfoBar, { tone: groups.length ? 'warning' : 'success', title: summary },
              h(Text, { tone: 'muted' },
                t('scan.last', { when: new Date(stats.when).toLocaleString(api.i18n.getLocale()) }))),
            selected.size
              ? h(Row, { gap: 2 },
                  h(Button, { icon: 'git-merge', onClick: () => void openReview(groups.filter((g) => selected.has(g.signature))) },
                    mergeLabel(t, selected.size)),
                  h(Button, { variant: 'secondary', onClick: () => setSelected(new Set()) }, t('dialog.cancel')))
              : null,
            groups.length === 0 ? h(EmptyState, { title: t('scan.clean') }) : null,
            ...groups.map(groupCard),
            showHidden
              ? h(Stack, { gap: 2 },
                  h(Heading, { level: 3 }, t('action.showHidden')),
                  hiddenGroups.length === 0
                    ? h(Text, { tone: 'muted' }, t('scan.clean'))
                    : null,
                  ...hiddenGroups.map((group) => h(Row, { key: group.signature, gap: 2 },
                    h(Text, null, group.members.map(contactName).join(', ')),
                    h(Button, { size: 'sm', variant: 'secondary', icon: 'undo', onClick: () => void restore(group) },
                      t('action.restore')))))
              : null)
        : null);
  };
}
