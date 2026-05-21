import { detectCurrency } from '../utils';

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
});
