// In-app help (#39: "in-app help, changelog and keyboard shortcuts").
//
// The cheatsheet is **derived** from search.js's own constants, so a new operator
// cannot ship without appearing here, and every worked example is asserted to
// parse in the test — a cheatsheet line cannot describe syntax the box rejects.
//
// Pure — no DOM, no api. The dialog is help-dialog.js.

import { FIELDS, HAS_FLAGS, IS_VALUES } from './search.js';

/**
 * The keyboard shortcuts the plugin handles, plus the host's own palette. `keys`
 * is a chord to show as separate keycaps; `label` is a translation key.
 */
export const SHORTCUTS = [
  { keys: ['Ctrl', 'K'], label: 'help.shortcut.palette' },
  { keys: ['/'], label: 'help.shortcut.search' },
  { keys: ['Esc'], label: 'help.shortcut.clear' },
];

/** The field operators the search box understands, in the box's own order. */
export const QUERY_OPERATORS = FIELDS.map((field) => ({ field, token: `${field}:` }));

/** What `has:` accepts — the same list the parser enforces. */
export const HAS_VALUES = [...HAS_FLAGS];

/** What `is:` accepts — the same list the parser enforces. */
export const IS_VALUES_LIST = [...IS_VALUES];

/**
 * Worked examples, one per combination the box supports: AND (adjacent), OR,
 * grouping, and the two ways to exclude.
 */
export const QUERY_EXAMPLES = [
  'tag:vip tag:customer',
  'tag:vip OR tag:customer',
  '(tag:vip OR tag:customer) has:email',
  'note:budget',
  '-tag:vip',
  'not:tag:vip',
];

/**
 * A short in-app "what's new". Newest first; each `note` is a translation key.
 * The test pins that the versions descend and every note exists in both
 * locales, so the list cannot silently rot. Prepend an entry when a release has
 * something a user would want to read.
 */
export const WHATS_NEW = [
  { version: '1.53.0', note: 'help.whatsNew.1_53_0' },
  { version: '1.52.0', note: 'help.whatsNew.1_52_0' },
  { version: '1.51.0', note: 'help.whatsNew.1_51_0' },
  { version: '1.50.0', note: 'help.whatsNew.1_50_0' },
  { version: '1.49.0', note: 'help.whatsNew.1_49_0' },
  { version: '1.48.0', note: 'help.whatsNew.1_48_0' },
  { version: '1.47.0', note: 'help.whatsNew.1_47_0' },
  { version: '1.46.0', note: 'help.whatsNew.1_46_0' },
  { version: '1.45.0', note: 'help.whatsNew.1_45_0' },
  { version: '1.44.0', note: 'help.whatsNew.1_44_0' },
  { version: '1.43.0', note: 'help.whatsNew.1_43_0' },
  { version: '1.42.0', note: 'help.whatsNew.1_42_0' },
];
