import {
  detectCurrency,
  parsePriceText,
  tokenizeTitle,
  jaccardSimilarity,
  clusterListings,
  calculateGroupStats,
  ListingItem
} from '../utils';

describe('utils', () => {
  describe('detectCurrency', () => {
    it('detects £ for UK', () => {
      expect(detectCurrency('www.ebay.co.uk')).toBe('£');
    });
    it('detects $ for US', () => {
      expect(detectCurrency('www.ebay.com')).toBe('$');
    });
    it('detects AU $ for Australia', () => {
      expect(detectCurrency('www.ebay.com.au')).toBe('AU $');
    });
    it('detects € for Germany', () => {
      expect(detectCurrency('www.ebay.de')).toBe('€');
    });
  });

  describe('parsePriceText', () => {
    it('parses standard prices', () => {
      expect(parsePriceText('£15.99')).toBe(15.99);
      expect(parsePriceText('US $10.00')).toBe(10);
      expect(parsePriceText('AU $20.50')).toBe(20.5);
    });
    it('handles ranges', () => {
      expect(parsePriceText('£10.00 to £20.00')).toBe(15);
    });
    it('returns null for invalid inputs', () => {
      expect(parsePriceText('Sold Item')).toBe(null);
    });
  });

  describe('tokenizeTitle', () => {
    it('tokenizes and removes noise words', () => {
      const tokens = tokenizeTitle('Free Postage BRAND NEW Xbox Series X 1TB Console black');
      expect(tokens.has('xbox')).toBe(true);
      expect(tokens.has('series')).toBe(true);
      expect(tokens.has('1tb')).toBe(true);
      expect(tokens.has('console')).toBe(true);
      expect(tokens.has('free')).toBe(false);
      expect(tokens.has('brand')).toBe(false);
      expect(tokens.has('black')).toBe(false);
    });
  });

  describe('jaccardSimilarity', () => {
    it('calculates correctly', () => {
      const a = new Set(['xbox', 'series', 'x']);
      const b = new Set(['xbox', 'series', 's']);
      expect(jaccardSimilarity(a, b)).toBe(0.5); // 2 shared, 4 total unique
    });
  });

  describe('clusterListings', () => {
    it('groups similar items', () => {
      const items: ListingItem[] = [
        { card: null, title: 'Xbox Series X 1TB', price: 300, condition: 'used', tokens: tokenizeTitle('Xbox Series X 1TB') },
        { card: null, title: 'Xbox Series X console 1TB', price: 310, condition: 'used', tokens: tokenizeTitle('Xbox Series X console 1TB') },
        { card: null, title: 'Xbox Series S 512GB', price: 150, condition: 'used', tokens: tokenizeTitle('Xbox Series S 512GB') },
      ];
      const clusters = clusterListings(items, 70); // 70%
      expect(clusters.length).toBe(2);
      expect(clusters[0].items.length).toBe(2);
      expect(clusters[1].items.length).toBe(1);
    });
  });

  describe('calculateGroupStats', () => {
    it('calculates mean and std dev and excludes broken items', () => {
      const items: ListingItem[] = [
        { card: null, title: 'Item 1', price: 100, condition: 'used', tokens: new Set() },
        { card: null, title: 'Item 2', price: 120, condition: 'used', tokens: new Set() },
        { card: null, title: 'Item 3', price: 10, condition: 'for parts or not working', tokens: new Set() },
      ];
      
      const stats1 = calculateGroupStats(items, true); // exclude broken
      expect(stats1?.mean).toBe(110);
      expect(stats1?.validItems.length).toBe(2);
      
      const stats2 = calculateGroupStats(items, false); // include broken
      expect(stats2?.validItems.length).toBe(3);
    });
  });
});
