// Which build this is.
//
// The source tree in this repository is the **cloud** build: the shop, the
// accounts, the catalogue, the Stripe webhook and the operator panel. It is
// never distributed.
//
// `scripts/dist.mjs` emits the **self-hosted** build, and rewrites this file to
// say `'selfhosted'` in the copy it ships. That is not decoration: a self-hosted
// server must not be one environment variable away from running as the cloud
// service, and a constant that is compiled into the artifact cannot be set by
// whoever holds the artifact.
export const DISTRIBUTION = 'cloud';

/** The surfaces a build serves. The self-hosted build serves none of these. */
export const SURFACES = {
  cloud: { shop: true, accounts: true, admin: true, billing: true, issuing: true },
  selfhosted: { shop: false, accounts: false, admin: false, billing: false, issuing: false },
};

export const surfaceFor = (distribution = DISTRIBUTION) =>
  SURFACES[distribution === 'cloud' ? 'cloud' : 'selfhosted'];
