// The Dedicated server dialog (#68, #147): **which** server holds the records,
// and which credential the host attaches to a request.
//
// Two ways in, and they are not the same thing:
//
//   Cloud — the plugin's own service. The address is fixed (a subscriber is not
//     expected to know a hostname), the button says *Sign in*, and the token is
//     the one the website issues after a sign-up. What the plan allows is asked
//     afterwards, from the server, never assumed here.
//   Self-hosted — a server the user runs. They type the address; nothing is
//     assumed about it.
//
// The dialog only returns a *choice*; `actions.js#openServer` performs it. That
// is the rule every dialog here follows, and it matters most here because
// `api.proxy.connect` opens a dialog of the host's own.

import { Button, DialogButtons, Field, Input, Row, Section, Select, Stack, Text } from '@plugin-host/ui';

export function makeServerDialog(React, api) {
  const { createElement: h, useState } = React;
  const t = (key, vars) => api.i18n.t(key, vars);

  return function ServerDialog(props) {
    const state = props?.serverEditor?.state ?? {
      url: '', credentialId: '', mode: 'self', cloudOrigin: '', canConnect: false,
    };
    const [mode, setMode] = useState(state.mode === 'cloud' ? 'cloud' : 'self');
    const [url, setUrl] = useState(state.url ?? '');
    const connected = Boolean(state.url);
    const cloud = mode === 'cloud';

    const submit = () => props.onResult?.({ connect: { url, mode } });
    const disconnect = () => props.onResult?.({ disconnect: true });

    return h(Stack, { gap: 4 },
      h(Text, { tone: 'muted' }, t('server.intro')),

      h(Section, { title: t('server.title'), description: t('server.tokenHint') },
        h(Stack, { gap: 3 },
          h(Field, { label: t('server.mode') },
            h(Select, {
              value: mode,
              onChange: (value) => setMode(value === 'cloud' ? 'cloud' : 'self'),
              options: [
                { value: 'cloud', label: t('server.modeCloud') },
                { value: 'self', label: t('server.modeSelf') },
              ],
            })),

          cloud
            ? h(Text, { tone: 'muted' }, t('server.cloudIntro', { origin: state.cloudOrigin || '' }))
            : h(Field, { label: t('server.address') },
                h(Input, {
                  value: url,
                  placeholder: 'https://crm.example.com',
                  onChange: (event) => setUrl(event.target.value),
                })),

          connected
            ? h(Text, { tone: 'muted' }, t('server.connected', { url: state.url }))
            : h(Text, { tone: 'muted' }, t('server.localOnly')),
          state.canConnect ? null : h(Text, { tone: 'muted' }, t('server.noConnect')))),

      h(Row, { gap: 2, wrap: true },
        h(Button, {
          disabled: !state.canConnect || (!cloud && !url.trim()),
          onClick: submit,
        }, cloud ? t('server.signIn') : t('server.connect')),
        connected
          ? h(Button, { variant: 'secondary', icon: 'x', onClick: disconnect }, t('server.disconnect'))
          : null),

      h(DialogButtons, {
        buttons: [{ id: 'close', label: t('server.close'), variant: 'secondary' }],
        onClick: () => props.onResult?.(null),
      }));
  };
}
