// The History tab: what **this plugin** wrote.
//
// It is not an audit log of the address book — a plugin cannot see who else
// changed a contact — so it does not pretend to be one. It records the plugin's
// own writes, newest first, and offers the one rollback that is still live (the
// newest merge record, or the cleanup/rules record), which is the same undo the
// other pages offer.
//
// Reads api.storage only; it never writes a contact.

import {
  Badge, Button, EmptyState, InfoBar, List, ListRow, Page, PageHeader, Section, Stack, Text,
} from '@plugin-host/ui';
import { clearHistory, historyCounts, readHistory } from './history.js';
import { readCleanup, undoCleanup } from './normalise.js';
import { readUndo, undoLastMerge } from './undo.js';

/** The label for a kind, literal so the locale test can see it. */
const KIND_LABEL = {
  merge: 'history.kind.merge',
  cleanup: 'history.kind.cleanup',
  rules: 'history.kind.rules',
  import: 'history.kind.import',
  bulk: 'history.kind.bulk',
  create: 'history.kind.create',
  update: 'history.kind.update',
  delete: 'history.kind.delete',
  group: 'history.kind.group',
};

/** The newest rollback that is still live, whichever task left it. */
export function liveRollback(batches, cleanup) {
  const newest = Array.isArray(batches) ? batches.at(-1) : null;
  const mergeAt = Number(newest?.at) || 0;
  const cleanupAt = Number(cleanup?.at) || 0;
  if (newest?.entries?.length && mergeAt >= cleanupAt) {
    return { kind: 'merge', count: newest.entries.length };
  }
  if (cleanup?.entries?.length) return { kind: 'cleanup', count: cleanup.entries.length };
  if (newest?.entries?.length) return { kind: 'merge', count: newest.entries.length };
  return null;
}

export function makeHistoryPage(React, api) {
  const { createElement: h, useCallback, useEffect, useRef, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function HistoryPage({ revision, onDataChanged } = {}) {
    const [entries, setEntries] = useState([]);
    const [rollback, setRollback] = useState(null);
    const [status, setStatus] = useState('loading');

    const load = useCallback(async () => {
      setStatus('loading');
      try {
        const [list, batches, cleanup] = await Promise.all([
          readHistory(api),
          readUndo(api).catch(() => []),
          readCleanup(api).catch(() => null),
        ]);
        setEntries(list);
        setRollback(liveRollback(batches, cleanup));
        setStatus('ready');
      } catch {
        setStatus('error');
      }
    }, []);

    useEffect(() => { void load(); }, [load]);
    const seenRevision = useRef(revision ?? 0);
    useEffect(() => {
      if ((revision ?? 0) === seenRevision.current) return;
      seenRevision.current = revision ?? 0;
      void load();
    }, [revision, load]);

    const counts = historyCounts(entries);

    const undo = async () => {
      if (!rollback) return;
      if (rollback.kind === 'merge') {
        const result = await undoLastMerge(api);
        if (result.failed) api.toast.warning(t('undo.partial', { restored: result.restored, reverted: result.reverted, failed: result.failed }));
        else api.toast.success(t('undo.done', { restored: result.restored, reverted: result.reverted, failed: 0 }));
      } else {
        const result = await undoCleanup(api);
        if (result.failed) api.toast.warning(t('cleanup.undoPartial', { restored: result.restored, failed: result.failed }));
        else api.toast.success(t('cleanup.undone', { restored: result.restored }));
      }
      onDataChanged?.();
      void load();
    };

    const clear = async () => {
      const ok = await api.ui.confirm({
        title: t('history.clearTitle'),
        message: t('history.clearBody'),
        confirmLabel: t('history.clear'),
        cancelLabel: t('dialog.cancel'),
        danger: true,
      });
      if (!ok) return;
      await clearHistory(api);
      void load();
    };

    return h(Page, null,
      h(PageHeader, {
        title: t('history.title'),
        description: t('history.description'),
        actions: h(Button, {
          variant: 'secondary',
          disabled: !entries.length,
          onClick: () => void clear(),
        }, t('history.clear')),
      }),
      h(Text, { tone: 'muted' }, t('history.hostNote')),
      status === 'error' ? h(InfoBar, { tone: 'danger', title: t('history.loadFailed') }) : null,
      rollback
        ? h(InfoBar, { tone: 'warning', title: t('history.rollback', { count: rollback.count }) },
            h(Button, { size: 'sm', icon: 'undo', onClick: () => void undo() }, t('history.undo')))
        : null,
      status === 'ready' && !entries.length
        ? h(EmptyState, { title: t('history.empty'), description: t('history.emptyHint') })
        : null,
      entries.length
        ? h(Section, { title: t('history.listTitle'), description: t('history.summary', counts) },
            h(List, { label: t('history.listTitle') }, ...entries.map((entry, index) => h(ListRow, {
              key: `${entry.at}-${entry.kind}-${index}`,
              title: t(KIND_LABEL[entry.kind] ?? 'history.kind.update'),
              subtitle: new Date(entry.at).toLocaleString(api.i18n.getLocale()),
              meta: [
                h(Text, { key: 'count', tone: 'muted' }, t('history.contacts', { count: entry.contacts })),
                ...(entry.undoable ? [h(Badge, { key: 'undo', tone: 'neutral' }, t('history.undoable'))] : []),
              ],
            }))))
        : null);
  };
}
