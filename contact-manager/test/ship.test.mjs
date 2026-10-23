import { describe, expect, it } from 'vitest';
import { planShip } from '../scripts/ship-lib.mjs';

const pr = (number, base, head) => ({ number, baseRefName: base, headRefName: head });

describe('planShip', () => {
  it('returns nothing for no pull requests', () => {
    expect(planShip([])).toEqual({ ready: [], blocked: [] });
  });

  it('merges a PR based on main without retargeting', () => {
    expect(planShip([pr(1, 'main', 'feat/a')])).toEqual({
      ready: [{ number: 1, head: 'feat/a', retarget: false }],
      blocked: [],
    });
  });

  it('orders a stack so each PR is merged after its base', () => {
    const { ready } = planShip([
      pr(56, 'feat/b', 'feat/c'),
      pr(52, 'main', 'feat/a'),
      pr(53, 'feat/a', 'feat/b'),
    ]);
    expect(ready.map((entry) => entry.number)).toEqual([52, 53, 56]);
    expect(ready.map((entry) => entry.retarget)).toEqual([false, true, true]);
  });

  it('does not depend on the order of the input', () => {
    const forward = planShip([pr(1, 'main', 'a'), pr(2, 'a', 'b'), pr(3, 'b', 'c')]);
    const backward = planShip([pr(3, 'b', 'c'), pr(2, 'a', 'b'), pr(1, 'main', 'a')]);
    expect(backward).toEqual(forward);
  });

  it('treats branches already on main as landed bases', () => {
    const { ready } = planShip([pr(9, 'feat/done', 'feat/next')], ['main', 'feat/done']);
    expect(ready).toEqual([{ number: 9, head: 'feat/next', retarget: true }]);
  });

  it('reports a PR whose base is not on main and has no open PR', () => {
    const { ready, blocked } = planShip([pr(1, 'main', 'a'), pr(2, 'gone', 'b')]);
    expect(ready.map((entry) => entry.number)).toEqual([1]);
    expect(blocked).toEqual([{ number: 2, head: 'b', base: 'gone' }]);
  });

  it('reports a PR stacked on another blocked PR', () => {
    const { ready, blocked } = planShip([pr(1, 'gone', 'a'), pr(2, 'a', 'b')]);
    expect(ready).toEqual([]);
    expect(blocked.map((entry) => entry.number)).toEqual([1, 2]);
  });

  it('ignores entries without the fields it needs', () => {
    const { ready } = planShip([{ number: 1 }, null, pr(2, 'main', 'a')]);
    expect(ready.map((entry) => entry.number)).toEqual([2]);
  });
});
