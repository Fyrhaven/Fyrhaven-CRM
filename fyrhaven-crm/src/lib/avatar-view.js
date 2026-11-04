// The avatar element: a plain <img>, hidden the moment it fails to load.
//
// Plugin-owned rather than a kit component, for the same reason as the page
// skeleton — a missing, blocked or refused image has to simply disappear, and
// that is behaviour this plugin must control rather than assume. A sandbox
// content policy that forbids the request is indistinguishable from "this
// contact has no picture", and both end as nothing at all.
//
// `loading="lazy"` is not decoration: with Gravatar on, a long address book
// would otherwise fire one request per row the moment the page opens.

import { AVATAR } from './layout.js';

export function makeAvatar(React) {
  const { createElement: h, useState } = React;

  return function Avatar({ avatar, size = 32 }) {
    const [failed, setFailed] = useState(false);
    if (!avatar?.url || failed) return null;
    return h('img', {
      src: avatar.url,
      alt: '',
      width: size,
      height: size,
      loading: 'lazy',
      decoding: 'async',
      // No referrer: the webmail's URL is nobody's business but the user's.
      referrerPolicy: 'no-referrer',
      'data-avatar': avatar.source,
      onError: () => setFailed(true),
      style: { ...AVATAR, width: `${size}px`, height: `${size}px` },
    });
  };
}
