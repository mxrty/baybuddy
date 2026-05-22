import {
  clearTokenizeCache,
  discoverIdentityVocab,
  tokenize,
} from "./tokenize";
import { dbg, dbgGroupStart, dbgGroupEnd } from "../debug";
import { parseRawListings } from "./parse";
import { resetClusterIdCounter, clusterListings } from "./cluster";
import {
  computeGroupStats,
  computeRelevance,
  computeStats,
  rateListing,
  rateListingVsSold,
} from "./analyse";
import type {
  RawListing,
  PricingResult,
  PricingSettings,
  PricingGroup,
  ParsedListing,
  GroupStatistics,
} from "./types";

export type {
  RawListing,
  ParsedListing,
  PricingGroup,
  PricingResult,
  PricingSettings,
} from "./types";

/**
 * Merge targeted gap-fill comps into existing sold groups and re-rate active listings.
 *
 * compsPerGroup maps a sold PricingGroup to the raw listings fetched for it.
 * New comps are parsed, tokenized with a vocab rebuilt from the group's existing items
 * plus the new comps (preserving correct centroid contributions), then appended to the
 * group. Stats are recomputed and all active assessments are re-rated.
 *
 * Returns the original result unchanged if compsPerGroup is empty.
 */
export function mergeGapFillComps(
  result: PricingResult,
  compsPerGroup: Map<PricingGroup, RawListing[]>,
): PricingResult {
  if (compsPerGroup.size === 0) return result;

  const modifiedGroups = new Set<PricingGroup>();

  for (const [group, rawComps] of compsPerGroup) {
    if (rawComps.length === 0) continue;

    const newParsed = parseRawListings(rawComps).filter(
      (l) => !l.isJunk && !l.isExcluded,
    );
    if (newParsed.length === 0) continue;

    // Build vocab from the union of existing items + new comps so new items
    // produce the same identity tokens that the existing centroid uses.
    const existingTitles = group.items.map((l) => l.title);
    const existingPrices = group.items.map((l) => l.totalPrice);
    const newTitles = newParsed.map((l) => l.title);
    const newPrices = newParsed.map((l) => l.totalPrice);
    const vocab = discoverIdentityVocab(
      [...existingTitles, ...newTitles],
      [...existingPrices, ...newPrices],
    );

    const tokenized: ParsedListing[] = newParsed.map((l) => ({
      ...l,
      tokens: tokenize(l.title, vocab),
    }));

    group.items.push(...tokenized);
    modifiedGroups.add(group);
  }

  if (modifiedGroups.size === 0) return result;

  for (const g of modifiedGroups) {
    computeGroupStats(g);
  }

  const newAssessments = result.assessments.map((a) =>
    rateListingVsSold(a.listing, result.rootGroups),
  );

  return { ...result, assessments: newAssessments };
}

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

  dbgGroupStart("parse", `active corpus — ${rawListings.length} raw`);
  dbg("parse", "summary", () => ({
    rawCount: rawListings.length,
    junkCount: parsed.filter((l) => l.isJunk).length,
    junkTitles: parsed.filter((l) => l.isJunk).map((l) => l.title),
    excludedCount: parsed.filter((l) => l.isExcluded).length,
    excludedTitles: parsed.filter((l) => l.isExcluded).map((l) => l.title),
    parsedOkCount: active.length,
  }));
  dbg("parse", "per-listing", () =>
    parsed.map((l) => ({
      title: l.title,
      itemPrice: l.itemPrice,
      postage: l.postage,
      totalPrice: l.totalPrice,
      isJunk: l.isJunk,
      isExcluded: l.isExcluded,
    }))
  );
  dbgGroupEnd();

  const titles = active.map((l) => l.title);
  const prices = active.map((l) => l.totalPrice);
  const vocab = discoverIdentityVocab(titles, prices);

  const withTokens = active.map((l) => ({
    ...l,
    tokens: tokenize(l.title, vocab),
  }));

  dbgGroupStart("tokenize", `active corpus — vocab size ${vocab.size}`);
  dbg("tokenize", "identity vocab", () => ({ identityTokens: [...vocab] }));
  dbg("tokenize", "per-listing breakdown", () =>
    withTokens.map((l) => ({
      title: l.title,
      identity: l.tokens.identity,
      descriptors: l.tokens.descriptors,
      noise: [...l.tokens.noise],
    }))
  );
  dbgGroupEnd();

  const clusterOptions =
    settings?.similarityThreshold !== undefined
      ? { similarityThreshold: settings.similarityThreshold }
      : undefined;

  const rootGroups = clusterListings(withTokens, clusterOptions);

  dbgGroupStart("cluster", `active corpus — ${rootGroups.length} root groups`);
  dbg("cluster", "group summary", () =>
    rootGroups.map((g) => ({
      groupId: g.id,
      label: g.label,
      memberCount: g.items.length,
      depth: g.depth,
      childCount: g.children.length,
    }))
  );
  dbgGroupEnd();

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

  dbgGroupStart("analyse", "active corpus — ratings");
  dbg("analyse", "group confidence", () =>
    rootGroups.map((g) => ({
      groupLabel: g.label,
      count: g.stats.count,
      median: g.stats.median,
      iqr: g.stats.iqr,
      iqrRatio: g.stats.median > 0 ? g.stats.iqr / g.stats.median : null,
      confidence: g.confidence,
    }))
  );
  dbg("analyse", "per-listing rating", () =>
    assessments.map((a) => ({
      title: a.listing.title,
      matchedGroup: a.matchedGroup?.label ?? null,
      p25: a.matchedGroup?.stats.p25 ?? null,
      p75: a.matchedGroup?.stats.p75 ?? null,
      median: a.matchedGroup?.stats.median ?? null,
      totalPrice: a.listing.totalPrice,
      rating: a.rating,
      percentile: a.percentile,
    }))
  );
  dbgGroupEnd();

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

/**
 * Rate active listings against sold-data reference groups.
 * Clusters the sold corpus to build price stats, then matches each active
 * listing to the nearest sold group and rates it against that group's stats.
 */
export function analysePricingVsSold(
  activeRaw: RawListing[],
  soldRaw: RawListing[],
  searchTerm: string,
  settings?: PricingSettings,
): PricingResult {
  clearTokenizeCache();
  resetClusterIdCounter();

  // Parse both corpora and filter junk/excluded
  const parsedSold = parseRawListings(soldRaw);
  const soldFiltered = parsedSold.filter((l) => !l.isJunk && !l.isExcluded);

  const parsedActive = parseRawListings(activeRaw);
  const activeFiltered = parsedActive.filter((l) => !l.isJunk && !l.isExcluded);
  const filteredOut = parsedActive.filter((l) => l.isJunk || l.isExcluded).length;

  dbgGroupStart("parse", `sold corpus — ${soldRaw.length} raw`);
  dbg("parse", "summary", () => ({
    rawCount: soldRaw.length,
    junkCount: parsedSold.filter((l) => l.isJunk).length,
    junkTitles: parsedSold.filter((l) => l.isJunk).map((l) => l.title),
    excludedCount: parsedSold.filter((l) => l.isExcluded).length,
    excludedTitles: parsedSold.filter((l) => l.isExcluded).map((l) => l.title),
    parsedOkCount: soldFiltered.length,
  }));
  dbgGroupEnd();

  dbgGroupStart("parse", `active corpus (vs sold) — ${activeRaw.length} raw`);
  dbg("parse", "summary", () => ({
    rawCount: activeRaw.length,
    junkCount: parsedActive.filter((l) => l.isJunk).length,
    excludedCount: parsedActive.filter((l) => l.isExcluded).length,
    parsedOkCount: activeFiltered.length,
  }));
  dbgGroupEnd();

  // Build vocabulary from the sold corpus (the reference)
  const soldTitles = soldFiltered.map((l) => l.title);
  const soldPrices = soldFiltered.map((l) => l.totalPrice);
  const vocab = discoverIdentityVocab(soldTitles, soldPrices);

  // Cluster sold listings → reference price groups with stats
  const soldWithTokens = soldFiltered.map((l) => ({
    ...l,
    tokens: tokenize(l.title, vocab),
  }));

  dbgGroupStart("tokenize", `sold corpus — vocab size ${vocab.size}`);
  dbg("tokenize", "identity vocab", () => ({ identityTokens: [...vocab] }));
  dbg("tokenize", "per-listing breakdown", () =>
    soldWithTokens.map((l) => ({
      title: l.title,
      identity: l.tokens.identity,
      descriptors: l.tokens.descriptors,
      noise: [...l.tokens.noise],
    }))
  );
  dbgGroupEnd();

  const clusterOptions =
    settings?.similarityThreshold !== undefined
      ? { similarityThreshold: settings.similarityThreshold }
      : undefined;

  const rootGroups = clusterListings(soldWithTokens, clusterOptions);

  dbgGroupStart("cluster", `sold corpus — ${rootGroups.length} root groups`);
  dbg("cluster", "group summary", () =>
    rootGroups.map((g) => ({
      groupId: g.id,
      label: g.label,
      memberCount: g.items.length,
      depth: g.depth,
      childCount: g.children.length,
    }))
  );
  dbgGroupEnd();

  for (const g of rootGroups) computeGroupStats(g);

  dbgGroupStart("analyse", "sold corpus — group confidence");
  dbg("analyse", "group confidence", () =>
    rootGroups.map((g) => ({
      groupLabel: g.label,
      count: g.stats.count,
      median: g.stats.median,
      iqr: g.stats.iqr,
      iqrRatio: g.stats.median > 0 ? g.stats.iqr / g.stats.median : null,
      confidence: g.confidence,
    }))
  );
  dbgGroupEnd();

  // Relevance against the search term
  const searchVocab = discoverIdentityVocab([searchTerm]);
  const searchTokens = tokenize(searchTerm, searchVocab);

  function assignRelevance(groups: PricingGroup[]): void {
    for (const g of groups) {
      g.relevanceScore = computeRelevance(g, searchTokens);
      assignRelevance(g.children);
    }
  }
  assignRelevance(rootGroups);
  rootGroups.sort(
    (a, b) =>
      b.relevanceScore - a.relevanceScore || b.stats.count - a.stats.count,
  );

  // Tokenize active listings with the sold vocab and rate against sold groups
  const activeWithTokens = activeFiltered.map((l) => ({
    ...l,
    tokens: tokenize(l.title, vocab),
  }));
  const assessments = activeWithTokens.map((listing) =>
    rateListingVsSold(listing, rootGroups),
  );

  dbgGroupStart("analyse", "active corpus (vs sold) — ratings");
  dbg("analyse", "per-listing rating", () =>
    assessments.map((a) => ({
      title: a.listing.title,
      matchedGroup: a.matchedGroup?.label ?? null,
      p25: a.matchedGroup?.stats.p25 ?? null,
      p75: a.matchedGroup?.stats.p75 ?? null,
      median: a.matchedGroup?.stats.median ?? null,
      totalPrice: a.listing.totalPrice,
      rating: a.rating,
      percentile: a.percentile,
    }))
  );
  dbgGroupEnd();

  const allPrices = activeFiltered.map((l) => l.totalPrice).filter((p) => p > 0);
  const overallMin = allPrices.length > 0 ? Math.min(...allPrices) : 0;
  const overallMax = allPrices.length > 0 ? Math.max(...allPrices) : 0;

  return {
    rootGroups,
    assessments,
    summary: {
      totalListingsAnalysed: activeFiltered.length,
      totalGroups: allLeafGroups(rootGroups).length,
      filteredOut,
      overallPriceRange: { min: overallMin, max: overallMax },
    },
    searchTerm,
  };
}

export interface ItemLookupResult {
  stats: GroupStatistics;
  examples: { title: string; totalPrice: number; link: string }[];
  totalComps: number;
}

/**
 * Aggregate an ad-hoc set of sold comps (from a panel item search) into a single
 * price distribution. Standalone: does not cluster or re-rate page listings.
 */
export function analyseItemLookup(rawComps: RawListing[]): ItemLookupResult {
  const valid = parseRawListings(rawComps).filter(
    (l) => !l.isJunk && !l.isExcluded && l.totalPrice > 0,
  );

  const stats = computeStats(valid.map((l) => l.totalPrice));

  const examples = valid.slice(0, 6).map((l) => ({
    title: l.title,
    totalPrice: l.totalPrice,
    link: l.link,
  }));

  return { stats, examples, totalComps: valid.length };
}
