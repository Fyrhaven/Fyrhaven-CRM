// The Cloud server dialog (#68): point the plugin at a Contact Manager server
// and connect the workspace token, which the **host** keeps.
//
// The dialog reads and returns a *choice*; `actions.js` performs it. That is the
// rule every dialog here follows — a dialog that wrote would be a second place
// where state changes, and `api.proxy.connect` opens a dialog of the host's own,
// which is exactly the thing this dialog must not try to do itself.
//
// Nothing about the token passes through here: the user types the address, the
// host asks for the token, and the plugin only ever learns *where* the server is.

import { Button, DialogButtons, Field, Input, Row, Section, Stack, Text } from '@plugin-host/ui';

export function makeServerDialog(React, api) {
  const { createElement: h, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function ServerDialog(props) {
    const state = props?.serverEditor?.state ?? { url: '', credentialId: '', canConnect: false };
    const [url, setUrl] = useState(state.url ?? '');
    const connected = Boolean(state.url);
    const submit = () => props.onResult?.({ connect: { url } });
    const disconnect = () => props.onResult?.({ disconnect: true });

    return h(Stack, { gap: 4 },
      h(Text, { tone: 'muted' }, t('server.intro')),

      h(Section, { title: t('server.title'), description: t('server.tokenHint') },
        h(Stack, { gap: 3 },
          h(Field, { label: t('server.address') },
            h(Input, {
              value: url,
              placeholder: 'https://crm.example.com',
              onChange: (event) => setUrl(event.target.value),
            })),
          connected
            ? h(Text, { tone: 'muted' }, t('server.connected', { url: state.url }))
            : h(Text, { tone: 'muted' }, t('server.localOnly')),
          state.canConnect
            ? null
            : h(Text, { tone: 'muted' }, t('server.noConnect')))),

      h(Row, { gap: 2, wrap: true },
        h(Button, { disabled: !url.trim() || !state.canConnect, onClick: submit }, t('server.connect')),
        connected
          ? h(Button, { variant: 'secondary', icon: 'x', onClick: disconnect }, t('server.disconnect'))
          : null),

      h(DialogButtons, {
        buttons: [{ id: 'close', label: t('server.close'), variant: 'secondary' }],
        onClick: () => props.onResult?.(null),
      }));
  };
}
