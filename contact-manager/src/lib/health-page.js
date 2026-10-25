// The Health sub-tab: what is missing or broken across the address books, why
// each contact lost points, and the fixes the plugin can do itself.
//
// Every number is clickable, so "18 contacts have no phone" leads to the list of
// them. The fixes reuse machinery that is already reversible: normalising goes
// through the cleanup dialog (preview, then undo) and duplicates through the
// review dialog (preview, then undo).

import {
  Badge, Button, EmptyState, InfoBar, List, ListRow, Page, PageHeader, Row, Section, Stack, Text,
} from '@plugin-host/ui';
import { bookNamesById, contactName, loadBooks, loadCards, matchOptions } from './contacts.js';
import { findDuplicateGroups } from './duplicates.js';
import { openEditor, toastEditorResult } from './open-editor.js';
import { toastMergeResult } from './labels.js';
import { applyNormalisation, readRegion } from './normalise.js';
import { STALE_BANDS, healthBand, healthSummary, staleContacts, staleCounts, withIssue } from './health.js';
import { contactsToFile } from './export.js';
import { downloadBlob } from './download.js';
import { deleteContacts } from './bulk.js';
import { ACTION_BAR } from './layout.js';

export function makeHealthPage(React, api) {
  const { createElement: h, useCallback, useEffect, useMemo, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function HealthPage() {
    const [cards, setCards] = useState([]);
    const [bookList, setBookList] = useState([]);
    const [groups, setGroups] = useState([]);
    const [region, setRegion] = useState('');
    const [status, setStatus] = useState('loading');
    const [filter, setFilter] = useState('');
    const [band, setBand] = useState('');

    const load = useCallback(async () => {
      setStatus('loading');
      try {
        const [list, books, storedRegion] = await Promise.all([loadCards(api), loadBooks(api), readRegion(api)]);
        setCards(list);
        setBookList(books);
        setRegion(storedRegion);
        setGroups(findDuplicateGroups(list, { ...matchOptions(api.plugin?.settings), region: storedRegion }, []));
        setStatus('ready');
      } catch {
        setStatus('error');
      }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const books = useMemo(() => bookNamesById(bookList), [bookList]);
    const byId = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
    const duplicateIds = useMemo(
      () => new Set(groups.flatMap((group) => group.members.map((member) => member.id))),
      [groups],
    );
    const summary = useMemo(
      () => healthSummary(cards, { books, region, duplicates: duplicateIds }),
      [cards, books, region, duplicateIds],
    );

    // Worst first: this is a to-do list, not a directory.
    const rows = useMemo(() => {
      const list = filter ? withIssue(summary, filter) : summary.contacts;
      return [...list].sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
    }, [summary, filter]);

    const cleanUp = async (list) => {
      if (!list.length) return;
      const result = await api.ui.openDialog({
        title: t('cleanup.title'),
        slot: 'plugin-dialog',
        extraProps: { normalise: { cards: list, region } },
      });
      if (!result) return;
      const outcome = await applyNormalisation(api, result.plan);
      if (outcome.failed) api.toast.warning(t('cleanup.partial', { updated: outcome.updated, failed: outcome.failed }));
      else api.toast.success(t('cleanup.done', { updated: outcome.updated }));
      void load();
    };

    const review = async (list) => {
      const ids = new Set(list.map((card) => card.id));
      const found = groups.filter((group) => group.members.some((member) => ids.has(member.id)));
      if (!found.length) return;
      const result = await api.ui.openDialog({
        title: t('dialog.title'),
        slot: 'plugin-dialog',
        extraProps: { groups: found },
      });
      toastMergeResult(api, result);
      void load();
    };

    const editCard = async (card) => {
      toastEditorResult(api, await openEditor(api, { mode: 'edit', contact: card }));
      void load();
    };

    // Retention: who has gone untouched, oldest first. The signal is the
    // server's own `updated`; a contact it never stamped is not guessed at.
    // The list uses the *lowest* band, not the health rule's threshold, so the
    // buckets and the rows below them can never disagree about who is stale.
    const stale = useMemo(() => staleContacts(cards, { months: STALE_BANDS[0].months }), [cards]);
    const staleBuckets = useMemo(() => staleCounts(cards), [cards]);
    const staleShown = useMemo(
      () => (band ? stale.filter((entry) => entry.staleness.band === band) : stale),
      [stale, band],
    );

    /** The age of a contact, in the unit that reads best. */
    const ageLabel = (months) => (months >= 24
      ? t('retention.years', { count: Math.floor(months / 12) })
      : t('retention.months', { count: Math.round(months) }));

    /** Writes the file and returns whether there was anything in it. */
    const archive = (list) => {
      const file = contactsToFile(list, 'csv');
      if (!file.body) return false;
      downloadBlob(new Blob([file.body], { type: file.type }), file.name);
      return true;
    };

    const exportStale = () => {
      if (archive(staleShown.map((entry) => entry.card))) {
        api.toast.success(t('retention.exported', { count: staleShown.length }));
      }
    };

    // The export is not optional: it happens as part of the delete, so a
    // retention clean-up can never be the only copy of what it removed.
    const deleteStale = async () => {
      const list = staleShown.map((entry) => entry.card);
      const ok = await api.ui.confirm({
        title: t('retention.confirmTitle', { count: list.length }),
        message: t('retention.confirmBody'),
        confirmLabel: t('retention.confirmAction'),
        danger: true,
      });
      if (!ok) return;
      if (!archive(list)) {
        api.toast.warning(t('retention.exportEmpty'));
        return;
      }
      const result = await deleteContacts(api, list);
      if (result.failed) api.toast.warning(t('retention.partial', { deleted: result.deleted, failed: result.failed }));
      else api.toast.success(t('retention.deleted', { count: result.deleted }));
      void load();
    };

    /** The cards a fix of one kind can be applied to. */
    const cardsFor = (fix) => summary.contacts
      .filter((entry) => entry.issues.some((issue) => issue.fix === fix))
      .map((entry) => byId.get(entry.id))
      .filter(Boolean);

    const cleanable = () => cardsFor('cleanup');

    const contactRow = (entry) => {
      const card = byId.get(entry.id);
      const fixes = new Set(entry.issues.map((issue) => issue.fix).filter(Boolean));
      return h(ListRow, {
        key: entry.id,
        title: entry.name,
        subtitle: t('health.scoreLine', { score: entry.score, band: t(`health.band.${entry.band}`) }),
        meta: entry.issues.map((issue) => t(`health.rule.${issue.key}`)),
        actions: h(Row, { gap: 1, wrap: true },
          fixes.has('cleanup')
            ? h(Button, { size: 'sm', variant: 'secondary', onClick: () => void cleanUp([card]) }, t('health.fix.cleanup'))
            : null,
          fixes.has('merge')
            ? h(Button, { size: 'sm', variant: 'secondary', onClick: () => void review([card]) }, t('health.fix.merge'))
            : null,
          h(Button, { size: 'sm', variant: 'secondary', onClick: () => void editCard(card) }, t('health.fix.edit'))),
      });
    };

    const bandTone = (band) => (band === 'good' ? 'success' : band === 'fair' ? 'warning' : 'danger');

    const bookRow = (book) => {
      const band = healthBand(book.average);
      return h(ListRow, {
        key: book.id,
        title: book.name,
        subtitle: t('health.bookRow', { count: book.count, average: book.average }),
        meta: [h(Badge, { key: 'band', tone: bandTone(band) }, t(`health.band.${band}`))],
      });
    };

    return h(Page, null,
      h(PageHeader, {
        title: t('health.title'),
        description: t('health.description'),
        actions: cleanable().length
          ? h(Button, { icon: 'wand', onClick: () => void cleanUp(cleanable()) },
              t('health.cleanupAll', { count: cleanable().length }))
          : null,
      }),
      status === 'loading' ? h(Text, { tone: 'muted' }, t('health.loading')) : null,
      status === 'error' ? h(EmptyState, { title: t('health.unavailable') }) : null,
      status === 'ready'
        ? h(Stack, { gap: 4 },
            h(InfoBar, { tone: bandTone(summary.band) },
              t('health.summary', {
                average: summary.average, band: t(`health.band.${summary.band}`), total: summary.total,
              })),
            summary.byBook.length
              ? h(Section, { title: t('health.books') },
                  h(List, { label: t('health.books') }, ...summary.byBook.map(bookRow)))
              : null,
            h(Section, { title: t('health.issues'), description: t('health.issuesHint') },
              h('div', { 'data-pane': 'issues', style: ACTION_BAR },
                ...Object.keys(summary.byRule)
                  .filter((key) => summary.byRule[key] > 0)
                  .map((key) => h(Button, {
                    key,
                    size: 'sm',
                    variant: filter === key ? 'primary' : 'secondary',
                    onClick: () => setFilter(filter === key ? '' : key),
                  }, `${t(`health.rule.${key}`)} (${summary.byRule[key]})`)),
                filter
                  ? h(Button, { size: 'sm', variant: 'secondary', onClick: () => setFilter('') }, t('health.clearFilter'))
                  : null)),
            stale.length
              ? h(Section, { title: t('retention.title'), description: t('retention.source') },
                  h(Text, { tone: 'muted' }, t('retention.hint')),
                  h('div', { 'data-pane': 'retention', style: ACTION_BAR },
                    ...STALE_BANDS.map((entry) => h(Button, {
                      key: entry.id,
                      size: 'sm',
                      variant: band === entry.id ? 'primary' : 'secondary',
                      disabled: !staleBuckets[entry.id],
                      onClick: () => setBand(band === entry.id ? '' : entry.id),
                    }, `${t(`retention.band.${entry.id}`)} (${staleBuckets[entry.id]})`)),
                    h(Button, { size: 'sm', variant: 'secondary', icon: 'download', onClick: exportStale },
                      t('retention.export', { count: staleShown.length })),
                    h(Button, { size: 'sm', variant: 'secondary', onClick: () => void deleteStale() },
                      t('retention.exportDelete', { count: staleShown.length }))),
                  h(List, { label: t('retention.title') }, ...staleShown.slice(0, 20).map((entry) => h(ListRow, {
                    key: entry.card.id,
                    title: contactName(entry.card) || entry.card.id,
                    subtitle: t('retention.age', { age: ageLabel(entry.staleness.months) }),
                  }))),
                  staleShown.length > 20
                    ? h(Text, { tone: 'muted' }, t('import.more', { count: staleShown.length - 20 }))
                    : null)
              : h(Text, { tone: 'muted' }, t('retention.none')),
            h(Section, { title: t('health.contacts') },
              rows.length
                ? h(List, { label: t('health.contacts') }, ...rows.map(contactRow))
                : h(EmptyState, { title: t('health.empty') })))
        : null);
  };
}
