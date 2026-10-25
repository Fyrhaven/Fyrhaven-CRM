// Choosing what to export and in which format.
//
// It only collects the choice: the page holds the cards, so the page builds the
// file. That keeps this dialog from having to carry a whole address book
// through the host.

import { Button, DialogButtons, Field, InfoBar, Row, Select, Stack, Text, Textarea } from '@plugin-host/ui';

export function makeExportDialog(React, api) {
  const { createElement: h, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  // The result: a sandbox without `allow-downloads` refuses the file, so the
  // text is shown to copy instead of reported as a success that never happened.
  const Result = ({ name, body }) => {
    const [state, setState] = useState('');
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(body);
        api.toast.success(t('export.copied'));
      } catch {
        setState(t('export.copyFailed'));
      }
    };
    return h(Stack, { gap: 3 },
      h(InfoBar, { tone: 'warning' }, t('export.blocked', { name })),
      h(Textarea, { readOnly: true, rows: 12, value: body, 'aria-label': t('export.resultTitle') }),
      state ? h(Text, { tone: 'danger' }, state) : null,
      h(Row, { gap: 2 },
        h(Button, { icon: 'copy', onClick: () => void copy() }, t('export.copy')),
        h(Button, {
          variant: 'secondary',
          icon: 'download',
          onClick: () => downloadBlob(new Blob([body], { type: 'text/plain' }), name),
        }, t('export.tryDownload'))),
      h(DialogButtons, {
        buttons: [{ id: 'close', label: t('dialog.cancel'), variant: 'secondary' }],
        onClick: () => props.onResult?.(null),
      }));
  };

  return function ExportDialog(props) {
    if (props.exportResult) return h(Result, props.exportResult);
    const setup = props.exportSelection ?? {};
    const selected = Number(setup.selected) || 0;
    const shown = Number(setup.shown) || 0;

    // the selection is the narrower choice, so it is the one to start on
    const [scope, setScope] = useState(() => (selected ? 'selected' : 'shown'));
    const [format, setFormat] = useState('vcard');
    const close = (value) => props.onResult?.(value);

    const count = scope === 'selected' ? selected : shown;

    return h(Stack, { gap: 3 },
      h(InfoBar, { tone: 'neutral' }, t('export.notice', { count })),
      h(Field, { label: t('export.scope') },
        h(Select, {
          value: scope,
          onChange: setScope,
          options: [
            { value: 'selected', label: t('export.scope.selected', { count: selected }), disabled: !selected },
            { value: 'shown', label: t('export.scope.shown', { count: shown }), disabled: !shown },
          ],
        })),
      h(Field, { label: t('export.format'), hint: t('export.formatHint') },
        h(Select, {
          value: format,
          onChange: setFormat,
          options: [
            { value: 'vcard', label: t('export.format.vcard') },
            { value: 'csv', label: t('export.format.csv') },
          ],
        })),
      h(DialogButtons, {
        buttons: [
          { id: 'cancel', label: t('dialog.cancel'), variant: 'secondary' },
          { id: 'export', label: t('export.action'), variant: 'primary', disabled: !count },
        ],
        onClick: (id) => { if (id === 'export') close({ scope, format }); else close(null); },
      }));
  };
}
