export interface Settings {
  hideCollectionOnly: boolean;
  localItemsOnly: boolean;
  priceBadges: boolean;
  excludeBroken: boolean;
  stickyFilters: boolean;
  confidenceThreshold: number;
}

export function detectCurrency(host: string): string {
  if (host.includes('ebay.co.uk')) return '£';
  if (host.includes('ebay.com.au')) return 'AU $';
  if (host.includes('ebay.ca')) return 'C $';
  if (host.includes('ebay.de') || host.includes('ebay.fr') || host.includes('ebay.it') || host.includes('ebay.es') || host.includes('ebay.ie') || host.includes('ebay.nl') || host.includes('ebay.at')) return '€';
  return '$';
}

export function parsePriceText(text: string): number | null {
  let cleaned = text.replace(/[£$€,]/g, '').replace(/AU\s*/i, '').replace(/US\s*/i, '').replace(/C\s*/i, '').trim();

  const match = cleaned.match(/[\d]+(\.[\d]+)?/g);
  if (!match) return null;

  if (cleaned.includes(' to ') && match.length >= 2) {
    const low  = parseFloat(match[0]);
    const high = parseFloat(match[1]);
    if (!isNaN(low) && !isNaN(high)) return (low + high) / 2;
  }

  const val = parseFloat(match[0]);
  return isNaN(val) ? null : val;
}

export function tokenizeTitle(title: string): Set<string> {
  let cleaned = title.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  let tokens = cleaned.split(/\s+/);
  const noise = ['free', 'postage', 'fast', 'delivery', 'brand', 'new', 'sealed', 'controller', 'bundle', 'black', 'white', 'box', 'unboxed', 'mint', 'condition', 'excellent', 'good', 'used', 'uk'];
  return new Set(tokens.filter(t => t.length > 1 && !noise.includes(t)));
}

export function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (let item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

export interface ListingItem {
  card: Element | null;
  title: string;
  price: number | null;
  condition: string;
  tokens: Set<string>;
}

export interface Cluster {
  items: ListingItem[];
}

export function clusterListings(listings: ListingItem[], confidenceThreshold: number): Cluster[] {
  const threshold = confidenceThreshold / 100;
  const clusters: Cluster[] = [];

  for (const item of listings) {
    let bestCluster: Cluster | null = null;
    let bestScore = -1;

    for (const cluster of clusters) {
      const score = jaccardSimilarity(item.tokens, cluster.items[0].tokens);
      if (score > bestScore) {
        bestScore = score;
        bestCluster = cluster;
      }
    }

    if (bestScore >= threshold && bestCluster) {
      bestCluster.items.push(item);
    } else {
      clusters.push({ items: [item] });
    }
  }

  return clusters;
}

export interface GroupStats {
  mean: number;
  stdDev: number;
  validItems: ListingItem[];
}

export function calculateGroupStats(items: ListingItem[], excludeBroken: boolean): GroupStats | null {
  const validItems = items.filter(item => {
    if (item.price === null || isNaN(item.price)) return false;
    if (excludeBroken) {
      const cond = item.condition;
      if (cond.includes('parts') || cond.includes('repair') || cond.includes('faulty') || cond.includes('broken')) {
        return false;
      }
    }
    return true;
  });

  if (validItems.length < 2) return null;

  const prices = validItems.map(i => i.price as number);
  const sum = prices.reduce((a, b) => a + b, 0);
  const mean = sum / prices.length;

  const sqDiffs = prices.map(p => Math.pow(p - mean, 2));
  const avgSqDiff = sqDiffs.reduce((a, b) => a + b, 0) / prices.length;
  const stdDev = Math.sqrt(avgSqDiff);

  return { mean, stdDev, validItems };
}
