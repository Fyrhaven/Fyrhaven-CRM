// The import wizard: pick a file, check how its columns were read, see what
// would happen, then import — or stop.
//
// It loads what it needs itself rather than taking it through `extraProps`,
// because the duplicate check wants every existing contact and that is not a
// payload to hand through a dialog.
//
// Nothing is written from here: the dialog returns the drafts the user
// accepted, and the page writes them through `applyImport`.

import {
  Alert, Badge, Button, Checkbox, DialogButtons, Field, InfoBar, Input, Row, Section, Select, Stack, Text,
} from '@plugin-host/ui';
import { bookNamesById, contactName, detectionOptions, loadBooks, loadCards } from './contacts.js';
import { IMPORT_FIELDS, guessMapping, isUsableMapping } from './import-fields.js';
import { findTemplate, saveTemplate } from './import-templates.js';
import { applyImport, duplicateKey, mergeGroupsFromImport, planImport, rowsToDrafts } from './import.js';
import { parseCsv } from './csv.js';
import { looksLikeVCard, parseVCards } from './vcard-parse.js';
import { PREVIEW_AREA } from './layout.js';

// The reasons `planImport` reports, as i18n keys. Literal, so the locale
// completeness test can see them.
const REASON_KEYS = { email: 'group.reasonEmail', phone: 'group.reasonPhone', name: 'group.reasonName' };

/** Reads a picked file as text, without a library. */
function readText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read-failed'));
    reader.readAsText(file);
  });
}

export function makeImportDialog(React, api) {
  const { createElement: h, useEffect, useMemo, useRef, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function ImportDialog(props) {
    const fileRef = useRef(null);
    const [ready, setReady] = useState({ status: 'loading' });
    const [source, setSource] = useState(null);      // { kind: 'csv'|'vcard', headers, rows, text }
    const [mapping, setMapping] = useState([]);
    const [remember, setRemember] = useState(true);
    const [bookId, setBookId] = useState('');
    // One decision per duplicate (`skip` | `merge` | `separate`), keyed by
    // `duplicateKey` so it survives the drafts being rebuilt, plus the default
    // the user picked for the whole batch. Both live only as long as the
    // wizard is open: "remembered per batch" is the batch.
    const [decisions, setDecisions] = useState({});
    const [defaultDecision, setDefaultDecision] = useState('skip');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const close = (value) => props.onResult?.(value);

    useEffect(() => {
      let live = true;
      (async () => {
        try {
          const [cards, books, options] = await Promise.all([
            loadCards(api), loadBooks(api), detectionOptions(api),
          ]);
          if (!live) return;
          setReady({ status: 'ready', cards, books, names: bookNamesById(books), region: options.region ?? '' });
          setBookId(books[0]?.id ?? '');
        } catch {
          if (live) setReady({ status: 'error' });
        }
      })();
      return () => { live = false; };
    }, []);

    // Read the file, work out what it is, and map its columns.
    const load = async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      setError('');
      try {
        const text = await readText(file);
        if (looksLikeVCard(text)) {
          setSource({ kind: 'vcard', text });
          setMapping([]);
          return;
        }
        const { headers, rows } = parseCsv(text);
        if (!headers.length) {
          setError(t('import.empty'));
          setSource(null);
          return;
        }
        const remembered = await findTemplate(api, headers);
        setMapping(remembered?.mapping?.length === headers.length ? remembered.mapping : guessMapping(headers));
        setSource({ kind: 'csv', headers, rows });
      } catch (err) {
        setError(t('import.readFailed', { reason: String(err?.message ?? err) }));
      }
    };

    const drafts = useMemo(() => {
      if (!source) return [];
      const bookIds = bookId ? [bookId] : [];
      if (source.kind === 'vcard') return parseVCards(source.text).map((card) => ({ ...card, bookIds }));
      return rowsToDrafts(source.rows, mapping, { bookIds });
    }, [source, mapping, bookId]);

    const plan = useMemo(
      () => (ready.status === 'ready'
        ? planImport(drafts, ready.cards, { region: ready.region })
        : { fresh: [], duplicates: [] }),
      [drafts, ready],
    );

    // A per-contact decision, falling back to the batch default. `skip` keeps
    // the pre-v1.30 behaviour: a duplicate is held back unless the user says
    // otherwise, so nothing is ever created or merged behind their back.
    const decisionOptions = [
      { value: 'skip', label: t('import.decisionSkip') },
      { value: 'merge', label: t('import.decisionMerge') },
      { value: 'separate', label: t('import.decisionSeparate') },
    ];
    const decisionFor = (entry) => decisions[duplicateKey(entry)] ?? defaultDecision;

    const skipped = plan.duplicates.filter((entry) => decisionFor(entry) === 'skip');
    const merging = plan.duplicates.filter((entry) => decisionFor(entry) === 'merge');
    const separate = plan.duplicates.filter((entry) => decisionFor(entry) === 'separate');
    const toWrite = [...plan.fresh, ...separate.map((entry) => entry.draft), ...merging.map((entry) => entry.draft)];
    const canImport = ready.status === 'ready' && Boolean(bookId) && toWrite.length > 0 && !busy;

    const run = async () => {
      if (!canImport) return;
      setBusy(true);
      try {
        if (source?.kind === 'csv' && remember && isUsableMapping(mapping)) {
          await saveTemplate(api, source.headers, mapping);
        }
        const result = await applyImport(api, toWrite);
        // A merge is not finished here: the pair goes back to the caller, which
        // opens the one review dialog every merge in the plugin goes through.
        close({
          created: result.created,
          failed: result.failed,
          skipped: skipped.length,
          mergeGroups: mergeGroupsFromImport(merging, result.cards),
        });
      } catch (err) {
        setError(t('import.failed', { reason: String(err?.message ?? err) }));
      } finally {
        setBusy(false);
      }
    };

    /** The name to show for an imported draft, the same way the preview does. */
    const draftLabel = (draft) => [draft?.given, draft?.surname].filter(Boolean).join(' ')
      || draft?.fullName || draft?.emails?.[0]?.address || draft?.phones?.[0]?.number || t('import.unnamed');

    const fieldOptions = IMPORT_FIELDS.map((field) => ({ value: field, label: t(`import.field.${field}`) }));

    const mappingSection = () => h(Section, { title: t('import.mapping'), description: t('import.mappingHint') },
      h('div', { 'data-pane': 'mapping', style: PREVIEW_AREA },
        ...source.headers.map((header, index) => h(Field, {
          key: `${header}-${index}`,
          label: header || t('import.unnamed'),
        },
        h(Select, {
          value: mapping[index] ?? 'ignore',
          onChange: (value) => setMapping((current) => current.map((entry, i) => (index === i ? value : entry))),
          options: fieldOptions,
        })))));

    const previewSection = () => h(Section, { title: t('import.preview'), description: t('import.previewHint') },
      h('div', { 'data-pane': 'preview', style: PREVIEW_AREA },
        ...drafts.slice(0, 5).map((draft, index) => h(Stack, { key: `p${index}`, gap: 1 },
          h(Text, null, [draft.given, draft.surname].filter(Boolean).join(' ')
            || draft.fullName || draft.emails[0]?.address || t('import.unnamed')),
          draft.emails.length ? h(Text, { tone: 'muted' }, draft.emails.map((entry) => entry.address).join(', ')) : null,
          draft.phones.length ? h(Text, { tone: 'muted' }, draft.phones.map((entry) => entry.number).join(', ')) : null))),
      drafts.length > 5 ? h(Text, { tone: 'muted' }, t('import.more', { count: drafts.length - 5 })) : null);

    return h(Stack, { gap: 3 },
      h(InfoBar, { tone: 'neutral' }, t('import.notice')),
      ready.status === 'error' ? h(Alert, { tone: 'danger' }, t('import.unavailable')) : null,
      h(Field, { label: t('import.file'), hint: t('import.fileHint') },
        h(Input, { ref: fileRef, type: 'file', accept: '.csv,.vcf,.txt,text/csv,text/vcard', onChange: load })),
      error ? h(Alert, { tone: 'danger' }, error) : null,
      source
        ? h(Stack, { gap: 3 },
            h(Row, { gap: 2, wrap: true },
              h(Badge, { tone: 'neutral' }, t(source.kind === 'vcard' ? 'import.formatVcard' : 'import.formatCsv')),
              h(Text, { tone: 'muted' }, t('import.found', { count: drafts.length }))),
            source.kind === 'csv' ? mappingSection() : null,
            drafts.length ? previewSection() : null,
            h(Field, { label: t('import.target') },
              h(Select, {
                value: bookId,
                onChange: setBookId,
                options: (ready.books ?? []).map((book) => ({ value: book.id, label: book.name || book.id })),
              })),
            plan.duplicates.length
              ? h(Section, { title: t('import.duplicatesTitle'), description: t('import.duplicatesHint') },
                  h(Alert, { tone: 'warning' }, t('import.duplicates', { count: plan.duplicates.length })),
                  h(Field, { label: t('import.defaultDecision') },
                    h(Select, { value: defaultDecision, options: decisionOptions, onChange: setDefaultDecision })),
                  ...plan.duplicates.map((entry) => h(Field, {
                    key: duplicateKey(entry),
                    label: t('import.duplicateLabel', { name: draftLabel(entry.draft) }),
                    hint: t('import.duplicateHint', {
                      match: contactName(entry.match) || entry.match?.id || '',
                      reason: t(REASON_KEYS[entry.reason] ?? 'group.reasonName'),
                    }),
                  },
                    h(Select, {
                      value: decisionFor(entry),
                      options: decisionOptions,
                      onChange: (value) => setDecisions((previous) => ({ ...previous, [duplicateKey(entry)]: value })),
                    }))))
              : null,
            source.kind === 'csv'
              ? h(Checkbox, { checked: remember, label: t('import.remember'), onChange: setRemember })
              : null,
            h(Text, { tone: 'muted' }, t('import.wouldCreate', { count: toWrite.length })))
        : null,
      h(DialogButtons, {
        buttons: [
          { id: 'cancel', label: t('dialog.cancel'), variant: 'secondary' },
          { id: 'import', label: t('import.action'), variant: 'primary', disabled: !canImport, busy },
        ],
        onClick: (id) => { if (id === 'import') void run(); else close(null); },
      }));
  };
}
