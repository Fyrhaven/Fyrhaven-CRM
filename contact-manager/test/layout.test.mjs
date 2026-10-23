// The page skeleton the plugin owns itself.
//
// The kit's `Row`/`Stack` cannot be trusted to carry the two-pane split: the
// test stand-in drops the `style` prop, so a split built from it is untestable
// by construction, and on a real host it collapsed into one column.
import { describe, expect, it } from 'vitest';
import { CONTENT_PANE, HIDDEN, SPLIT, sidePane } from '../src/lib/layout.js';

describe('page layout', () => {
  it('lays the panes out as a wrapping flex row', () => {
    expect(SPLIT.display).toBe('flex');
    expect(SPLIT.flexWrap).toBe('wrap');
  });

  it('gives the side pane a fixed basis and its own scrollbar', () => {
    expect(sidePane(320)).toMatchObject({
      flex: '0 0 320px',
      overflowY: 'auto',
      maxHeight: expect.any(String),
    });
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
