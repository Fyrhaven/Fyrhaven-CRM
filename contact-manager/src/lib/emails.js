// Email addresses: is the syntax usable, and is this a role address or a
// throwaway? Pure: no api, no DOM.
//
// The plugin never *rejects* an address for being a role address or a
// disposable domain — plenty of legitimate contacts are `info@`. They are
// warnings, so a user can see why a contact looks odd without being blocked.

/**
 * Role addresses belong to a function, not a person, so they are poor
 * deduplication anchors: two companies both have `info@`. Compared on the
 * local part only.
 */
export const ROLE_LOCAL_PARTS = [
  'abuse', 'accounting', 'accounts', 'admin', 'billing', 'careers', 'contact',
  'customerservice', 'enquiries', 'finance', 'help', 'hello', 'hr', 'info',
  'inquiries', 'jobs', 'legal', 'mail', 'marketing', 'media', 'newsletter',
  'no-reply', 'noreply', 'office', 'orders', 'post', 'postmaster', 'press',
  'privacy', 'reception', 'sales', 'security', 'service', 'support', 'team',
  'webmaster',
];

/** A small set of well-known throwaway domains. Not exhaustive by design. */
export const DISPOSABLE_DOMAINS = [
  '10minutemail.com', '20minutemail.com', 'discard.email', 'dispostable.com',
  'emailondeck.com', 'fakeinbox.com', 'getnada.com', 'guerrillamail.com',
  'maildrop.cc', 'mailinator.com', 'mailnesia.com', 'sharklasers.com',
  'temp-mail.org', 'tempmail.com', 'throwawaymail.com', 'trashmail.com',
  'yopmail.com',
];

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** The domain of an address, lower-cased, or ''. */
export const emailDomain = (address) => text(address).split('@')[1]?.toLowerCase() ?? '';

/** The local part of an address, lower-cased, or ''. */
export const emailLocalPart = (address) => text(address).split('@')[0]?.toLowerCase() ?? '';

/**
 * Usable syntax: one `@`, a non-empty local part, and a dotted domain whose
 * labels are neither empty nor over 63 characters. Stricter than "contains an
 * @" and looser than RFC 5322, which is the useful middle for a contact book.
 */
export function isEmailSyntax(address) {
  const value = text(address);
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@')) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!local || local.length > 64 || /\s/.test(local)) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  return labels.every((label) => label.length > 0 && label.length <= 63 && /^[a-z0-9-]+$/i.test(label)
    && !label.startsWith('-') && !label.endsWith('-'));
}

/** True for a function address such as `info@` — a warning, never a rejection. */
export function isRoleAddress(address) {
  const local = emailLocalPart(address);
  if (!local) return false;
  const base = local.split('+')[0];
  return ROLE_LOCAL_PARTS.includes(base) || base.startsWith('no-reply') || base.startsWith('noreply');
}

/** True for a known throwaway domain — a warning, never a rejection. */
export function isDisposableAddress(address) {
  const domain = emailDomain(address);
  return Boolean(domain) && DISPOSABLE_DOMAINS.includes(domain);
}

/**
 * Everything worth saying about one address, in one call.
 * `syntax` is a blocking problem; `role` and `disposable` are warnings.
 */
export function inspectEmail(address) {
  return {
    syntax: isEmailSyntax(address),
    role: isRoleAddress(address),
    disposable: isDisposableAddress(address),
    domain: emailDomain(address),
  };
}
