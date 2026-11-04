// CSV parsing: the quoting rules that break a naive reader.
import { describe, expect, it } from 'vitest';
import { alignRow, detectDelimiter, parseCsv, parseRows } from '../src/lib/csv.js';

describe('detectDelimiter', () => {
  it('picks the one the first line uses most', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('a|b|c')).toBe('|');
  });

  it('ignores the ones inside quotes', () => {
    expect(detectDelimiter('"a,b,c,d";x')).toBe(';');
  });

  it('skips the blank lines a spreadsheet leaves behind', () => {
    expect(detectDelimiter('\n\n  \na;b')).toBe(';');
  });

  it('falls back to a comma', () => {
    expect(detectDelimiter('')).toBe(',');
    expect(detectDelimiter('single')).toBe(',');
  });
});

describe('parseRows', () => {
  it('splits plain rows', () => {
    expect(parseRows('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('keeps a comma inside quotes', () => {
    expect(parseRows('"Smith, John",ada@x.de')).toEqual([['Smith, John', 'ada@x.de']]);
  });

  it('keeps a newline inside quotes', () => {
    expect(parseRows('"line one\nline two",x')).toEqual([['line one\nline two', 'x']]);
  });

  it('reads a doubled quote as one quote', () => {
    expect(parseRows('"He said ""hi""",x')).toEqual([['He said "hi"', 'x']]);
  });

  it('takes CRLF and a byte-order mark', () => {
    expect(parseRows('\uFEFFa,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('keeps empty fields, and a trailing empty one', () => {
    expect(parseRows('a,,c,')).toEqual([['a', '', 'c', '']]);
  });

  it('does not invent a row for a file that ends without a newline', () => {
    expect(parseRows('a,b')).toEqual([['a', 'b']]);
    expect(parseRows('a,b\n')).toEqual([['a', 'b']]);
  });

  it('survives junk', () => {
    expect(parseRows('')).toEqual([]);
    expect(parseRows(null)).toEqual([]);
  });
});

describe('parseCsv', () => {
  it('returns the headers and the rows', () => {
    const parsed = parseCsv('Name,E-mail\n"Smith, John",john@x.de\n');

    expect(parsed.delimiter).toBe(',');
    expect(parsed.headers).toEqual(['Name', 'E-mail']);
    expect(parsed.rows).toEqual([['Smith, John', 'john@x.de']]);
  });

  it('trims the header cells, which spreadsheets pad', () => {
    expect(parseCsv(' Name , E-mail \nx,y').headers).toEqual(['Name', 'E-mail']);
  });

  it('drops blank lines rather than counting them as contacts', () => {
    expect(parseCsv('Name\n\nada\n\n').rows).toEqual([['ada']]);
  });

  it('takes a delimiter it was told to use', () => {
    expect(parseCsv('a|b\n1|2', { delimiter: '|' }).headers).toEqual(['a', 'b']);
  });

  it('has nothing for an empty file', () => {
    expect(parseCsv('')).toEqual({ delimiter: ',', headers: [], rows: [] });
  });
});

describe('alignRow', () => {
  it('pads a short row and trims a long one to the header count', () => {
    expect(alignRow(['a'], 3)).toEqual(['a', '', '']);
    expect(alignRow(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
    expect(alignRow(null, 2)).toEqual(['', '']);
  });
});
