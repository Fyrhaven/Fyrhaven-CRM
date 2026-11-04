// A deliberately tiny inline formatter for private notes (#38).
//
// A note is rendered as React **elements**, never as HTML, so nothing a note
// contains can become markup — and no parser dependency is needed for the
// handful of marks a note actually uses. It is a documented subset, not
// markdown: `**bold**`, `*italic*` / `_italic_`, `` `code` ``, `@mention` and
// newlines. Everything else is literal text.
//
// Pure — the UI is notes-section.js.

// Order matters: `**bold**` must be tried before `*italic*`.
const RULES = [
  { type: 'code', pattern: /^`([^`]+)`/ },
  { type: 'bold', pattern: /^\*\*([^*]+)\*\*/ },
  { type: 'italic', pattern: /^\*([^*]+)\*/ },
  { type: 'italic', pattern: /^_([^_]+)_/ },
  { type: 'mention', pattern: /^@([\p{L}\p{N}._-]+)/u },
];

/**
 * Split one line into tokens: `[{ type, text }]`, where `type` is `text`,
 * `bold`, `italic`, `code` or `mention`. An unmatched mark stays literal, so a
 * stray `*` is shown, not swallowed.
 */
export function parseInline(line) {
  const source = String(line ?? '');
  const tokens = [];
  let literal = '';
  let index = 0;
  const flush = () => {
    if (literal) {
      tokens.push({ type: 'text', text: literal });
      literal = '';
    }
  };
  while (index < source.length) {
    const rest = source.slice(index);
    const hit = RULES.map((rule) => ({ rule, match: rule.pattern.exec(rest) })).find((entry) => entry.match);
    if (hit) {
      flush();
      tokens.push({ type: hit.rule.type, text: hit.match[1] });
      index += hit.match[0].length;
      continue;
    }
    literal += source[index];
    index += 1;
  }
  flush();
  return tokens;
}

/** The whole note: one token list per line, so a blank line stays blank. */
export function parseNote(value) {
  return String(value ?? '').split('\n').map((line) => parseInline(line));
}
