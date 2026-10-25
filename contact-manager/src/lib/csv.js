// CSV, the way a real export writes it: RFC 4180 quoting, embedded newlines,
// doubled quotes, a byte-order mark, and whatever delimiter the file chose.
//
// Pure: no api, no DOM, no file system. The caller hands over text.
//
// The parser is a character scanner rather than a `split`, because the two
// things that break a naive CSV reader are quoted commas and quoted newlines —
// and "Smith, John" in a name column is the common case, not the rare one.

const CANDIDATES = [',', ';', '\t', '|'];

/**
 * The delimiter a file uses, guessed from its first line: whichever candidate
 * appears most often **outside quotes**. Defaults to a comma.
 */
export function detectDelimiter(text) {
  const line = String(text ?? '').split(/\r?\n/).find((row) => row.trim()) ?? '';
  let quoted = false;
  const counts = new Map(CANDIDATES.map((candidate) => [candidate, 0]));
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && counts.has(char)) counts.set(char, counts.get(char) + 1);
  }
  let best = ',';
  for (const candidate of CANDIDATES) {
    if (counts.get(candidate) > counts.get(best)) best = candidate;
  }
  return best;
}

/** Every field, as arrays of rows, with quotes and newlines handled. */
export function parseRows(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = String(text ?? '').replace(/^\uFEFF/, '');

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        // a doubled quote inside a quoted field is one quote
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    // CRLF arrives as \r\n; the \r is dropped and the \n ends the row
    if (char !== '\r') field += char;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * A CSV file as `{ delimiter, headers, rows }`. Blank lines are dropped, and
 * the header cells are trimmed — a stray space after a comma is a spreadsheet
 * artefact, not part of the column name.
 */
export function parseCsv(text, { delimiter } = {}) {
  const used = delimiter ?? detectDelimiter(text);
  const all = parseRows(text, used).filter((row) => row.some((cell) => String(cell).trim() !== ''));
  const headers = all.length ? all[0].map((cell) => String(cell).trim()) : [];
  return { delimiter: used, headers, rows: all.slice(1).map((row) => row.map((cell) => String(cell))) };
}

/** One CSV row, padded or trimmed to the header count. */
export function alignRow(row, width) {
  const cells = (Array.isArray(row) ? row : []).map((cell) => String(cell ?? ''));
  while (cells.length < width) cells.push('');
  return cells.slice(0, width);
}
