// Writing contacts out as CSV or vCard.
//
// Pure: no api, no DOM. The file is built here and the caller downloads it.
//
// The CSV headers are deliberately the spellings `guessMapping` recognises, so
// a file exported here and imported back needs no column work at all — that
// round trip is what `test/export.test.mjs` pins.

import { contactName, emailEntries, nicknameLine, notesLine, orgName, phoneEntries, titleName } from './contacts.js';
import { toCsv } from './csv.js';
import { contactsToVCard } from './vcard.js';

/** The columns of an exported CSV, in order, with the header each one writes. */
export const CSV_COLUMNS = [
  { field: 'given', header: 'Given Name' },
  { field: 'surname', header: 'Family Name' },
  { field: 'name', header: 'Name' },
  { field: 'nickname', header: 'Nickname' },
  { field: 'organization', header: 'Organization' },
  { field: 'title', header: 'Title' },
  { field: 'notes', header: 'Notes' },
  { field: 'tags', header: 'Tags' },
  { field: 'street', header: 'Street' },
  { field: 'locality', header: 'City' },
  { field: 'region', header: 'Region' },
  { field: 'postcode', header: 'Postal Code' },
  { field: 'country', header: 'Country' },
];

const nameParts = (card) => {
  const components = card?.name?.components;
  const parts = Array.isArray(components) ? components : Object.values(components ?? {});
  const value = (kind) => parts.filter((part) => part?.kind === kind).map((part) => String(part.value ?? '')).join(' ').trim();
  return { given: value('given'), surname: value('surname') };
};

const firstAddress = (card) => Object.values(card?.addresses ?? {})[0] ?? {};

/**
 * The CSV: one header row, then one row per contact.
 *
 * Email and phone columns are as wide as the widest contact, so nobody's second
 * address is silently dropped. A contact with fewer is padded with blanks.
 */
export function contactsToCsv(cards) {
  const list = (Array.isArray(cards) ? cards : []).filter(Boolean);
  // nothing to export means nothing to write, not a header row
  if (!list.length) return '';
  const emails = list.map((card) => emailEntries(card).map((entry) => String(entry.address ?? '')));
  const phones = list.map((card) => phoneEntries(card).map((entry) => String(entry.number ?? '')));
  const emailWidth = Math.max(0, ...emails.map((entry) => entry.length));
  const phoneWidth = Math.max(0, ...phones.map((entry) => entry.length));

  const headers = [
    ...CSV_COLUMNS.map((column) => column.header),
    ...Array.from({ length: emailWidth }, (_, i) => `E-mail ${i + 1}`),
    ...Array.from({ length: phoneWidth }, (_, i) => `Phone ${i + 1}`),
  ];

  const rows = list.map((card, index) => {
    const parts = nameParts(card);
    const address = firstAddress(card);
    const values = {
      ...parts,
      name: contactName(card),
      nickname: nicknameLine(card),
      organization: orgName(card),
      title: titleName(card),
      notes: notesLine(card),
      tags: Object.keys(card?.keywords ?? {}).filter((tag) => tag !== 'company').join(','),
      street: address.street ?? '',
      locality: address.locality ?? '',
      region: address.region ?? '',
      postcode: address.postcode ?? '',
      country: address.country ?? '',
    };
    return [
      ...CSV_COLUMNS.map((column) => values[column.field] ?? ''),
      ...Array.from({ length: emailWidth }, (_, i) => emails[index][i] ?? ''),
      ...Array.from({ length: phoneWidth }, (_, i) => phones[index][i] ?? ''),
    ];
  });

  return toCsv([headers, ...rows]);
}

/**
 * The contacts as a file of the requested format.
 * @returns {{body: string, name: string, type: string}}
 */
export function contactsToFile(cards, format = 'vcard') {
  const list = (Array.isArray(cards) ? cards : []).filter(Boolean);
  if (format === 'csv') {
    return { body: contactsToCsv(list), name: 'contacts.csv', type: 'text/csv' };
  }
  return { body: contactsToVCard(list), name: 'contacts.vcf', type: 'text/vcard' };
}

