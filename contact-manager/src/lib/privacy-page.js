// The Privacy tab (#26): the data-subject half of the CRM. Pick a person, see
// what personal data the address book holds about them, hand it back as a
// subject-access export, record the lawful basis they are held on, and erase or
// anonymise them — leaving a proof-of-deletion report behind.
//
// It reads the address books and writes through the same paths everything else
// uses: erasing deletes the card the way the Health tab's retention does (with
// an undo record), and anonymising is one `contacts.update`. The consent
// records and the deletion log live in api.storage, per account and per browser,
// like the projects and the history — the page says so out loud.

import {
  Badge, Button, EmptyState, Heading, InfoBar, List, ListRow, Page, PageHeader, Row,
  SearchInput, Section, Stack, Text,
} from '@plugin-host/ui';
import { contactName, loadCards } from './contacts.js';
import { consentStatus, consentSummary, consentsFor, daysUntilExpiry, readConsents } from './consent.js';
import { notesFor, readNotes } from './notes.js';
import {
  anonymiseSubject, buildSubjectExport, deletionSummary, deletionsToCsv, eraseSubject,
  personalDataInventory, readDeletions, subjectExportJson, subjectExportName,
} from './privacy.js';
import { readHistory } from './history.js';
import { filterCards } from './profile.js';
import { contactsToFile } from './export.js';
import { saveFile } from './download.js';

/** How many subjects the picker lists at once, so a big book stays a picker. */
export const SUBJECT_LIMIT = 20;

const STATUS_TONE = { active: 'success', expiring: 'warning', expired: 'danger' };

export function makePrivacyPage(React, api) {
  const { createElement: h, useCallback, useEffect, useMemo, useRef, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function PrivacyPage({ revision, onDataChanged } = {}) {
    const [cards, setCards] = useState([]);
    const [consents, setConsents] = useState([]);
    const [deletions, setDeletions] = useState([]);
    const [history, setHistory] = useState([]);
    // The private notes (#38) — personal data this browser holds, so the
    // subject-access export has to hand them back.
    const [notes, setNotes] = useState({});
    const [status, setStatus] = useState('loading');
    const [query, setQuery] = useState('');
    const [selectedId, setSelectedId] = useState('');

    const load = useCallback(async () => {
      setStatus('loading');
      try {
        const [list, records, log, entries, stored] = await Promise.all([
          loadCards(api), readConsents(api), readDeletions(api), readHistory(api).catch(() => []),
          readNotes(api).catch(() => ({})),
        ]);
        setCards(Array.isArray(list) ? list : []);
        setConsents(records);
        setDeletions(log);
        setHistory(entries);
        setNotes(stored);
        setSelectedId((current) => (list.some((card) => card.id === current) ? current : ''));
        setStatus('ready');
      } catch {
        setStatus('error');
      }
    }, []);

    useEffect(() => { void load(); }, [load]);
    // Reload when another page reports a change. A ref stops a page that mounts
    // late from reading the address book twice.
    const seenRevision = useRef(revision ?? 0);
    useEffect(() => {
      if ((revision ?? 0) === seenRevision.current) return;
      seenRevision.current = revision ?? 0;
      void load();
    }, [revision, load]);

    const matches = useMemo(() => {
      const list = query ? filterCards(cards, query) : cards;
      return list.slice(0, SUBJECT_LIMIT);
    }, [cards, query]);
    const truncated = useMemo(() => {
      const list = query ? filterCards(cards, query) : cards;
      return list.length > SUBJECT_LIMIT;
    }, [cards, query]);

    const card = useMemo(() => cards.find((item) => item.id === selectedId) ?? null, [cards, selectedId]);
    const inventory = useMemo(() => (card ? personalDataInventory(card) : null), [card]);
    const held = useMemo(() => (card ? consentsFor(consents, card.id) : []), [card, consents]);
    const summary = useMemo(() => consentSummary(consents), [consents]);
    const deletionTotals = useMemo(() => deletionSummary(deletions), [deletions]);


    /** The file for one subject in the requested format, or null when empty. */
    const subjectFile = (format) => {
      if (!card) return null;
      if (format === 'json') {
        const bundle = buildSubjectExport({ card, consents, history, notes: notesFor(notes, card.id) });
        return { body: subjectExportJson(bundle), name: subjectExportName(card, 'json'), type: 'application/json' };
      }
      return contactsToFile([card], format);
    };

    const exportSubject = async (format) => {
      const file = subjectFile(format);
      if (!file?.body) {
        api.toast.warning(t('privacy.exportEmpty'));
        return;
      }
      await saveFile(api, file.body, file.name, file.type);
      api.toast.success(t('privacy.exported', { name: file.name }));
    };

    const manageConsent = async () => {
      if (!card) return;
      const result = await api.ui.openDialog({
        title: t('consent.title'),
        slot: 'plugin-dialog',
        extraProps: { consentEditor: { card, records: held } },
      });
      if (result?.saved) api.toast.success(t('consent.savedToast', { count: result.saved }));
      if (result?.removed) api.toast.info(t('consent.removedToast', { count: result.removed }));
      onDataChanged?.();
      void load();
    };

    const anonymise = async () => {
      if (!card) return;
      const ok = await api.ui.confirm({
        title: t('privacy.anonymiseTitle', { name: contactName(card) || card.id }),
        message: t('privacy.anonymiseBody'),
        confirmLabel: t('privacy.anonymiseConfirm'),
        danger: true,
      });
      if (!ok) return;
      try {
        const result = await anonymiseSubject(api, card);
        api.toast.success(t('privacy.anonymised', { count: result.fields.length }));
      } catch (err) {
        api.toast.error(t('privacy.writeFailed', { reason: String(err?.message ?? err) }));
      }
      setSelectedId('');
      onDataChanged?.();
      void load();
    };

    const erase = async () => {
      if (!card) return;
      const ok = await api.ui.confirm({
        title: t('privacy.eraseTitle', { name: contactName(card) || card.id }),
        message: t('privacy.eraseBody'),
        confirmLabel: t('privacy.eraseConfirm'),
        danger: true,
      });
      if (!ok) return;
      const result = await eraseSubject(api, card);
      if (result.failed) api.toast.warning(t('privacy.eraseFailed'));
      else api.toast.success(t('privacy.erased'));
      setSelectedId('');
      onDataChanged?.();
      void load();
    };

    const exportReport = async () => {
      if (!deletions.length) return;
      await saveFile(api, deletionsToCsv(deletions), 'deletion-report.csv', 'text/csv');
      api.toast.success(t('privacy.reportExported', { count: deletions.length }));
    };

    const statusLabel = (record) => {
      const status = consentStatus(record);
      const days = daysUntilExpiry(record);
      if (status === 'expired') return t('consent.status.expired');
      if (status === 'expiring') return t('consent.status.expiring', { days });
      return t('consent.status.active');
    };

    return h(Page, null,
      h(PageHeader, { title: t('privacy.title'), description: t('privacy.description') }),
      h(Text, { tone: 'muted' }, t('privacy.hostNote')),
      status === 'error' ? h(InfoBar, { tone: 'danger', title: t('privacy.loadFailed') }) : null,
      h(InfoBar, { tone: summary.expired ? 'warning' : 'neutral', title: t('privacy.summary', summary) },
        h(Text, { tone: 'muted' }, t('privacy.summaryHint'))),
      h(Section, { title: t('privacy.subjectTitle'), description: t('privacy.subjectHint') },
        h(Row, { gap: 2 },
          h(SearchInput, {
            value: query,
            label: t('privacy.search'),
            placeholder: t('privacy.searchPlaceholder'),
            onChange: setQuery,
          })),
        status === 'ready' && !matches.length
          ? h(Text, { tone: 'muted' }, t('privacy.noSubjects'))
          : null,
        matches.length
          ? h(List, { label: t('privacy.subjectTitle') }, ...matches.map((item) => h(ListRow, {
              key: item.id,
              title: contactName(item) || item.id,
              subtitle: consentsFor(consents, item.id).length
                ? t('privacy.subjectConsents', { count: consentsFor(consents, item.id).length })
                : t('privacy.subjectNoConsents'),
              selected: item.id === selectedId,
              onClick: () => setSelectedId(item.id),
            })))
          : null,
        truncated ? h(Text, { tone: 'muted' }, t('privacy.truncated', { limit: SUBJECT_LIMIT })) : null),
      card
        ? h(Section, { title: t('privacy.detailTitle', { name: contactName(card) || card.id }) },
            h(Text, { tone: 'muted' }, t('privacy.inventory', {
              fields: inventory.fields.length, emails: inventory.emails, phones: inventory.phones,
            })),
            held.length
              ? h(List, { label: t('privacy.heldTitle') }, ...held.map((record) => h(ListRow, {
                  key: `${record.source}`,
                  title: `${record.source} · ${t(`consent.basis.${record.basis}`)}`,
                  subtitle: [record.grantedAt, record.expiresAt ? t('consent.expiresOn', { date: record.expiresAt }) : t('consent.noExpiry')]
                    .filter(Boolean).join(' · '),
                  meta: [h(Badge, { key: 's', tone: STATUS_TONE[consentStatus(record)] ?? 'neutral' }, statusLabel(record))],
                })))
              : h(Text, { tone: 'muted' }, t('consent.none')),
            h(Row, { gap: 2, wrap: true },
              h(Button, { size: 'sm', variant: 'secondary', icon: 'download', onClick: () => void exportSubject('json') }, t('privacy.exportJson')),
              h(Button, { size: 'sm', variant: 'secondary', icon: 'download', onClick: () => void exportSubject('vcard') }, t('privacy.exportVcard')),
              h(Button, { size: 'sm', variant: 'secondary', icon: 'download', onClick: () => void exportSubject('csv') }, t('privacy.exportCsv')),
              h(Button, { size: 'sm', variant: 'secondary', icon: 'shield', onClick: () => void manageConsent() }, t('privacy.manageConsent'))),
            h(Row, { gap: 2, wrap: true },
              h(Button, { size: 'sm', variant: 'secondary', onClick: () => void anonymise() }, t('privacy.anonymise')),
              h(Button, { size: 'sm', variant: 'danger', onClick: () => void erase() }, t('privacy.erase'))))
        : status === 'ready' && matches.length
          ? h(EmptyState, { title: t('privacy.pickTitle'), description: t('privacy.pickHint') })
          : null,
      h(Section, { title: t('privacy.logTitle'), description: t('privacy.logHint') },
        h(Row, { gap: 2 },
          h(Text, { tone: 'muted' }, t('privacy.logSummary', deletionTotals)),
          h(Button, {
            size: 'sm', variant: 'secondary', icon: 'download',
            disabled: !deletions.length, onClick: () => void exportReport(),
          }, t('privacy.exportReport'))),
        deletions.length
          ? h(List, { label: t('privacy.logTitle') }, ...deletions.slice(0, SUBJECT_LIMIT).map((entry, index) => h(ListRow, {
              key: `${entry.at}-${entry.id}-${index}`,
              title: entry.id,
              subtitle: new Date(entry.at).toLocaleString(api.i18n.getLocale()),
              meta: [h(Badge, { key: 'm', tone: 'neutral' }, t(`privacy.method.${entry.method}`)),
                h(Text, { key: 'f', tone: 'muted' }, t('privacy.fieldCount', { count: entry.fields.length }))],
            })))
          : h(Text, { tone: 'muted' }, t('privacy.logEmpty'))));
  };
}
