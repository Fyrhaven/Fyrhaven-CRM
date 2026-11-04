// The Notes section on a contact's profile (#38, the private half): the notes
// this browser holds about the contact, and a box to add one.
//
// The notes are private by construction — they live in api.storage, never on the
// card — so this section is the only place they can appear.

import { Badge, Button, Card, Field, Row, Section, Stack, Text, Textarea } from '@plugin-host/ui';
import { deleteNote, notesFor, readNotes, saveNote } from './notes.js';
import { parseNote } from './markdown.js';
import { reportError } from './report.js';

export function makeNotesSection(React, api) {
  const { createElement: h, useCallback, useEffect, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function NotesSection({ contact, revision, notes: stored, onChange } = {}) {
    // Controlled when the page hands the note map over: the page then owns the
    // one copy, so a note saved here is searchable at once (#38) and the
    // section never reads the store twice.
    const controlled = stored !== undefined;
    const [own, setOwn] = useState({});
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const contactId = contact?.id ?? '';
    const all = controlled ? stored : own;
    const commit = (next) => {
      if (controlled) onChange?.(next);
      else setOwn(next);
    };

    const load = useCallback(async () => {
      if (controlled) return;
      try {
        setOwn(await readNotes(api));
      } catch {
        setOwn({});
      }
    }, [controlled]);
    useEffect(() => { void load(); }, [load, revision]);

    const notes = notesFor(all, contactId);

    const add = async () => {
      if (!draft.trim()) return;
      setBusy(true);
      try {
        commit(await saveNote(api, contactId, draft));
        setDraft('');
      } catch (err) {
        await reportError(api, t('notes.saveFailed', { reason: String(err?.message ?? err) }));
      } finally {
        setBusy(false);
      }
    };

    const remove = async (note) => {
      try {
        commit(await deleteNote(api, contactId, note.id));
      } catch (err) {
        await reportError(api, t('notes.deleteFailed', { reason: String(err?.message ?? err) }));
      }
    };

    // One element per token, so a note can never become markup.
    const token = (item, key) => {
      if (item.type === 'bold') return h('strong', { key }, item.text);
      if (item.type === 'italic') return h('em', { key }, item.text);
      if (item.type === 'code') return h('code', { key }, item.text);
      if (item.type === 'mention') return h(Badge, { key, tone: 'primary' }, `@${item.text}`);
      return item.text;
    };
    const body = (note) => parseNote(note.text).map((line, index) => (
      h(Text, { key: index }, line.map(token))
    ));

    return h(Section, { title: t('notes.title'), description: t('notes.hint') },
      h(Stack, { gap: 3 },
        h(Field, { label: t('notes.label') },
          h(Textarea, {
            value: draft,
            rows: 3,
            placeholder: t('notes.placeholder'),
            onChange: (event) => setDraft(event.target.value),
          })),
        h(Row, { gap: 2 },
          h(Button, { size: 'sm', busy, onClick: () => void add() }, t('notes.add'))),

        notes.length
          ? notes.map((note) => h(Card, { key: note.id },
              h(Stack, { gap: 1 },
                h(Row, { gap: 2 },
                  h(Text, { tone: 'muted' }, note.at
                    ? new Date(note.at).toLocaleString(api.i18n.getLocale())
                    : t('notes.undated')),
                  h(Button, { size: 'sm', variant: 'ghost', onClick: () => void remove(note) }, t('notes.delete'))),
                ...body(note))))
          : h(Text, { tone: 'muted' }, t('notes.empty'))));
  };
}
