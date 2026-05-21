import type { RawListing, ParsedListing } from './types';

const TITLE_NOISE = [
  'Opens in a new window or tab',
  'New listing',
];

export function cleanTitle(title: string): string {
  let out = title;
  for (const phrase of TITLE_NOISE) {
    out = out.split(phrase).join('');
  }
  return out.trim();
}

export function parsePriceText(text: string): number {
  const cleaned = text
    .replace(/[£$€,]/g, '')
    .replace(/AU\s*/i, '')
    .replace(/US\s*/i, '')
    .replace(/C\s*/i, '')
    .trim();

  const match = cleaned.match(/[\d]+(\.[\d]+)?/g);
  if (!match) return 0;

  if (cleaned.includes(' to ') && match.length >= 2) {
    const low = parseFloat(match[0]);
    const high = parseFloat(match[1]);
    if (!isNaN(low) && !isNaN(high)) return (low + high) / 2;
  }

  const val = parseFloat(match[0]);
  return isNaN(val) ? 0 : val;
}

export function parsePostageFromText(text: string): { postage: number; postageKnown: boolean } {
  if (!text) return { postage: 0, postageKnown: false };

  const lower = text.toLowerCase();

  if (
    lower.includes('free delivery') ||
    lower.includes('free postage') ||
    lower.includes('free collection') ||
    lower.includes('collection in person') ||
    lower.includes('collection only')
  ) {
    return { postage: 0, postageKnown: true };
  }

  // "+£5.21 delivery" or "+£5.21 delivery Click & Collect" — strip trailing noise first
  const plusMatch = text.match(/^\+[£$€]?([\d,]+\.?\d*)/);
  if (plusMatch) {
    const val = parseFloat(plusMatch[1].replace(/,/g, ''));
    if (!isNaN(val)) return { postage: val, postageKnown: true };
  }

  if (lower === 'postage not specified') {
    return { postage: 0, postageKnown: false };
  }

  // "delivery in 2-3 days" style — no price info
  if (lower.startsWith('delivery in') || lower.startsWith('free delivery in')) {
    return { postage: 0, postageKnown: true };
  }

  // Catch-all for any remaining "Free …" variants
  if (lower.startsWith('free')) {
    return { postage: 0, postageKnown: true };
  }

  return { postage: 0, postageKnown: false };
}

const JUNK_TITLE = 'shop on ebay';
const JUNK_PRICE_PATTERN = /^\$20\.00$/;

export function isJunk(item: RawListing): boolean {
  if (item.title.trim().toLowerCase() === JUNK_TITLE) return true;
  if (JUNK_PRICE_PATTERN.test(item.priceText.trim()) && item.title.trim().toLowerCase() === JUNK_TITLE) return true;
  return false;
}

const EXCLUDED_CONDITIONS = ['for parts', 'spares or repair', 'not working'];

export function isExcluded(item: RawListing): boolean {
  const cond = item.condition.toLowerCase();
  return EXCLUDED_CONDITIONS.some(phrase => cond.includes(phrase));
}

export function parseRawListings(items: RawListing[]): ParsedListing[] {
  return items.map(item => {
    const junk = isJunk(item);
    const excluded = isExcluded(item);
    const title = cleanTitle(item.title);
    const itemPrice = parsePriceText(item.priceText);
    const { postage, postageKnown } = parsePostageFromText(item.deliveryText);
    const totalPrice = itemPrice + postage;

    return {
      title,
      itemPrice,
      postage,
      postageKnown,
      totalPrice,
      condition: item.condition,
      link: item.link,
      tokens: { identity: [], descriptors: [], noise: new Set(), raw: new Set() },
      isJunk: junk,
      isExcluded: excluded,
    };
  });
}
