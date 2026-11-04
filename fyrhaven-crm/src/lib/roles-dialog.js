// The roles dialog (#23): per-address-book roles — the advisory half. Opened
// from the Duplicates page; saves to api.storage through lib/book-roles.js.
//
// The host enforces nothing here, so the dialog says so: a role is a local
// convention the team agrees on, shown back on the pages by disabling the
// actions it does not allow. It is stored per browser, like the policies.

import {
  Button, DialogButtons, Section, Segmented, Stack, Text,
} from '@plugin-host/ui';
import { DEFAULT_ROLE, ROLES, readRoles, writeRoles } from './book-roles.js';
import { reportError } from './report.js';

export function makeRolesDialog(React, api) {
  const { createElement: h, useEffect, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function RolesDialog(props) {
    const books = Array.isArray(props.books) ? props.books : [];
    const [roles, setRoles] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
      readRoles(api)
        .then((read) => { setRoles(read); setLoading(false); })
        .catch(async (err) => {
          // Say so. A dialog showing empty roles that the user then saves would
          // overwrite the real ones.
          setLoading(false);
          await reportError(api, t('roles.loadFailed', { reason: String(err?.message ?? err) }));
        });
    }, []);

    const close = (value) => props.onResult?.(value);
    const roleFor = (bookId) => (ROLES.includes(roles[bookId]) ? roles[bookId] : DEFAULT_ROLE);

    const setRole = (bookId, role) => setRoles({ ...roles, [bookId]: role });

    const options = ROLES.map((role) => ({ value: role, label: t(`roles.role.${role}`) }));

    const save = async () => {
      setSaving(true);
      try {
        await writeRoles(api, roles);
        close({ saved: true });
      } catch (err) {
        // A save that did not happen must not look like one that did.
        setSaving(false);
        await reportError(api, t('roles.saveFailed', { reason: String(err?.message ?? err) }));
      }
    };

    if (loading) return h(Stack, { gap: 3 }, h(Text, null, '…'));

    return h(Stack, { gap: 4 },
      h(Text, { tone: 'muted' }, t('roles.intro')),
      h(Text, { tone: 'muted' }, t('roles.advisory')),

      books.length ? h(Section, { title: t('roles.booksSection') },
        h(Stack, { gap: 3 },
          ...books.map((book) => h(Stack, { key: book.id, gap: 1 },
            h(Text, { weight: 'semibold' }, book.name || book.id),
            h(Segmented, {
              label: t('roles.roleLabel'),
              value: roleFor(book.id),
              options,
              onChange: (value) => setRole(book.id, value),
            }),
            h(Text, { tone: 'muted' }, t(`roles.hint.${roleFor(book.id)}`)),
          )),
        ),
      ) : h(Text, { tone: 'muted' }, t('roles.noBooks')),

      h(DialogButtons, {
        buttons: [
          { id: 'cancel', label: t('dialog.cancel'), variant: 'secondary' },
          { id: 'save', label: t('roles.save'), variant: 'primary', disabled: saving },
        ],
        onClick: (id) => { if (id === 'save') save(); else close(null); },
      }),
    );
  };
}
