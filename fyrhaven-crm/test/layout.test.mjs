// The page skeleton the plugin owns itself.
//
// The kit's `Row`/`Stack` cannot be trusted to carry the two-pane split: the
// test stand-in drops the `style` prop, so a split built from it is untestable
// by construction, and on a real host it collapsed into one column.
import { describe, expect, it } from 'vitest';
import { CONTENT_PANE, HIDDEN, SCROLL_AREA, SPLIT, sidePane } from '../src/lib/layout.js';

describe('page layout', () => {
  it('lays the panes out as a wrapping flex row', () => {
    expect(SPLIT.display).toBe('flex');
    expect(SPLIT.flexWrap).toBe('wrap');
  });

  it('gives the side pane a fixed basis, a bounded height and a column layout', () => {
    expect(sidePane(320)).toMatchObject({
      flex: '0 0 320px',
      maxHeight: expect.any(String),
      display: 'flex',
      flexDirection: 'column',
    });
  });

  it('scrolls the list, not the pane, so the controls above it stay put', () => {
    expect(SCROLL_AREA.overflowY).toBe('auto');
    // the pane must not scroll: that is what used to carry the search box away
    expect(sidePane(320).overflowY).toBeUndefined();
  });

  it('lets the detail pane shrink and stack its sections', () => {
    expect(CONTENT_PANE.minWidth).toBe('0');
    expect(CONTENT_PANE.display).toBe('flex');
    expect(CONTENT_PANE.flexDirection).toBe('column');
  });

  it('takes a control out of the layout', () => {
    expect(HIDDEN.display).toBe('none');
  });
});
