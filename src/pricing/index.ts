import {
  clearTokenizeCache,
  discoverIdentityVocab,
  tokenize,
} from "./tokenize";
import { parseRawListings } from "./parse";
import { resetClusterIdCounter, clusterListings } from "./cluster";
import { computeGroupStats, computeRelevance, rateListing } from "./analyse";
import type {
  RawListing,
  PricingResult,
  PricingSettings,
  PricingGroup,
} from "./types";

export type {
  RawListing,
  ParsedListing,
  PricingGroup,
  PricingResult,
  PricingSettings,
} from "./types";

function allLeafGroups(groups: PricingGroup[]): PricingGroup[] {
  const result: PricingGroup[] = [];
  for (const g of groups) {
    if (g.children.length === 0) {
      result.push(g);
    } else {
      result.push(...allLeafGroups(g.children));
    }
  }
  return result;
}

export function analysePricing(
  rawListings: RawListing[],
  searchTerm: string,
  settings?: PricingSettings,
): PricingResult {
  clearTokenizeCache();
  resetClusterIdCounter();

  const parsed = parseRawListings(rawListings);
  const filteredOut = parsed.filter((l) => l.isJunk || l.isExcluded).length;
  const active = parsed.filter((l) => !l.isJunk && !l.isExcluded);

  const titles = active.map((l) => l.title);
  const prices = active.map((l) => l.totalPrice);
  const vocab = discoverIdentityVocab(titles, prices);

  const withTokens = active.map((l) => ({
    ...l,
    tokens: tokenize(l.title, vocab),
  }));

  const clusterOptions =
    settings?.similarityThreshold !== undefined
      ? { similarityThreshold: settings.similarityThreshold }
      : undefined;

  const rootGroups = clusterListings(withTokens, clusterOptions);

  // Compute stats and confidence for every group in the hierarchy
  for (const g of rootGroups) {
    computeGroupStats(g);
  }

  // Compute relevance scores vs search term
  const searchVocab = discoverIdentityVocab([searchTerm]);
  const searchTokens = tokenize(searchTerm, searchVocab);

  function assignRelevance(groups: PricingGroup[]): void {
    for (const g of groups) {
      g.relevanceScore = computeRelevance(g, searchTokens);
      assignRelevance(g.children);
    }
  }
  assignRelevance(rootGroups);

  // Sort root groups by relevance desc, then count desc
  rootGroups.sort(
    (a, b) =>
      b.relevanceScore - a.relevanceScore || b.stats.count - a.stats.count,
  );

  // Rate each active listing
  const assessments = withTokens.map((listing) =>
    rateListing(listing, rootGroups),
  );

  const allPrices = active.map((l) => l.totalPrice).filter((p) => p > 0);
  const overallMin = allPrices.length > 0 ? Math.min(...allPrices) : 0;
  const overallMax = allPrices.length > 0 ? Math.max(...allPrices) : 0;

  return {
    rootGroups,
    assessments,
    summary: {
      totalListingsAnalysed: active.length,
      totalGroups: allLeafGroups(rootGroups).length,
      filteredOut,
      overallPriceRange: { min: overallMin, max: overallMax },
    },
    searchTerm,
  };
}
