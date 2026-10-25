// Reading vCard back in, for the import. vCard 3.0 and 4.0 differ in small
// ways (4.0 has no `TYPE=` on the property name and allows grouped properties
// like `item1.EMAIL`), so this accepts both rather than picking a side.
//
// Pure: no api, no DOM. The caller hands over text.
//
// Only the properties the plugin can store are read — the rest are skipped
// rather than guessed at, because writing a wrong value onto a contact is worse
// than leaving one out.

const PROPERTY = /^(?:[^.:;]+\.)?([A-Za-z0-9-]+)((?:;[^:]*)?):(.*)$/;

/** The text of a property value: RFC 2426 escapes undone. */
export function unescapeText(value) {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char !== '\\') {
      out += char;
      continue;
    }
    const next = value[i + 1];
    i += 1;
    if (next === 'n' || next === 'N') out += '\n';
    else if (next === undefined) out += '\\';
    else out += next;
  }
  return out;
}

/** The components of a structured value (N, ADR), unescaped. */
export function splitComponents(value) {
  const parts = [];
  let current = '';
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === '\\' && i + 1 < value.length) {
      current += char + value[i + 1];
      i += 1;
      continue;
    }
    if (char === ';') {
      parts.push(unescapeText(current));
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(unescapeText(current));
  return parts;
}

/** Unfolded lines: a continuation begins with a space or a tab. */
function unfold(text) {
  const lines = String(text ?? '').replace(/\r\n|\r/g, '\n').split('\n');
  const out = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

/** One VCARD block as a draft-shaped record, or `null` when it has nothing. */
function parseBlock(lines) {
  const record = { emails: [], phones: [], tags: [], nickname: '', organization: '', title: '', notes: '', given: '', surname: '', fullName: '', address: {} };
  const addresses = [];

  for (const line of lines) {
    const match = PROPERTY.exec(line);
    if (!match) continue;
    const name = match[1].toUpperCase();
    const value = match[3];
    const type = /TYPE=([^;:]+)/i.exec(match[2] ?? '')?.[1]?.toLowerCase() ?? '';

    if (name === 'FN') record.fullName = unescapeText(value);
    else if (name === 'N') {
      const parts = splitComponents(value);
      record.surname = parts[0] ?? '';
      record.given = parts[1] ?? '';
    } else if (name === 'NICKNAME') record.nickname = splitComponents(value).join(', ');
    else if (name === 'ORG') record.organization = splitComponents(value).filter(Boolean).join(' · ');
    else if (name === 'TITLE') record.title = unescapeText(value);
    else if (name === 'NOTE') record.notes = unescapeText(value);
    else if (name === 'CATEGORIES') record.tags.push(...splitComponents(value).filter(Boolean));
    else if (name === 'EMAIL' && value.trim()) record.emails.push({ address: unescapeText(value).trim(), pref: type === 'pref' });
    else if (name === 'TEL' && value.trim()) record.phones.push({ number: unescapeText(value).trim(), pref: type === 'pref' });
    else if (name === 'ADR') {
      const parts = splitComponents(value);
      addresses.push({
        street: parts[2] ?? '',
        locality: parts[3] ?? '',
        region: parts[4] ?? '',
        postcode: parts[5] ?? '',
        country: parts[6] ?? '',
      });
    }
  }

  const name = record.fullName.trim() || [record.given, record.surname].filter(Boolean).join(' ').trim();
  if (!name && !record.emails.length && !record.phones.length) return null;
  const address = addresses.find((entry) => Object.values(entry).some(Boolean)) ?? {};
  return { ...record, fullName: name, address, tags: [...new Set(record.tags)].join(', ') };
}

/** Every contact in a `.vcf` file, as draft-shaped records. */
export function parseVCards(text) {
  const lines = unfold(text);
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith('BEGIN:VCARD')) {
      current = [];
      continue;
    }
    if (upper.startsWith('END:VCARD')) {
      if (current) blocks.push(current);
      current = null;
      continue;
    }
    if (current) current.push(line);
  }
  return blocks.map(parseBlock).filter(Boolean);
}

/** True when the text looks like a vCard rather than a CSV. */
export const looksLikeVCard = (text) => /^\s*(?:\uFEFF)?BEGIN:VCARD/im.test(String(text ?? ''));
