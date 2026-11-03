// The tiny inline formatter for private notes (#38). Pure.
import { describe, expect, it } from 'vitest';
import { parseInline, parseNote } from '../src/lib/markdown.js';

const types = (tokens) => tokens.map((token) => `${token.type}:${token.text}`);

describe('parseInline', () => {
  it('returns plain text as one token', () => {
    expect(parseInline('just words')).toEqual([{ type: 'text', text: 'just words' }]);
  });

  it('reads the marks a note actually uses', () => {
    expect(types(parseInline('**bold**'))).toEqual(['bold:bold']);
    expect(types(parseInline('*italic*'))).toEqual(['italic:italic']);
    expect(types(parseInline('_italic_'))).toEqual(['italic:italic']);
    expect(types(parseInline('`code`'))).toEqual(['code:code']);
    expect(types(parseInline('@ada'))).toEqual(['mention:ada']);
  });

  it('reads a sentence around the marks', () => {
    expect(types(parseInline('Ask **Ada** and @ada about `the engine`')))
      .toEqual(['text:Ask ', 'bold:Ada', 'text: and ', 'mention:ada', 'text: about ', 'code:the engine']);
  });

  it('prefers **bold** over *italic*', () => {
    expect(types(parseInline('**both**'))).toEqual(['bold:both']);
  });

  it('leaves an unmatched mark as literal text', () => {
    expect(types(parseInline('2 * 3'))).toEqual(['text:2 * 3']);
    expect(types(parseInline('*unclosed'))).toEqual(['text:*unclosed']);
    expect(types(parseInline('`unclosed'))).toEqual(['text:`unclosed']);
    expect(types(parseInline('**unclosed'))).toEqual(['text:**unclosed']);
  });

  it('reads a pair of asterisks as emphasis, however spaced', () => {
    expect(types(parseInline('a * b * c'))).toEqual(['text:a ', 'italic: b ', 'text: c']);
  });

  it('reads nothing as no tokens', () => {
    expect(parseInline('')).toEqual([]);
    expect(parseInline(null)).toEqual([]);
  });
});

describe('parseNote', () => {
  it('gives one token list per line, so a blank line stays blank', () => {
    expect(parseNote('one\n\ntwo').map(types)).toEqual([['text:one'], [], ['text:two']]);
  });

  it('reads marks on every line', () => {
    expect(parseNote('**a**\n@b').map(types)).toEqual([['bold:a'], ['mention:b']]);
  });

  it('reads nothing as one empty line', () => {
    expect(parseNote(null)).toEqual([[]]);
  });
});
