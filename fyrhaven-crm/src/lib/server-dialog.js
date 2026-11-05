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
    const [licence, setLicence] = useState('');
    const [code, setCode] = useState('');
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

      // The licence (#148): the installation key is what the operator takes to
      // the website, and everything else here is the server's own answer — this
      // dialog never decides whether a licence is valid.
      connected && !cloud
        ? h(Section, { title: t('server.licenceTitle'), description: t('server.licenceHint') },
            h(Stack, { gap: 3 },
              h(Text, null, t('server.fingerprint', { key: state.fingerprint || '—' })),
              h(Text, { tone: 'muted' }, state.licensed
                ? t('server.licensed', { summary: state.summary || '' })
                : t('server.unlicensed')),
              state.challenge
                ? h(Stack, { gap: 2 },
                    h(Text, { tone: 'muted' }, t('server.challengeHint')),
                    h('code', null, state.challenge),
                    h(Field, { label: t('server.deactivateCode') },
                      h(Input, { value: code, onChange: (event) => setCode(event.target.value) })),
                    h(Button, { disabled: !code.trim(), onClick: () => props.onResult?.({ deactivate: code }) },
                      t('server.deactivateApply')))
                : h(Field, { label: t('server.licenceField') },
                    h(Input, { value: licence, onChange: (event) => setLicence(event.target.value) })),
              h(Row, { gap: 2, wrap: true },
                state.challenge
                  ? null
                  : h(Button, { disabled: !licence.trim(), onClick: () => props.onResult?.({ licence }) },
                      t('server.installLicence')),
                state.licensed && !state.challenge
                  ? h(Button, { variant: 'secondary', onClick: () => props.onResult?.({ challenge: true }) },
                      t('server.release'))
                  : null)))
        : null,

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
