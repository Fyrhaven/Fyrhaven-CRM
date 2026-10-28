// Smarter name matching (#8): the same person written differently.
//
// Two halves, because the safe half is not the same *kind* of thing as the risky
// one:
//
// * **Equivalence** — transliteration/romanisation and a curated nickname table.
//   "Müller" and "Mueller" are two spellings of one name, "Bob" is another name
//   for Robert. These fold into a shared comparison key exactly like case does,
//   and cost nothing.
// * **Evidence** — an initial ("J. Smith") or a typo ("Jon"/"John") is not an
//   equivalence: the same key would have to match "Jane Smith" too, and those are
//   different people. So these are found **pairwise**, only inside a bucket that
//   already shares a *phonetic surname*, and only when the given names agree.
//   A pair like that is always evidence, never proof — the group stays 'possible'.
//
// Pure: no api, no DOM.

// Characters with no NFKD decomposition. Mapped in both folds.
const SPECIAL = {
  ß: 'ss', ẞ: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', þ: 'th', ł: 'l',
  ħ: 'h', ı: 'i', ŋ: 'n', ĸ: 'k', ŧ: 't', ƒ: 'f',
};

// German umlauts, which have *two* honest spellings: "Müller" is "Mueller" on a
// passport and "Muller" on a keyboard. One fold cannot be right for both, so the
// module emits both variants and any of them may match.
const GERMAN = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

// A compact romanisation. Consistency matters more than convention: what counts
// is that "Иван" and "Ivan" fold to the same string, not whether "х" is "kh" or
// "h". Both tables are deliberately one-way (never Latin → script).
const CYRILLIC = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'iu', я: 'ia',
  і: 'i', ї: 'i', є: 'e', ґ: 'g', ў: 'u', ѐ: 'e', ѝ: 'i',
};

const GREEK = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i',
  κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's',
  ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};

/** One pass of the character tables. */
function mapChars(input, table) {
  let out = '';
  for (const char of input) {
    const lower = char.toLowerCase();
    if (table[lower] !== undefined) { out += table[lower]; continue; }
    if (CYRILLIC[lower] !== undefined) { out += CYRILLIC[lower]; continue; }
    if (GREEK[lower] !== undefined) { out += GREEK[lower]; continue; }
    out += char;
  }
  return out;
}

/**
 * One folded spelling of a name: script romanised, diacritics dropped,
 * lower-cased, punctuation turned into spaces.
 *
 * @param {string} value
 * @param {{ german?: boolean }} [options] `german` expands ä/ö/ü to ae/oe/ue
 */
export function foldName(value, { german = false } = {}) {
  const table = german ? { ...SPECIAL, ...GERMAN } : SPECIAL;
  // Twice on purpose: the first pass expands the precomposed Latin letters that
  // have to become two ("ü" → "ue", "ß" → "ss"), and the second catches a script
  // letter that only appears once a mark is gone — "ώ" decomposes to "ω" + tonos,
  // and the tonos is stripped after the first pass has run.
  const mapped = mapChars(String(value ?? ''), table);
  const plain = mapped.normalize('NFKD').replace(/\p{M}/gu, '');
  return mapChars(plain, table)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Both honest spellings of a name, de-duplicated. */
export function foldVariants(value) {
  return [...new Set([foldName(value), foldName(value, { german: true })])].filter(Boolean);
}

/** The folded tokens of a name, sorted, for a whole-name key. */
export function sortedTokens(value, options) {
  const tokens = foldName(value, options);
  return tokens ? tokens.split(' ').sort() : [];
}

// ── Nicknames ──────────────────────────────────────────────────
//
// A curated table, not a heuristic: every entry is a name people really answer
// to. An alias in **two** groups is ambiguous ("Alex" is Alexander and Alexandra,
// "Pat" is Patrick and Patricia) and is left alone rather than guessed at.

const NICKNAME_GROUPS = [
  ['robert', 'bob', 'bobby', 'rob', 'robbie', 'bert'],
  ['william', 'bill', 'billy', 'will', 'willie', 'liam'],
  ['james', 'jim', 'jimmy', 'jamie'],
  ['richard', 'rick', 'ricky', 'dick', 'rich'],
  ['margaret', 'peggy', 'maggie', 'meg', 'marge', 'greta'],
  ['elizabeth', 'liz', 'lizzy', 'beth', 'betty', 'eliza', 'libby'],
  ['katherine', 'kate', 'katie', 'kathy', 'kat', 'kathryn', 'catherine', 'cathy'],
  ['john', 'jack', 'johnny', 'jon'],
  ['joseph', 'joe', 'joey'],
  ['michael', 'mike', 'mikey', 'mick'],
  ['thomas', 'tom', 'tommy'],
  ['christopher', 'chris', 'kit'],
  ['daniel', 'dan', 'danny'],
  ['david', 'dave', 'davy'],
  ['edward', 'ed', 'eddie', 'ted', 'ned'],
  ['anthony', 'tony'],
  ['andrew', 'andy', 'drew'],
  ['nicholas', 'nick', 'nicky'],
  ['peter', 'pete'],
  ['philip', 'phil', 'pip'],
  ['susan', 'sue', 'susie'],
  ['jennifer', 'jen', 'jenny'],
  ['patricia', 'patty', 'tricia'],
  ['alexander', 'sasha'],
  ['alexandra', 'sasha', 'lexi'],
  ['frederick', 'fred', 'freddie'],
  ['gregory', 'greg'],
  ['kenneth', 'ken', 'kenny'],
  ['lawrence', 'larry'],
  ['matthew', 'matt'],
  ['nathaniel', 'nathan', 'nate'],
  ['patrick', 'paddy'],
  ['raymond', 'ray'],
  ['ronald', 'ron', 'ronnie'],
  ['samuel', 'sam', 'sammy'],
  ['stephen', 'steve', 'stevie'],
  ['steven', 'steve'],
  ['timothy', 'tim'],
  ['victoria', 'vicky', 'tori'],
  ['dorothy', 'dot', 'dottie'],
  ['eugene', 'gene'],
  ['francis', 'frank', 'fran'],
  ['henry', 'harry', 'hank'],
  ['jacob', 'jake'],
  ['leonard', 'leo', 'lenny'],
  ['martin', 'marty'],
  ['theodore', 'ted', 'teddy'],
  ['walter', 'walt'],
  ['zachary', 'zach'],
];

/** alias → canonical, built once; an alias claimed twice is left ambiguous. */
const NICKNAME_ALIASES = (() => {
  const counts = new Map();
  for (const group of NICKNAME_GROUPS) {
    for (const alias of group) counts.set(alias, (counts.get(alias) ?? 0) + 1);
  }
  const map = new Map();
  for (const group of NICKNAME_GROUPS) {
    const canonical = group[0];
    for (const alias of group) {
      if (counts.get(alias) > 1) continue; // ambiguous: never guessed at
      map.set(alias, canonical);
    }
  }
  return map;
})();

/** The canonical name behind a nickname, or the token itself. */
export function canonicalToken(token) {
  return NICKNAME_ALIASES.get(token) ?? token;
}

/**
 * The nickname-canonical key of a name: every token replaced by its canonical
 * name, sorted. `''` for a single token — one given name is too weak to match on.
 */
export function nicknameKey(value, options) {
  const tokens = sortedTokens(value, options).map(
    (token) => canonicalToken(token),
  );
  const unique = [...new Set(tokens)];
  return unique.length >= 2 ? unique.sort().join(' ') : '';
}

// ── Phonetic surnames ──────────────────────────────────────────

const PHONETIC_DIGITS = {
  b: '1', f: '1', p: '1', v: '1',
  c: '2', g: '2', j: '2', k: '2', q: '2', s: '2', x: '2', z: '2',
  d: '3', t: '3',
  l: '4',
  m: '5', n: '5',
  r: '6',
};

/**
 * A compact Soundex of one folded token: the same sound, the same key.
 * "Smith" and "Smyth" give `s530`; "Schmidt" and "Schmitt" both give `s253`.
 *
 * Phonetic equality is *evidence*, never proof — it widens the bucket a pairwise
 * comparison may look in, and the given name still has to agree.
 */
export function phoneticKey(token) {
  const letters = String(token ?? '').replace(/[^a-z0-9]/g, '');
  if (!letters) return '';
  const first = letters[0];
  let previous = PHONETIC_DIGITS[first] ?? '';
  let out = '';
  for (const char of letters.slice(1)) {
    const digit = PHONETIC_DIGITS[char] ?? '';
    if (digit && digit !== previous) out += digit;
    if (out.length === 3) break;
    previous = digit;
  }
  return (first + out + '000').slice(0, 4);
}

// ── Similarity ─────────────────────────────────────────────────

/**
 * Jaro-Winkler similarity, 0..1.
 *
 * Chosen over a plain edit distance because it is kind to names: a shared opening
 * ("Jon"/"John", "Sara"/"Sarah") counts for more than the same number of edits in
 * the middle, which is what a typo or a shortened spelling looks like.
 */
export function jaroWinkler(a, b) {
  const s = String(a ?? '');
  const t = String(b ?? '');
  if (!s.length || !t.length) return s === t ? 1 : 0;
  if (s === t) return 1;

  const window = Math.max(0, Math.floor(Math.max(s.length, t.length) / 2) - 1);
  const sMatched = new Array(s.length).fill(false);
  const tMatched = new Array(t.length).fill(false);
  let matches = 0;

  for (let i = 0; i < s.length; i += 1) {
    const from = Math.max(0, i - window);
    const to = Math.min(i + window + 1, t.length);
    for (let j = from; j < to; j += 1) {
      if (tMatched[j] || s[i] !== t[j]) continue;
      sMatched[i] = true;
      tMatched[j] = true;
      matches += 1;
      break;
    }
  }
  if (!matches) return 0;

  let ordered = 0;
  for (let i = 0, j = 0; i < s.length; i += 1) {
    if (!sMatched[i]) continue;
    while (!tMatched[j]) j += 1;
    if (s[i] === t[j]) ordered += 1;
    j += 1;
  }
  const transpositions = (matches - ordered) / 2;
  const jaro = (matches / s.length + matches / t.length + (matches - transpositions) / matches) / 3;

  let prefix = 0;
  while (prefix < 4 && prefix < s.length && prefix < t.length && s[prefix] === t[prefix]) prefix += 1;
  return jaro + prefix * 0.1 * (1 - jaro);
}

// ── Surnames, given names, and the pairwise pass ───────────────

/**
 * A name split into `{ surname, given }`, folded. The host's own name components
 * are trusted when they are there; otherwise the last token is taken as the
 * surname. That is the common shape but not a rule ("van der Berg"), which is
 * acceptable because the split only picks a *bucket* for the pairwise pass — a
 * wrong split costs a missed match, never a wrong one.
 *
 * @param {string} fullName
 * @param {Array<{kind: string, value: string}>|object} [components]
 */
export function splitName(fullName, components) {
  const list = Array.isArray(components) ? components : Object.values(components ?? {});
  const pick = (kind) => list
    .filter((component) => component?.kind === kind)
    .map((component) => foldName(component.value))
    .filter(Boolean)
    .join(' ');
  const given = pick('given');
  const surname = pick('surname');
  if (surname) return { surname, given: given ? given.split(' ') : [] };
  const tokens = foldName(fullName).split(' ').filter(Boolean);
  if (tokens.length < 2) return { surname: '', given: tokens };
  return { surname: tokens[tokens.length - 1], given: tokens.slice(0, -1) };
}

const isInitial = (token) => token.length === 1;

/**
 * How two given names agree: `'same'`, `'initial'`, `'similar'` or `null`.
 *
 * The given name has to corroborate on its own — phonetic equality of the surname
 * alone is exactly the false-positive trap the issue warns about, where
 * "John Smith" and "Jane Smith" would become one group.
 */
export function givenKind(a, b, thresholdPercent = 80) {
  if (!a.length || a.length !== b.length) return null;
  let same = true;
  let initials = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    same = false;
    if (isInitial(a[i]) && b[i].startsWith(a[i])) { initials += 1; continue; }
    if (isInitial(b[i]) && a[i].startsWith(b[i])) { initials += 1; continue; }
    initials = -1;
    break;
  }
  if (same) return 'same';
  if (initials > 0) return 'initial';
  const score = jaroWinkler(a.join(''), b.join(''));
  return score * 100 >= thresholdPercent ? 'similar' : null;
}

/**
 * Pairs of `people` indices whose names are evidence of the same person but whose
 * exact keys differ — an initial, a phonetic surname, or a similar given name.
 *
 * `people` is `[{ name, components? }]`. The result is `[{ a, b, kind, score }]`
 * with `kind` `'initial' | 'phonetic' | 'similar'`.
 *
 * Two guards keep this cheap and quiet: the surname must share a **phonetic** key,
 * so the pass never compares the whole address book, and a bucket with more
 * members than `bucketLimit` is skipped — a surname that common is a crowd, not a
 * clue.
 */
export function pairNameEvidence(people, { threshold = 80, bucketLimit = 60 } = {}) {
  const prepared = [];
  (Array.isArray(people) ? people : []).forEach((person, index) => {
    const { surname, given } = splitName(person?.name ?? '', person?.components);
    if (!surname || !given.length) return;
    // A surname needs real letters to be evidence. Without this, "Twin 1" and
    // "Twin 10" share the phonetic key of a single digit and the whole book
    // collapses into one group — found by the 51-group cap test.
    const letters = surname.replace(/[^a-z]/g, '');
    if (letters.length < 2) return;
    const bucket = phoneticKey(letters);
    if (!bucket) return;
    prepared.push({ index, surname, letters, given, bucket });
  });

  const buckets = new Map();
  for (const entry of prepared) {
    if (!buckets.has(entry.bucket)) buckets.set(entry.bucket, []);
    buckets.get(entry.bucket).push(entry);
  }

  /**
   * Whether the surnames agree at all. Equality is enough; otherwise both need
   * enough letters to be compared and must be *similar*, not merely phonetically
   * bucketed — "Smith"/"Smyth" pass, "Smith"/"Smythe" pass, "Li"/"Lo" do not.
   */
  const surnameAgrees = (left, right) => {
    if (left.letters === right.letters) return true;
    if (left.letters.length < 3 || right.letters.length < 3) return false;
    return jaroWinkler(left.letters, right.letters) * 100 >= threshold;
  };

  const pairs = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2 || bucket.length > bucketLimit) continue;
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const left = bucket[i];
        const right = bucket[j];
        if (!surnameAgrees(left, right)) continue;
        const kind = givenKind(left.given, right.given, threshold);
        if (!kind) continue;
        if (kind === 'same') {
          // the same folded name is already an exact key; nothing to add
          if (left.letters === right.letters) continue;
          pairs.push({ a: left.index, b: right.index, kind: 'phonetic', score: 1 });
          continue;
        }
        if (kind === 'initial') {
          pairs.push({ a: left.index, b: right.index, kind: 'initial', score: 1 });
          continue;
        }
        const score = jaroWinkler(left.given.join(''), right.given.join(''));
        if (score * 100 < threshold) continue;
        pairs.push({ a: left.index, b: right.index, kind: 'similar', score });
      }
    }
  }
  return pairs;
}

