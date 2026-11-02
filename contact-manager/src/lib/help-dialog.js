// The Help dialog (#39): what the plugin does, the search operators, the keyboard
// shortcuts and a short "what's new". Opened from the command palette and the
// Overview menu. It only reads and closes, so it writes nothing.

import { Badge, DialogButtons, List, ListRow, Row, Section, Stack, Text } from '@plugin-host/ui';
import {
  HAS_VALUES, IS_VALUES_LIST, QUERY_EXAMPLES, QUERY_OPERATORS, SHORTCUTS, WHATS_NEW,
} from './help.js';

export function makeHelpDialog(React, api) {
  const { createElement: h } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function HelpDialog(props) {
    const close = () => props.onResult?.(null);

    return h(Stack, { gap: 4 },
      h(Text, { tone: 'muted' }, t('help.intro')),

      h(Section, { title: t('help.searchTitle'), description: t('help.searchHint') },
        h(Stack, { gap: 2 },
          h(Row, { gap: 2, wrap: true },
            ...QUERY_OPERATORS.map((entry) => h(Badge, { key: entry.token, tone: 'neutral' }, entry.token))),
          h(Text, { tone: 'muted' }, t('help.hasValues', { values: HAS_VALUES.join(', ') })),
          h(Text, { tone: 'muted' }, t('help.isValues', { values: IS_VALUES_LIST.join(', ') })),
          h(Text, { weight: 'semibold' }, t('help.examples')),
          ...QUERY_EXAMPLES.map((example) => h(Text, { key: example }, h('code', null, example))))),

      h(Section, { title: t('help.shortcutsTitle') },
        h(List, { label: t('help.shortcutsTitle') },
          ...SHORTCUTS.map((shortcut) => h(ListRow, {
            key: shortcut.label,
            title: shortcut.keys.join(' + '),
            subtitle: t(shortcut.label),
          })))),

      h(Section, { title: t('help.whatsNewTitle') },
        h(List, { label: t('help.whatsNewTitle') },
          ...WHATS_NEW.map((entry) => h(ListRow, {
            key: entry.version,
            title: t('help.version', { version: entry.version }),
            subtitle: t(entry.note),
          })))),

      h(DialogButtons, {
        buttons: [{ id: 'close', label: t('help.close'), variant: 'primary' }],
        onClick: close,
      }));
  };
}
