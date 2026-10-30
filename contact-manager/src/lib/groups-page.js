// The Groups tab: distribution lists as first-class records. A group is a real
// JSContact card (`kind: 'group'`), so this page reads and writes the same
// address books the Contacts tab does — it is a view over the host's data, not
// a second store. The editor dialog is where a list is changed; here it is
// listed, searched, and flagged when it holds two contacts that are one person.

import {
  Badge, Button, EmptyState, InfoBar, List, ListRow, Page, PageHeader, Row,
  SearchInput, Section, Text,
} from '@plugin-host/ui';
import { loadCards } from './contacts.js';
import { duplicatesInGroup, groupMemberIds, groupMemberLabel, isGroupCard } from './groups.js';
import { policyAwareOptions } from './book-policies.js';
import { openGroup, toastGroupResult } from './open-group.js';
import { filterCards } from './profile.js';

export function makeGroupsPage(React, api) {
  const { createElement: h, useCallback, useEffect, useMemo, useRef, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function GroupsPage({ revision, onDataChanged } = {}) {
    const [cards, setCards] = useState([]);
    const [detectOptions, setDetectOptions] = useState({});
    const [status, setStatus] = useState('loading');
    const [query, setQuery] = useState('');

    const load = useCallback(async () => {
      setStatus('loading');
      try {
        const [list, opts] = await Promise.all([
          loadCards(api),
          policyAwareOptions(api).catch(() => ({})),
        ]);
        setCards(Array.isArray(list) ? list : []);
        setDetectOptions(opts);
        setStatus('ready');
      } catch {
        setStatus('error');
      }
    }, []);

    useEffect(() => { void load(); }, [load]);
    // Reload when another page wrote something. A ref stops a page that mounts
    // late from reading the address book twice.
    const seenRevision = useRef(revision ?? 0);
    useEffect(() => {
      if ((revision ?? 0) === seenRevision.current) return;
      seenRevision.current = revision ?? 0;
      void load();
    }, [revision, load]);

    const groups = useMemo(() => cards.filter(isGroupCard), [cards]);
    const byId = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
    const shown = useMemo(() => (query ? filterCards(groups, query) : groups), [groups, query]);
    const flagged = useMemo(
      () => groups.filter((group) => duplicatesInGroup(group, cards, detectOptions).length),
      [groups, cards, detectOptions],
    );

    const open = async (mode, group) => {
      toastGroupResult(api, await openGroup(api, { mode, group }));
      onDataChanged?.();
      void load();
    };

    const memberNames = (group) => groupMemberIds(group)
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((card) => groupMemberLabel(card, card.id));

    const row = (group) => {
      const names = memberNames(group);
      const dupes = duplicatesInGroup(group, cards, detectOptions);
      return h(ListRow, {
        key: group.id,
        title: groupMemberLabel(group, group.id),
        subtitle: names.length ? names.join(', ') : t('groups.emptyList'),
        meta: [
          h(Text, { key: 'count', tone: 'muted' }, t('groups.memberCount', { count: names.length })),
          ...(dupes.length ? [h(Badge, { key: 'dupes', tone: 'warning' }, t('groups.duplicateBadge'))] : []),
        ],
        onClick: () => void open('edit', group),
        actions: h(Button, {
          size: 'sm',
          variant: 'secondary',
          onClick: (event) => { event?.stopPropagation?.(); void open('edit', group); },
        }, t('groups.edit')),
      });
    };

    return h(Page, null,
      h(PageHeader, {
        title: t('groups.title'),
        description: t('groups.description'),
        actions: h(Button, { icon: 'plus', onClick: () => void open('create', null) }, t('groups.new')),
      }),
      h(Text, { tone: 'muted' }, t('groups.hostNote')),
      status === 'error' ? h(InfoBar, { tone: 'danger', title: t('groups.loadFailed') }) : null,
      status === 'ready' && !groups.length
        ? h(EmptyState, { title: t('groups.empty'), description: t('groups.emptyHint') })
        : null,
      groups.length
        ? h(Section, { title: t('groups.listTitle'), description: t('groups.listHint') },
            h(Row, { gap: 2 },
              h(SearchInput, {
                value: query,
                label: t('groups.search'),
                placeholder: t('groups.searchPlaceholder'),
                onChange: setQuery,
              })),
            flagged.length
              ? h(InfoBar, { tone: 'warning', title: t('groups.flagged', { count: flagged.length }) },
                  h(Text, { tone: 'muted' }, t('groups.flaggedHint')))
              : null,
            shown.length
              ? h(List, { label: t('groups.listTitle') }, ...shown.map(row))
              : h(Text, { tone: 'muted' }, t('groups.noMatches')))
        : null);
  };
}
