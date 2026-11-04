// The consent editor (#26): the lawful basis a contact is held on, per source,
// with an expiry. A record is written the moment it is saved — through
// `saveConsent`, which audits the change — because a consent is a fact about a
// person, not a draft.
//
// The host passes api.ui.openDialog's `extraProps` as props —
// `{ consentEditor: { card, records } }` — plus `onResult(value)`. It resolves
// to `{ saved, removed }` (counts of what was written while it was open) or null.

import {
  Alert, Badge, Button, DialogButtons, Field, InfoBar, Input, List, ListRow, Select, Stack, Text,
} from '@plugin-host/ui';
import { contactName } from './contacts.js';
import { DEFAULT_BASIS, LAWFUL_BASES, consentStatus, daysUntilExpiry, normalizeConsent } from './consent.js';
import { deleteConsent, saveConsent } from './privacy.js';

const STATUS_TONE = { active: 'success', expiring: 'warning', expired: 'danger' };

export function makeConsentDialog(React, api) {
  const { createElement: h, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function ConsentDialog(props) {
    const editor = props.consentEditor ?? {};
    const card = editor.card ?? null;
    const subjectId = String(card?.id ?? '');
    const [records, setRecords] = useState(() => (Array.isArray(editor.records) ? editor.records : []));
    const [draft, setDraft] = useState(() => ({
      source: '', basis: DEFAULT_BASIS, grantedAt: new Date().toISOString().slice(0, 10), expiresAt: '', note: '',
    }));
    const [counts, setCounts] = useState({ saved: 0, removed: 0 });
    const [failure, setFailure] = useState('');
    const [busy, setBusy] = useState(false);

    const set = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
    const close = (value) => props.onResult?.(value);

    const save = async () => {
      const record = normalizeConsent({ ...draft, contactId: subjectId });
      if (!record) {
        setFailure(t('consent.error.source'));
        return;
      }
      setBusy(true);
      setFailure('');
      try {
        await saveConsent(api, record);
        setRecords((current) => [record, ...current.filter((item) => item.source.toLowerCase() !== record.source.toLowerCase())]);
        setCounts((current) => ({ ...current, saved: current.saved + 1 }));
        setDraft((current) => ({ ...current, source: '', note: '', expiresAt: '' }));
      } catch (err) {
        setFailure(String(err?.message ?? err));
      } finally {
        setBusy(false);
      }
    };

    const remove = async (record) => {
      setBusy(true);
      try {
        await deleteConsent(api, record.contactId, record.source);
        setRecords((current) => current.filter((item) => item.source.toLowerCase() !== record.source.toLowerCase()));
        setCounts((current) => ({ ...current, removed: current.removed + 1 }));
      } catch (err) {
        setFailure(String(err?.message ?? err));
      } finally {
        setBusy(false);
      }
    };

    const statusLabel = (record) => {
      const status = consentStatus(record);
      const days = daysUntilExpiry(record);
      if (status === 'expired') return t('consent.status.expired');
      if (status === 'expiring') return t('consent.status.expiring', { days });
      return t('consent.status.active');
    };

    return h(Stack, { gap: 3 },
      h(Text, { tone: 'muted' }, t('consent.subject', { name: contactName(card) || subjectId })),
      failure ? h(Alert, { tone: 'danger' }, failure) : null,
      records.length
        ? h(List, { label: t('consent.held') }, ...records.map((record) => h(ListRow, {
            key: `${record.contactId}:${record.source}`,
            title: `${record.source} · ${t(`consent.basis.${record.basis}`)}`,
            subtitle: [record.grantedAt, record.expiresAt ? t('consent.expiresOn', { date: record.expiresAt }) : t('consent.noExpiry')]
              .filter(Boolean).join(' · '),
            meta: [h(Badge, { key: 's', tone: STATUS_TONE[consentStatus(record)] ?? 'neutral' }, statusLabel(record))],
            actions: h(Button, {
              size: 'sm', variant: 'secondary', disabled: busy,
              onClick: () => void remove(record),
            }, t('consent.remove')),
          })))
        : h(Text, { tone: 'muted' }, t('consent.none')),
      h(InfoBar, { tone: 'neutral', title: t('consent.addTitle') },
        h(Text, { tone: 'muted' }, t('consent.addHint'))),
      h(Field, { label: t('consent.source'), required: true },
        h(Input, { value: draft.source, onChange: (event) => set('source', event.target.value) })),
      h(Field, { label: t('consent.basis') },
        h(Select, {
          value: draft.basis,
          onChange: (value) => set('basis', value),
          options: LAWFUL_BASES.map((basis) => ({ value: basis, label: t(`consent.basis.${basis}`) })),
        })),
      h(Field, { label: t('consent.grantedAt') },
        h(Input, { type: 'date', value: draft.grantedAt, onChange: (event) => set('grantedAt', event.target.value) })),
      h(Field, { label: t('consent.expiresAt'), hint: t('consent.expiresHint') },
        h(Input, { type: 'date', value: draft.expiresAt, onChange: (event) => set('expiresAt', event.target.value) })),
      h(Field, { label: t('consent.note') },
        h(Input, { value: draft.note, onChange: (event) => set('note', event.target.value) })),
      h(DialogButtons, {
        buttons: [
          { id: 'save', label: t('consent.save'), variant: 'primary', disabled: busy },
          { id: 'close', label: t('dialog.cancel'), variant: 'secondary' },
        ],
        onClick: (id) => { if (id === 'save') void save(); else close(counts); },
      }));
  };
}
