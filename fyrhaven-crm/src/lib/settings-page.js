// The Settings sub-page: where the plugin's own configuration lives, in one place
// instead of scattered over the Overview menu.
//
// Two kinds of setting, and the difference matters:
//
//   *The webmail's* — everything declared in `settingsSchema` (enabled, gravatar,
//   the undo window, the digest, the save-time warning). The **host** draws those
//   in Settings → Plugins, per user; this page links to them rather than drawing a
//   second copy, because two forms over one value is how they disagree.
//
//   *This plugin's own* — the server the records live on, its licence, and the
//   phone region. Those have no home in the host's UI, so they live here.
//
// The server half is **installation configuration**, not a preference: a normal
// user must not be able to point the whole company's records at another server.
// It is therefore gated by `configSchema.allowServerConfig`, which an
// administrator sets once for the installation (`admin:config`).

import { Badge, Button, Card, Row, Section, Stack, Text } from '@plugin-host/ui';
import { licenceInfo } from './remote.js';
import { readRegion, writeRegion } from './region.js';
import { openServer } from './actions.js';

export function makeSettingsPage(React, api) {
  const { createElement: h, useCallback, useEffect, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function SettingsPage({ onDataChanged } = {}) {
    const [state, setState] = useState({ status: 'loading', url: '', mode: 'self', fingerprint: '', licensed: false, summary: '' });
    const [region, setRegion] = useState('');

    // An administrator can lock the connection settings for the whole
    // installation; without the flag (or without `admin:config`), a user may.
    const managed = api.plugin?.config?.allowServerConfig === false;

    const load = useCallback(async () => {
      const info = await licenceInfo(api).catch(() => ({ status: 'failed' }));
      setState({
        status: info.status,
        url: info.status === 'ok' ? String(await readUrl()) : '',
        mode: info.mode ?? 'self',
        fingerprint: info.fingerprint ?? '',
        licensed: info.licensed === true,
        summary: info.summary ?? '',
      });
    }, []);

    const readUrl = async () => (await api.storage.get('remoteUrl')) ?? '';

    useEffect(() => {
      void load();
      readRegion(api).then(setRegion).catch(() => setRegion(''));
    }, [load]);

    // The region is what makes a national number match its international
    // spelling; without it, matching falls back to digits alone.
    const saveRegion = async (value) => {
      const clean = await writeRegion(api, value);
      setRegion(clean);
      api.toast?.success?.(t('settings.regionSaved', { region: clean || t('settings.regionNone') }));
      onDataChanged?.();
    };

    const open = async () => {
      await openServer(api);
      await load();
      onDataChanged?.();
    };

    return h(Stack, { gap: 4 },
      h(Section, { title: t('settings.serverTitle'), description: t('settings.serverHint') },
        h(Card, null,
          h(Stack, { gap: 2 },
            h(Row, { gap: 2, wrap: true },
              h(Badge, { tone: state.url ? 'primary' : 'neutral' },
                state.url ? t('settings.connected') : t('settings.localOnly')),
              state.url ? h(Text, { tone: 'muted' }, state.url) : null,
              state.licensed ? h(Badge, { tone: 'primary' }, t('settings.licensed')) : null),
            state.url ? h(Text, { tone: 'muted' }, t('settings.fingerprint', { key: state.fingerprint || '—' })) : null,
            state.licensed ? h(Text, { tone: 'muted' }, t('settings.summary', { summary: state.summary })) : null,
            managed
              ? h(Text, { tone: 'muted' }, t('settings.managed'))
              : h(Row, { gap: 2 },
                  h(Button, { size: 'sm', icon: 'cloud', onClick: () => void open() }, t('settings.openServer'))),
            managed ? null : h(Text, { tone: 'muted' }, t('settings.serverHintLong'))))),

      h(Section, { title: t('settings.preferencesTitle'), description: t('settings.preferencesHint') },
        h(Stack, { gap: 2 },
          h(Text, { tone: 'muted' }, t('settings.preferencesWhere')),
          h(Field, { label: t('settings.region'), hint: t('settings.regionHint') },
            h(Input, {
              value: region,
              placeholder: '+46',
              onChange: (event) => setRegion(event.target.value.toUpperCase()),
              onBlur: (event) => void saveRegion(event.target.value),
            })),
          h(Text, { tone: 'muted' }, t('settings.regionNote')))),

      h(Section, { title: t('settings.aboutTitle') },
        h(Text, { tone: 'muted' }, t('settings.aboutBody', { version: api.plugin?.version ?? '' }))));
  };
}
