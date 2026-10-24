// Contacts to vCard, for the bulk export. vCard 3.0 (RFC 2426) rather than 4.0:
// it is what address books, phones and desktop clients import without
// complaint, and nothing here needs a 4.0-only feature.
//
// Pure: no api, no DOM, no clock. One VCARD per contact, CRLF line endings as
// the format requires, and text values escaped per the RFC.

import {
  contactName, emailEntries, linkUris, nicknameLine, notesLine, orgName, phoneEntries, titleName,
} from './contacts.js';

/** RFC 2426 TEXT escaping: backslash, semicolon, comma, and newlines as \n. */
const escapeText = (value) => String(value ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/;/g, '\\;')
  .replace(/,/g, '\\,')
  .replace(/\r\n|\r|\n/g, '\\n');

/**
 * A structured value (N, ADR): each component is escaped on its own and the
 * components are joined with `;`. Escaping the joined string instead would
 * escape the separators and destroy the structure.
 */
const structured = (parts) => parts.map((part) => escapeText(part)).join(';');

/** A property only when it has something to say. */
const line = (name, value, params = '') => {
  const text = String(value ?? '').trim();
  return text ? [`${name}${params}:${escapeText(text)}`] : [];
};

/**
 * The first address as ADR components: box, extended, street, locality, region,
 * postcode, country. `null` when the card has no address.
 */
function addressParts(card) {
  const address = Object.values(card?.addresses ?? {})[0];
  if (!address) return null;
  return [address.poBox, address.extended, address.street, address.locality, address.region, address.postcode, address.country]
    .map((part) => part ?? '');
}

/**
 * Best-effort N from a display name: the last token is the family name and the
 * rest the given name. A one-word name has no family part. vCard 3.0 importers
 * expect N, and this plugin has no structured name to read it from.
 */
function nameParts(displayName) {
  const tokens = String(displayName ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return { given: tokens.join(' '), family: '' };
  return { given: tokens.slice(0, -1).join(' '), family: tokens.at(-1) };
}

/** One contact as a VCARD block, or '' when it has nothing worth exporting. */
export function cardToVCard(card) {
  const name = contactName(card);
  const { given, family } = nameParts(name);
  const emails = emailEntries(card);
  const phones = phoneEntries(card);
  const address = addressParts(card);

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    // N is family;given;middle;prefix;suffix — a structured value, so each part
    // is escaped on its own rather than as one text.
    `N:${structured([family, given, '', '', ''])}`,
    ...line('FN', name),
    ...line('NICKNAME', nicknameLine(card)),
    ...line('ORG', orgName(card)),
    ...line('TITLE', titleName(card)),
    ...emails.flatMap((entry) => line('EMAIL', entry.address, entry.pref ? ';TYPE=PREF' : ';TYPE=OTHER')),
    ...phones.flatMap((entry) => line('TEL', entry.number, entry.pref ? ';TYPE=PREF' : ';TYPE=OTHER')),
    ...(address ? [`ADR;TYPE=OTHER:${structured(address)}`] : []),
    ...linkUris(card).flatMap((uri) => line('URL', uri)),
    ...line('NOTE', notesLine(card)),
    'END:VCARD',
  ];

  // A card with only a name and nothing else is still worth exporting; a card
  // with nothing at all (no name, no address) is not.
  const hasContent = lines.length > 7;
  return hasContent || name ? lines.join('\r\n') + '\r\n' : '';
}

/** Every contact as one .vcf file body, in the order given. */
export function contactsToVCard(cards) {
  return (Array.isArray(cards) ? cards : [])
    .map(cardToVCard)
    .filter(Boolean)
    .join('');
}
