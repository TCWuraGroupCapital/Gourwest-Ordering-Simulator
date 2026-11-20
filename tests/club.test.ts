import { describe, expect, it } from 'vitest';
import { tierProgress } from '../src/data/club';

describe('tierProgress', () => {
  it.each([
    [0, 'Bronze', 'Silver', 750],
    [1180, 'Silver', 'Gold', 820],
    [2000, 'Gold', 'Platinum', 3000],
    [4999, 'Gold', 'Platinum', 1],
  ])('%i pts is %s, %s is %i away', (points, tier, next, toNext) => {
    const p = tierProgress(points);
    expect([p.tier.name, p.next?.name, p.toNext]).toEqual([tier, next, toNext]);
  });

  it('has no next tier at Platinum', () => {
    expect(tierProgress(5300)).toMatchObject({ tier: { name: 'Platinum' }, next: null, toNext: 0 });
  });
});
