// The cleanup dialog: what a normalisation would change, before it changes it.
//
// The host passes api.ui.openDialog's `extraProps` as props — `{ normalise:
// { cards, region } }` — plus `onResult(value)`, which resolves to
// `{ plan, region }` or null when cancelled.
//
// It computes the plan itself and shows every change, so the user approves the
// exact edits rather than a promise. Nothing is written from here: the page
// applies the plan through src/lib/normalise.js.

import {
  Badge, DialogButtons, Field, InfoBar, Row, Section, Select, Stack, Text,
} from '@plugin-host/ui';
import { REGIONS } from './phones.js';
import { planCounts, planNormalisation } from './normalise.js';
import { writeRegion } from './region.js';
import { PREVIEW_AREA } from './layout.js';

export function makeNormaliseDialog(React, api) {
  const { createElement: h, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function NormaliseDialog(props) {
    const setup = props.normalise ?? {};
    const cards = Array.isArray(setup.cards) ? setup.cards : [];

    const [region, setRegion] = useState(() => setup.region ?? '');
    const [busy, setBusy] = useState(false);

    const close = (value) => props.onResult?.(value);
    const plan = planNormalisation(cards, { region });
    const counts = planCounts(plan);

    const apply = async () => {
      if (!plan.length || busy) return;
      setBusy(true);
      try {
        await writeRegion(api, region);
      } finally {
        setBusy(false);
      }
      close({ plan, region });
    };

    return h(Stack, { gap: 3 },
      h(InfoBar, { tone: 'neutral' }, t('cleanup.notice', { count: cards.length })),
      h(Field, { label: t('cleanup.region'), hint: t('cleanup.regionHint') },
        h(Select, {
          value: region,
          onChange: setRegion,
          options: [
            { value: '', label: t('cleanup.regionNone') },
            ...REGIONS.map((entry) => ({ value: entry.code, label: `${entry.name} (+${entry.dial})` })),
          ],
        })),
      plan.length
        ? h(Section, {
            title: t('cleanup.previewTitle'),
            description: t('cleanup.summary', counts),
          },
          h('div', { 'data-pane': 'cleanup-list', style: PREVIEW_AREA },
            ...plan.map((item) => h(Stack, { key: item.id, gap: 1 },
              h(Text, null, item.name),
              ...item.changes.map((change) => h(Row, { key: `${item.id}-${change.field}-${change.from}`, gap: 2, wrap: true },
                h(Badge, { tone: 'neutral' }, t(`cleanup.field.${change.field}`)),
                h(Text, { tone: 'muted' }, change.from),
                h(Text, null, '→'),
                h(Text, null, change.to)))))))
        : h(InfoBar, { tone: 'success' }, t('cleanup.nothing', { count: cards.length })),
      h(DialogButtons, {
        buttons: [
          { id: 'cancel', label: t('dialog.cancel'), variant: 'secondary' },
          { id: 'apply', label: t('cleanup.apply'), variant: 'primary', disabled: !plan.length, busy },
        ],
        onClick: (id) => { if (id === 'apply') void apply(); else close(null); },
      }));
  };
}
