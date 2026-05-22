import type {
  ParsedListing,
  PricingGroup,
  GroupStatistics,
  ListingAssessment,
  PriceRating,
  WeightedTokens,
} from "./types";

const OUTLIER_MIN_COUNT = 8;

export function computeStats(prices: number[]): GroupStatistics {
  if (prices.length === 0) {
    return {
      count: 0,
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      p25: 0,
      p75: 0,
      stdDev: 0,
      iqr: 0,
    };
  }

  const sorted = [...prices].sort((a, b) => a - b);
  const n = sorted.length;

  const min = sorted[0];
  const max = sorted[n - 1];
  const mean = sorted.reduce((s, v) => s + v, 0) / n;

  function percentile(p: number): number {
    const idx = p * (n - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  const median = percentile(0.5);
  const p25 = percentile(0.25);
  const p75 = percentile(0.75);
  const iqr = p75 - p25;

  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  return { count: n, min, max, mean, median, p25, p75, stdDev, iqr };
}

function removeOutliers(prices: number[]): number[] {
  if (prices.length < OUTLIER_MIN_COUNT) return prices;

  const sorted = [...prices].sort((a, b) => a - b);
  const n = sorted.length;

  function pct(p: number): number {
    const idx = p * (n - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  const median = pct(0.5);
  const iqr = pct(0.75) - pct(0.25);
  const fence = 2 * iqr;

  return prices.filter((p) => Math.abs(p - median) <= fence);
}

export function assignConfidence(
  group: Pick<PricingGroup, "stats">,
): "high" | "medium" | "low" | "insufficient" {
  const { count, iqr, median } = group.stats;
  if (count >= 10 && median > 0 && iqr / median < 0.4) return "high";
  if (count >= 5) return "medium";
  if (count >= 3) return "low";
  return "insufficient";
}

export function computeGroupStats(group: PricingGroup): void {
  if (group.children.length > 0) {
    for (const child of group.children) {
      computeGroupStats(child);
    }
    // Aggregate stats from children
    const allPrices = group.items.map((l) => l.totalPrice);
    group.stats = computeStats(removeOutliers(allPrices));
  } else {
    const prices = removeOutliers(group.items.map((l) => l.totalPrice));
    group.stats = computeStats(prices);
  }
  group.confidence = assignConfidence(group);
}

export function computeRelevance(
  group: PricingGroup,
  searchTermTokens: WeightedTokens,
): number {
  const centroidIdentity = new Set<string>();
  for (const item of group.items) {
    for (const tok of item.tokens.identity) {
      centroidIdentity.add(tok.toLowerCase());
    }
  }

  const searchSet = new Set(
    searchTermTokens.identity.map((t) => t.toLowerCase()),
  );
  if (centroidIdentity.size === 0 || searchSet.size === 0) return 0;

  let intersection = 0;
  for (const tok of searchSet) {
    if (centroidIdentity.has(tok)) intersection++;
  }

  const union = new Set([...centroidIdentity, ...searchSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function findDeepestConfidentGroup(
  listing: ParsedListing,
  group: PricingGroup,
): PricingGroup | null {
  if (!group.items.includes(listing)) return null;

  // Try children first (deeper = more specific)
  for (const child of group.children) {
    const match = findDeepestConfidentGroup(listing, child);
    if (match && match.confidence !== "insufficient") return match;
  }

  return group.confidence !== "insufficient" ? group : null;
}

export function rateListing(
  listing: ParsedListing,
  groups: PricingGroup[],
): ListingAssessment {
  let matchedGroup: PricingGroup | null = null;

  for (const root of groups) {
    const found = findDeepestConfidentGroup(listing, root);
    if (found) {
      matchedGroup = found;
      break;
    }
  }

  if (!matchedGroup) {
    return {
      listing,
      rating: "no-data",
      matchedGroup: null,
      percentile: null,
      showBadge: false,
    };
  }

  const { totalPrice } = listing;
  const { p25, p75 } = matchedGroup.stats;

  let rating: PriceRating;
  if (totalPrice < p25) rating = "good";
  else if (totalPrice > p75) rating = "high";
  else rating = "fair";

  const prices = matchedGroup.items
    .map((l) => l.totalPrice)
    .sort((a, b) => a - b);
  const below = prices.filter((p) => p < totalPrice).length;
  const percentile = prices.length > 0 ? below / prices.length : null;

  return { listing, rating, matchedGroup, percentile, showBadge: true };
}

