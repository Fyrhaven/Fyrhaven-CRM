// The page skeleton: the two-pane split the plugin draws itself.
//
// The kit's `Row` and `Stack` are layout primitives whose behaviour the plugin
// cannot verify. The unit-test stand-in drops the `style` prop entirely, so
// `h(Stack, { style: { flex: '0 0 320px' } })` is untestable by construction,
// and on a real host the Contacts page was observed collapsing into a single
// column: the contact list ran the full width of the page, grew without bound
// and pushed the profile (details, duplicates, meetings, files, messages,
// tasks) off the bottom.
//
// The split is the page's *skeleton*, so the plugin owns it with plain elements
// and explicit inline styles that no host component can drop. The kit still
// draws every piece of content inside the panes, so the page keeps looking like
// part of the app — this is layout only, not a fork of the UI.
//
// Keep these pure: no `api`, no DOM, no React.

/** A wrapping flex row: panes side by side, and stacked again on a narrow page. */
export const SPLIT = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '1rem',
  alignItems: 'flex-start',
};

/**
 * A side pane at a fixed basis, bounded in height, laid out as a column: the
 * controls that must stay put (a search box) sit above a scrolling list.
 *
 * The pane itself deliberately does **not** scroll. When it did, the search box
 * scrolled away with the list and could not be reached without scrolling back.
 *
 * @param {number} basis the preferred width in pixels
 */
export function sidePane(basis) {
  return {
    flex: `0 0 ${basis}px`,
    minWidth: '220px',
    maxHeight: '60vh',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    minHeight: '0',
  };
}

/**
 * The list inside a side pane: this is what scrolls, so everything above it
 * stays visible however long the list is. `minHeight: 0` is what lets a flex
 * child shrink and scroll instead of stretching its parent.
 */
export const SCROLL_AREA = {
  flex: '1 1 auto',
  minHeight: '0',
  overflowY: 'auto',
};

/**
 * The pane beside it: takes the rest of the row, is allowed to shrink, and
 * stacks its sections with the same rhythm the kit's `Stack` would have given.
 */
export const CONTENT_PANE = {
  flex: '1 1 480px',
  minWidth: '0',
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
};

/** Takes a control out of the layout without asking the kit to hide it. */
export const HIDDEN = { display: 'none' };
