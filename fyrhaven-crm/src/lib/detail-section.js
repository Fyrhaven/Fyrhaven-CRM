// The contact-detail-section slot: a "duplicate check" block in the open
// contact's details, based on api.contacts.search — a quick hint plus a
// button that opens the shared review dialog for the group found.

import { Stack, Heading, Text, Button, Row, Badge } from '@plugin-host/ui';
import { policyAwareOptions } from './book-policies.js';
import { findGroupFor } from './duplicates.js';
import { memberLabel, reasonLine, strengthKey, toastMergeResult } from './labels.js';
import { openEditor, toastEditorResult } from './open-editor.js';

export function makeDuplicateSection(React, api) {
  const { createElement: h, useCallback, useEffect, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function DuplicateSection(props) {
    const contact = props.contact ?? null;
    const [state, setState] = useState({ status: 'checking', group: null, reason: '' });
    const [run, setRun] = useState(0);

    const check = useCallback(async () => {
      if (!contact) {
        setState({ status: 'none', group: null, reason: '' });
        return;
      }
      setState({ status: 'checking', group: null, reason: '' });
      try {
        const group = await findGroupFor(api, contact, await policyAwareOptions(api));
        setState({ status: group ? 'found' : 'none', group, reason: '' });
      } catch (err) {
        setState({ status: 'error', group: null, reason: String(err?.message ?? err) });
      }
    }, [contact?.id, run]);

    useEffect(() => {
      void check();
    }, [check]);

    const review = async () => {
      if (!state.group) return;
      const result = await api.ui.openDialog({
        title: t('dialog.title'),
        slot: 'plugin-dialog',
        extraProps: { groups: [state.group] },
      });
      toastMergeResult(api, result);
      if (result) setRun((n) => n + 1); // the dupes are gone — check again
    };

    const edit = async () => {
      if (!contact) return;
      toastEditorResult(api, await openEditor(api, { mode: 'edit', contact }));
      setRun((n) => n + 1); // the saved card may have gained or lost duplicates
    };

    return h(Stack, { gap: 2 },
      h(Heading, { level: 4 }, t('detail.title')),
      state.status === 'checking' ? h(Text, { tone: 'muted' }, t('detail.checking')) : null,
      state.status === 'none' ? h(Text, { tone: 'muted' }, t('detail.none')) : null,
      state.status === 'error' ? h(Text, { tone: 'muted' }, t('detail.failed', { reason: state.reason })) : null,
      state.status === 'found' && state.group
        ? h(Stack, { gap: 2 },
            h(Row, { gap: 2 },
              h(Badge, { tone: state.group.strength === 'strong' ? 'success' : 'warning' },
                t('detail.found', { count: state.group.members.length - 1 })),
              h(Text, { tone: 'muted' }, reasonLine(t, state.group))),
            ...state.group.members.map((member) =>
              h(Text, { key: member.id, tone: 'muted' }, memberLabel(member))),
            h(Row, { gap: 2 },
              h(Button, { size: 'sm', icon: 'git-merge', onClick: () => void review() }, t('detail.review')),
              h(Button, { size: 'sm', variant: 'secondary', icon: 'edit', onClick: () => void edit() },
                t('detail.edit'))))
        : null);
  };
}
