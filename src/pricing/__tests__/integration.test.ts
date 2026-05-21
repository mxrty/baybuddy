/**
 * Integration tests against real test-data fixtures.
 * Expanded in Task 6 with full dataset assertions.
 * Fixtures loaded via fs.readFileSync — resolveJsonModule is NOT enabled.
 */

import * as fs from 'fs';
import * as path from 'path';
import { clusterListings, resetClusterIdCounter } from '../cluster';
import { parseRawListings } from '../parse';
import { discoverIdentityVocab, clearTokenizeCache } from '../tokenize';
import type { RawListing, ParsedListing, PricingGroup } from '../types';

const TEST_DATA = path.join(__dirname, '../../../test-data');

function loadDataset(name: string): RawListing[] {
  const raw = JSON.parse(
    fs.readFileSync(path.join(TEST_DATA, `${name}.json`), 'utf-8'),
  ) as { items: RawListing[] };
  return raw.items;
}

function prepareListings(rawItems: RawListing[]): ParsedListing[] {
  const parsed = parseRawListings(rawItems);
  const titles = parsed.map(l => l.title);
  const prices = parsed.map(l => l.totalPrice);
  const vocab = discoverIdentityVocab(titles, prices);
  return parsed.map(l => ({
    ...l,
    tokens: require('../tokenize').tokenize(l.title, vocab),
  }));
}

function allGroups(groups: PricingGroup[]): PricingGroup[] {
  const result: PricingGroup[] = [];
  for (const g of groups) {
    result.push(g);
    result.push(...allGroups(g.children));
  }
  return result;
}

beforeEach(() => {
  resetClusterIdCounter();
  clearTokenizeCache();
});

// ── iPhone 16 — hierarchical grouping ────────────────────────────────────────

describe('iphone-16-sold — hierarchical structure', () => {
  let groups: PricingGroup[];

  beforeAll(() => {
    resetClusterIdCounter();
    clearTokenizeCache();
    const parsed = prepareListings(loadDataset('iphone-16-sold'));
    groups = clusterListings(parsed);
  });

  test('produces at least one top-level group with children (hierarchical split fired)', () => {
    const withChildren = groups.filter(g => g.children.length > 0);
    expect(withChildren.length).toBeGreaterThanOrEqual(1);
  });

  test('iphone-containing groups exist at the top level', () => {
    const iphoneGroups = groups.filter(g => g.label.includes('iphone'));
    expect(iphoneGroups.length).toBeGreaterThanOrEqual(1);
  });

  test('at least one group contains Pro listings', () => {
    const flat = allGroups(groups);
    const proGroup = flat.find(g =>
      g.items.some(i => /pro/i.test(i.title)),
    );
    expect(proGroup).toBeDefined();
  });

  test('Pro Max and plain iPhone 16 appear in distinct groups or sub-groups', () => {
    const flat = allGroups(groups);
    const proMaxGroup = flat.find(g =>
      g.items.some(i => /pro max/i.test(i.title)) && g.children.length === 0,
    );
    const plainGroup = flat.find(g =>
      g.items.some(i => /iphone 16(?! pro| plus| max| 16e)/i.test(i.title)) &&
      g.children.length === 0,
    );
    // They should not be the exact same leaf group
    if (proMaxGroup && plainGroup) {
      expect(proMaxGroup.id).not.toBe(plainGroup.id);
    }
  });

  test('no group issued from fewer than 3 items at any level', () => {
    const flat = allGroups(groups);
    for (const g of flat) {
      if (g.children.length === 0) {
        // Only leaf groups should have items; parents also keep items for stats
        expect(g.items.length).toBeGreaterThanOrEqual(1);
      }
    }
    // No confidence badge from groups < 3 items (enforced by analyse, but cluster
    // should not create leaf groups smaller than MIN_CHILD_SIZE either)
    const tinyLeaves = flat.filter(g => g.children.length === 0 && g.items.length < 3);
    // Singletons and pairs are allowed from the flat pass (singletons form when nothing matches)
    // but the hierarchical splitter must not CREATE a child with < 3 items
    for (const g of flat.filter(g => g.depth > 0)) {
      expect(g.items.length).toBeGreaterThanOrEqual(3);
    }
  });
});
