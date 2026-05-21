import {
  computeStats,
  assignConfidence,
  computeGroupStats,
  computeRelevance,
  rateListing,
} from '../analyse';
import type { ParsedListing, PricingGroup, GroupStatistics, WeightedTokens } from '../types';

function makeStats(overrides: Partial<GroupStatistics> = {}): GroupStatistics {
  return {
    count: 0, min: 0, max: 0, mean: 0, median: 0,
    p25: 0, p75: 0, stdDev: 0, iqr: 0,
    ...overrides,
  };
}

function makeListing(totalPrice: number, identity: string[] = []): ParsedListing {
  return {
    title: identity.join(' ') || 'item',
    itemPrice: totalPrice,
    postage: 0,
    postageKnown: true,
    totalPrice,
    condition: 'Used',
    link: '',
    tokens: {
      identity,
      descriptors: [],
      noise: new Set(),
      raw: new Set(),
    },
    isJunk: false,
    isExcluded: false,
  };
}

function makeGroup(
  items: ParsedListing[],
  opts: { confidence?: PricingGroup['confidence']; children?: PricingGroup[] } = {},
): PricingGroup {
  return {
    id: 'g1',
    label: 'test group',
    items,
    children: opts.children ?? [],
    parent: null,
    depth: 0,
    stats: makeStats({ count: items.length }),
    confidence: opts.confidence ?? 'medium',
    relevanceScore: 0,
  };
}

// ── computeStats ─────────────────────────────────────────────────────────────

describe('computeStats', () => {
  test('empty array returns zero stats', () => {
    const s = computeStats([]);
    expect(s.count).toBe(0);
    expect(s.min).toBe(0);
    expect(s.max).toBe(0);
  });

  test('single value', () => {
    const s = computeStats([100]);
    expect(s.min).toBe(100);
    expect(s.max).toBe(100);
    expect(s.median).toBe(100);
    expect(s.p25).toBe(100);
    expect(s.p75).toBe(100);
    expect(s.iqr).toBe(0);
    expect(s.stdDev).toBe(0);
  });

  test('two values', () => {
    const s = computeStats([10, 20]);
    expect(s.min).toBe(10);
    expect(s.max).toBe(20);
    expect(s.mean).toBe(15);
    expect(s.median).toBe(15);
  });

  test('odd number of values', () => {
    const s = computeStats([1, 2, 3, 4, 5]);
    expect(s.median).toBe(3);
    expect(s.p25).toBe(2);
    expect(s.p75).toBe(4);
    expect(s.iqr).toBe(2);
    expect(s.count).toBe(5);
  });

  test('even number of values', () => {
    const s = computeStats([10, 20, 30, 40]);
    expect(s.median).toBe(25);
    expect(s.min).toBe(10);
    expect(s.max).toBe(40);
  });

  test('unsorted input is sorted internally', () => {
    const s = computeStats([50, 10, 30, 20, 40]);
    expect(s.min).toBe(10);
    expect(s.max).toBe(50);
    expect(s.median).toBe(30);
  });

  test('stdDev of uniform values is 0', () => {
    const s = computeStats([5, 5, 5, 5]);
    expect(s.stdDev).toBe(0);
  });

  test('stdDev is positive for varying values', () => {
    const s = computeStats([1, 2, 3]);
    expect(s.stdDev).toBeGreaterThan(0);
  });
});

// ── assignConfidence ──────────────────────────────────────────────────────────

describe('assignConfidence', () => {
  test('high: ≥10 items and iqr/median < 0.4', () => {
    const group = { stats: makeStats({ count: 10, iqr: 39, median: 100 }) };
    expect(assignConfidence(group)).toBe('high');
  });

  test('not high when iqr/median ≥ 0.4 even with ≥10 items', () => {
    const group = { stats: makeStats({ count: 10, iqr: 40, median: 100 }) };
    expect(assignConfidence(group)).toBe('medium');
  });

  test('not high when count < 10', () => {
    const group = { stats: makeStats({ count: 9, iqr: 10, median: 100 }) };
    expect(assignConfidence(group)).toBe('medium');
  });

  test('medium: ≥5 items', () => {
    const group = { stats: makeStats({ count: 5, iqr: 100, median: 100 }) };
    expect(assignConfidence(group)).toBe('medium');
  });

  test('low: ≥3 items', () => {
    const group = { stats: makeStats({ count: 3, iqr: 100, median: 100 }) };
    expect(assignConfidence(group)).toBe('low');
  });

  test('insufficient: <3 items', () => {
    const group = { stats: makeStats({ count: 2 }) };
    expect(assignConfidence(group)).toBe('insufficient');
  });

  test('insufficient: 0 items', () => {
    const group = { stats: makeStats({ count: 0 }) };
    expect(assignConfidence(group)).toBe('insufficient');
  });
});

// ── outlier removal (via computeGroupStats) ───────────────────────────────────

describe('outlier removal', () => {
  test('outliers not removed when count < 8', () => {
    const prices = [100, 100, 100, 100, 100, 100, 99999];
    const items = prices.map(p => makeListing(p));
    const group = makeGroup(items);
    computeGroupStats(group);
    // All 7 items kept — outlier not removed
    expect(group.stats.count).toBe(7);
    expect(group.stats.max).toBe(99999);
  });

  test('outliers removed when count ≥ 8', () => {
    // 7 clustered prices + 1 extreme outlier = 8 items
    const prices = [100, 100, 100, 100, 100, 100, 100, 99999];
    const items = prices.map(p => makeListing(p));
    const group = makeGroup(items);
    computeGroupStats(group);
    // Outlier should be removed — stats computed on 7 items
    expect(group.stats.count).toBe(7);
    expect(group.stats.max).toBe(100);
  });
});

// ── computeRelevance ──────────────────────────────────────────────────────────

describe('computeRelevance', () => {
  function makeSearchTokens(identity: string[]): WeightedTokens {
    return { identity, descriptors: [], noise: new Set(), raw: new Set() };
  }

  test('returns 1 when group identity exactly matches search term', () => {
    const items = [makeListing(100, ['iphone', '16'])];
    const group = makeGroup(items);
    const score = computeRelevance(group, makeSearchTokens(['iphone', '16']));
    expect(score).toBe(1);
  });

  test('returns 0 when no overlap', () => {
    const items = [makeListing(100, ['xbox'])];
    const group = makeGroup(items);
    const score = computeRelevance(group, makeSearchTokens(['iphone']));
    expect(score).toBe(0);
  });

  test('partial overlap returns fractional score', () => {
    const items = [makeListing(100, ['iphone', '16', 'pro'])];
    const group = makeGroup(items);
    const score = computeRelevance(group, makeSearchTokens(['iphone', '16']));
    // intersection={iphone,16}=2, union={iphone,16,pro}=3 → 2/3
    expect(score).toBeCloseTo(2 / 3, 5);
  });

  test('returns 0 when search tokens are empty', () => {
    const items = [makeListing(100, ['iphone'])];
    const group = makeGroup(items);
    const score = computeRelevance(group, makeSearchTokens([]));
    expect(score).toBe(0);
  });

  test('is case-insensitive', () => {
    const items = [makeListing(100, ['iPhone'])];
    const group = makeGroup(items);
    const score = computeRelevance(group, makeSearchTokens(['iphone']));
    expect(score).toBe(1);
  });
});

// ── rateListing ───────────────────────────────────────────────────────────────

describe('rateListing', () => {
  function buildGroupWithStats(
    items: ParsedListing[],
    confidence: PricingGroup['confidence'],
  ): PricingGroup {
    const prices = items.map(i => i.totalPrice).sort((a, b) => a - b);
    const n = prices.length;
    function pct(p: number) {
      const idx = p * (n - 1);
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      if (lo === hi) return prices[lo];
      return prices[lo] + (prices[hi] - prices[lo]) * (idx - lo);
    }
    const group = makeGroup(items, { confidence });
    group.stats = {
      count: n,
      min: prices[0],
      max: prices[n - 1],
      mean: prices.reduce((s, v) => s + v, 0) / n,
      median: pct(0.5),
      p25: pct(0.25),
      p75: pct(0.75),
      stdDev: 0,
      iqr: pct(0.75) - pct(0.25),
    };
    return group;
  }

  test('good: totalPrice < p25', () => {
    const items = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(p => makeListing(p));
    const group = buildGroupWithStats(items, 'high');
    const listing = makeListing(5);
    // Not in group.items so use a group that contains it
    const fullGroup = buildGroupWithStats([listing, ...items], 'high');
    const result = rateListing(listing, [fullGroup]);
    expect(result.rating).toBe('good');
    expect(result.showBadge).toBe(true);
  });

  test('high: totalPrice > p75', () => {
    const items = [10, 20, 30, 40, 50].map(p => makeListing(p));
    const listing = makeListing(200);
    const group = buildGroupWithStats([...items, listing], 'medium');
    const result = rateListing(listing, [group]);
    expect(result.rating).toBe('high');
    expect(result.showBadge).toBe(true);
  });

  test('fair: totalPrice between p25 and p75', () => {
    const items = [10, 20, 30, 40, 50].map(p => makeListing(p));
    const listing = makeListing(30);
    const group = buildGroupWithStats([...items, listing], 'medium');
    const result = rateListing(listing, [group]);
    expect(result.rating).toBe('fair');
    expect(result.showBadge).toBe(true);
  });

  test('no-data: listing not in any group', () => {
    const items = [10, 20, 30, 40, 50].map(p => makeListing(p));
    const group = buildGroupWithStats(items, 'medium');
    const orphan = makeListing(25);
    const result = rateListing(orphan, [group]);
    expect(result.rating).toBe('no-data');
    expect(result.showBadge).toBe(false);
    expect(result.matchedGroup).toBeNull();
  });

  test('showBadge false when group confidence is insufficient', () => {
    const items = [10, 20].map(p => makeListing(p));
    const listing = makeListing(15);
    const group = buildGroupWithStats([...items, listing], 'insufficient');
    const result = rateListing(listing, [group]);
    expect(result.showBadge).toBe(false);
    expect(result.rating).toBe('no-data');
  });

  test('uses deepest confident child group', () => {
    const child1Items = [10, 20, 30, 40, 50].map(p => makeListing(p));
    const listing = makeListing(15);
    const allItems = [...child1Items, listing];

    const child = buildGroupWithStats(allItems, 'medium');
    child.id = 'child1';
    child.depth = 1;

    const parent = buildGroupWithStats(allItems, 'medium');
    parent.id = 'parent';
    parent.children = [child];
    parent.depth = 0;

    const result = rateListing(listing, [parent]);
    expect(result.matchedGroup?.id).toBe('child1');
  });

  test('falls back to parent when child confidence is insufficient', () => {
    const listing = makeListing(15);
    const items = [10, 20].map(p => makeListing(p));
    const allItems = [...items, listing];

    const child = buildGroupWithStats(allItems, 'insufficient');
    child.id = 'child';
    child.depth = 1;

    const parent = buildGroupWithStats(allItems, 'medium');
    parent.id = 'parent';
    parent.children = [child];
    parent.depth = 0;

    const result = rateListing(listing, [parent]);
    expect(result.matchedGroup?.id).toBe('parent');
    expect(result.showBadge).toBe(true);
  });
});
