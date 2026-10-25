// Choosing what to export and in which format.
//
// It only collects the choice: the page holds the cards, so the page builds the
// file. That keeps this dialog from having to carry a whole address book
// through the host.

import { DialogButtons, Field, InfoBar, Select, Stack } from '@plugin-host/ui';

export function makeExportDialog(React, api) {
  const { createElement: h, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function ExportDialog(props) {
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
