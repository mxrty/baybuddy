import * as fs from 'fs';
import * as path from 'path';
import {
  cleanTitle,
  parsePriceText,
  parsePostageFromText,
  isJunk,
  isExcluded,
  isMultiVariant,
  parseRawListings,
} from '../parse';
import type { RawListing } from '../types';

// ── cleanTitle ────────────────────────────────────────────────────────────────

describe('cleanTitle', () => {
  test('strips "Opens in a new window or tab"', () => {
    expect(cleanTitle('Xbox Series X Console Opens in a new window or tab')).toBe('Xbox Series X Console');
  });

  test('strips "New listing" prefix', () => {
    expect(cleanTitle('New listingApple iphone 16 Pro 128gb Unlocked')).toBe('Apple iphone 16 Pro 128gb Unlocked');
  });

  test('strips multiple noise phrases', () => {
    const title = 'New listingXbox One S 1Tb ConsoleOpens in a new window or tab';
    expect(cleanTitle(title)).toBe('Xbox One S 1Tb Console');
  });

  test('returns clean titles unchanged', () => {
    expect(cleanTitle('Nintendo Switch OLED 64GB')).toBe('Nintendo Switch OLED 64GB');
  });

  test('trims surrounding whitespace', () => {
    expect(cleanTitle('  Xbox  ')).toBe('Xbox');
  });
});

// ── parsePriceText ────────────────────────────────────────────────────────────

describe('parsePriceText', () => {
  test('parses GBP price', () => {
    expect(parsePriceText('£35.02')).toBeCloseTo(35.02);
  });

  test('parses USD price', () => {
    expect(parsePriceText('$20.00')).toBeCloseTo(20.0);
  });

  test('parses price with commas', () => {
    expect(parsePriceText('£1,400.00')).toBeCloseTo(1400.0);
  });

  test('returns midpoint for range', () => {
    expect(parsePriceText('£10.00 to £25.00')).toBeCloseTo(17.5);
  });

  test('handles AU $ prefix', () => {
    expect(parsePriceText('AU $45.00')).toBeCloseTo(45.0);
  });

  test('returns 0 for unparseable text', () => {
    expect(parsePriceText('N/A')).toBe(0);
  });

  test('handles EUR', () => {
    expect(parsePriceText('€99.99')).toBeCloseTo(99.99);
  });
});

// ── parsePostageFromText ──────────────────────────────────────────────────────

describe('parsePostageFromText', () => {
  test('Free delivery → 0, known', () => {
    expect(parsePostageFromText('Free delivery')).toEqual({ postage: 0, postageKnown: true });
  });

  test('Free delivery Click & Collect → 0, known', () => {
    expect(parsePostageFromText('Free delivery Click & Collect')).toEqual({ postage: 0, postageKnown: true });
  });

  test('Free delivery in 2 days → 0, known', () => {
    expect(parsePostageFromText('Free delivery in 2 days')).toEqual({ postage: 0, postageKnown: true });
  });

  test('Free delivery in 3 days Click & Collect → 0, known', () => {
    expect(parsePostageFromText('Free delivery in 3 days Click & Collect')).toEqual({ postage: 0, postageKnown: true });
  });

  test('+£2.94 delivery → 2.94, known', () => {
    expect(parsePostageFromText('+£2.94 delivery')).toEqual({ postage: 2.94, postageKnown: true });
  });

  test('+£5.88 delivery → 5.88, known', () => {
    expect(parsePostageFromText('+£5.88 delivery')).toEqual({ postage: 5.88, postageKnown: true });
  });

  test('+£11.95 delivery Click & Collect → 11.95, known', () => {
    const result = parsePostageFromText('+£11.95 delivery Click & Collect');
    expect(result).toEqual({ postage: 11.95, postageKnown: true });
  });

  test('+£3.38 delivery divs_collectables → 3.38, known', () => {
    const result = parsePostageFromText('+£3.38 delivery divs_collectables');
    expect(result).toEqual({ postage: 3.38, postageKnown: true });
  });

  test('Postage not specified → 0, unknown', () => {
    expect(parsePostageFromText('Postage not specified')).toEqual({ postage: 0, postageKnown: false });
  });

  test('Free collection in person → 0, known', () => {
    expect(parsePostageFromText('Free collection in person')).toEqual({ postage: 0, postageKnown: true });
  });

  test('empty string → 0, unknown', () => {
    expect(parsePostageFromText('')).toEqual({ postage: 0, postageKnown: false });
  });

  test('delivery in 2-3 days → 0, known (no cost, just time estimate)', () => {
    expect(parsePostageFromText('delivery in 2-3 days')).toEqual({ postage: 0, postageKnown: true });
  });

  test('delivery in 3 days Click & Collect → 0, known', () => {
    expect(parsePostageFromText('delivery in 3 days Click & Collect')).toEqual({ postage: 0, postageKnown: true });
  });

  // Title-leak prefix: the deliveryText sometimes has long seller blurb prepended
  test('long seller blurb ending in Free delivery → 0, known', () => {
    const text = 'Official Dyson Outlet | Free Delivery | 30 Day Returns Free delivery';
    expect(parsePostageFromText(text)).toEqual({ postage: 0, postageKnown: true });
  });

  test('FAST & FREE DELIVERY!! Free delivery → 0, known', () => {
    expect(parsePostageFromText('FAST & FREE DELIVERY!! Free delivery')).toEqual({ postage: 0, postageKnown: true });
  });

  test('+£41.39 delivery → 41.39, known', () => {
    expect(parsePostageFromText('+£41.39 delivery')).toEqual({ postage: 41.39, postageKnown: true });
  });
});

// ── isJunk ────────────────────────────────────────────────────────────────────

describe('isJunk', () => {
  const makeItem = (title: string, priceText = '$20.00'): RawListing => ({
    title, priceText, condition: 'Brand New', link: '', deliveryText: '',
  });

  test('flags "Shop on eBay" (exact)', () => {
    expect(isJunk(makeItem('Shop on eBay'))).toBe(true);
  });

  test('case-insensitive "shop on ebay"', () => {
    expect(isJunk(makeItem('shop on ebay'))).toBe(true);
  });

  test('does not flag real listings', () => {
    expect(isJunk(makeItem('Xbox Series X Console', '£299.99'))).toBe(false);
  });

  test('does not flag listings with similar price but real title', () => {
    expect(isJunk(makeItem('Budget Stoneware Set', '$20.00'))).toBe(false);
  });

  test('does not flag air purifier listing', () => {
    const item = makeItem('Shark NEVERCHANGE5 Compact Pro Air Purifier HP072UK', '£115.10');
    expect(isJunk(item)).toBe(false);
  });
});

// ── isExcluded ────────────────────────────────────────────────────────────────

describe('isExcluded', () => {
  const makeItem = (condition: string): RawListing => ({
    title: 'Xbox', priceText: '£50.00', condition, link: '', deliveryText: '',
  });

  test('excludes "For parts or not working"', () => {
    expect(isExcluded(makeItem('For parts or not working'))).toBe(true);
  });

  test('excludes "Spares or repair"', () => {
    expect(isExcluded(makeItem('Spares or repair'))).toBe(true);
  });

  test('excludes "Not working"', () => {
    expect(isExcluded(makeItem('Not working'))).toBe(true);
  });

  test('does not exclude "Pre-owned"', () => {
    expect(isExcluded(makeItem('Pre-owned'))).toBe(false);
  });

  test('does not exclude "Good - Refurbished"', () => {
    expect(isExcluded(makeItem('Good - Refurbished'))).toBe(false);
  });

  test('excludes "Parts only" condition (new .s-card layout subtitle)', () => {
    expect(isExcluded(makeItem('Parts only ·'))).toBe(true);
  });

  test('excludes item with "for parts" in title', () => {
    const item: RawListing = { title: 'iPhone 16 for parts', priceText: '£50.00', condition: '', link: '', deliveryText: '' };
    expect(isExcluded(item)).toBe(true);
  });

  test('excludes item with "faulty" in title', () => {
    const item: RawListing = { title: 'Dyson V11 faulty motor', priceText: '£30.00', condition: '', link: '', deliveryText: '' };
    expect(isExcluded(item)).toBe(true);
  });

  test('excludes item with "cracked screen" in title', () => {
    const item: RawListing = { title: 'Apple iPhone 16 cracked screen', priceText: '£100.00', condition: 'Pre-owned', link: '', deliveryText: '' };
    expect(isExcluded(item)).toBe(true);
  });

  test('does not exclude normal listing with no defect phrases', () => {
    const item: RawListing = { title: 'Apple iPhone 16 128GB Unlocked', priceText: '£650.00', condition: 'Pre-owned', link: '', deliveryText: '' };
    expect(isExcluded(item)).toBe(false);
  });
});

// ── isMultiVariant ────────────────────────────────────────────────────────────

describe('isMultiVariant', () => {
  const makeItem = (title: string, priceText = '£100.00'): RawListing => ({
    title, priceText, condition: 'Pre-owned', link: '', deliveryText: '',
  });

  test('flags listing with price range', () => {
    expect(isMultiVariant(makeItem('Apple iPhone 16', '£576.99 to £764.99'))).toBe(true);
  });

  test('flags listing with multiple capacity tokens in title', () => {
    expect(isMultiVariant(makeItem('Apple iPhone 16 - 128GB 256GB 512GB All Colours'))).toBe(true);
  });

  test('flags "all colours" in title', () => {
    expect(isMultiVariant(makeItem('Apple iPhone 16 128GB all colours'))).toBe(true);
  });

  test('flags "all colors" in title', () => {
    expect(isMultiVariant(makeItem('Samsung Galaxy S24 128GB all colors'))).toBe(true);
  });

  test('flags "all sizes" in title', () => {
    expect(isMultiVariant(makeItem('Nike Air Max all sizes'))).toBe(true);
  });

  test('does not flag single-variant listing', () => {
    expect(isMultiVariant(makeItem('Apple iPhone 16 128GB Black Unlocked'))).toBe(false);
  });

  test('does not flag single capacity token', () => {
    expect(isMultiVariant(makeItem('Apple iPhone 16 256GB'))).toBe(false);
  });

  test('multi-variant listing is marked excluded in parseRawListings', () => {
    const items: RawListing[] = [{
      title: 'Apple iPhone 16 - 128GB 256GB 512GB / All Colours',
      priceText: '£576.99 to £764.99',
      condition: 'Pre-owned',
      link: '',
      deliveryText: 'Free delivery',
    }];
    expect(parseRawListings(items)[0].isExcluded).toBe(true);
  });
});

// ── parseRawListings ──────────────────────────────────────────────────────────

describe('parseRawListings', () => {
  test('sets totalPrice = itemPrice + postage', () => {
    const items: RawListing[] = [{
      title: 'Xbox One S 1Tb Console',
      priceText: '£109.99',
      condition: 'Pre-owned',
      link: 'https://example.com',
      deliveryText: '+£5.88 delivery',
    }];
    const [result] = parseRawListings(items);
    expect(result.itemPrice).toBeCloseTo(109.99);
    expect(result.postage).toBeCloseTo(5.88);
    expect(result.totalPrice).toBeCloseTo(115.87);
    expect(result.postageKnown).toBe(true);
  });

  test('marks junk items', () => {
    const items: RawListing[] = [{
      title: 'Shop on eBay', priceText: '$20.00', condition: 'Brand New', link: '', deliveryText: '',
    }];
    expect(parseRawListings(items)[0].isJunk).toBe(true);
  });

  test('marks excluded items', () => {
    const items: RawListing[] = [{
      title: 'Xbox for parts', priceText: '£10.00', condition: 'For parts or not working', link: '', deliveryText: 'Free delivery',
    }];
    expect(parseRawListings(items)[0].isExcluded).toBe(true);
  });

  test('cleans title', () => {
    const items: RawListing[] = [{
      title: 'New listingXbox Series XOpens in a new window or tab',
      priceText: '£299.99',
      condition: 'Pre-owned',
      link: '',
      deliveryText: 'Free delivery',
    }];
    expect(parseRawListings(items)[0].title).toBe('Xbox Series X');
  });
});

// ── Integration: unknown postage rate across all datasets ─────────────────────

describe('unknown postage rate per dataset', () => {
  const testDataDir = path.join(__dirname, '../../../test-data');
  const files = fs.readdirSync(testDataDir).filter(f => f.endsWith('.json') && f !== 'schema.json');

  for (const file of files) {
    test(`${file}: unknown postage rate ≤ 5%`, () => {
      const raw = JSON.parse(fs.readFileSync(path.join(testDataDir, file), 'utf-8'));
      const items: RawListing[] = (Array.isArray(raw) ? raw : raw.items ?? []).filter(
        (i: RawListing) => i && i.title && i.priceText,
      );

      const parsed = parseRawListings(items);
      const withDeliveryText = parsed.filter((_, idx) => items[idx].deliveryText.trim() !== '');
      const unknownPostage = withDeliveryText.filter(p => !p.postageKnown);

      const rate = withDeliveryText.length === 0 ? 0 : unknownPostage.length / withDeliveryText.length;
      const pct = (rate * 100).toFixed(1);

      console.log(`  ${file}: unknown postage ${unknownPostage.length}/${withDeliveryText.length} (${pct}%)`);

      expect(rate).toBeLessThanOrEqual(0.05);
    });
  }
});
