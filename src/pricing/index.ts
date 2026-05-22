import {
  clearTokenizeCache,
  discoverIdentityVocab,
  tokenize,
} from "./tokenize";
import { dbg, dbgGroupStart, dbgGroupEnd } from "../debug";
import { parseRawListings } from "./parse";
import { findCompsScored, buildModelGroups, resetGroupIdCounter, SIMILARITY_FLOOR } from "./match";
import {
  computeRelevance,
  computeStats,
  rateListing,
} from "./analyse";
import type {
  RawListing,
  PricingResult,
  PricingSettings,
  PricingGroup,
  ParsedListing,
  GroupStatistics,
  ListingAssessment,
  PriceRating,
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

/** Match an active listing to its model group by model-key intersection. */
function matchToModelGroup(
  active: ParsedListing,
  groups: PricingGroup[],
): PricingGroup | null {
  if (active.tokens.model.length === 0) return null;
  const activeModels = new Set(active.tokens.model);
  for (const g of groups) {
    const groupModels = new Set(g.label.split(" "));
    if ([...activeModels].some((m) => groupModels.has(m))) return g;
  }
  return null;
}

function rateVsModelGroup(
  listing: ParsedListing,
  group: PricingGroup,
): ListingAssessment {
  if (group.confidence === "insufficient") {
    return {
      listing,
      rating: "no-data",
      matchedGroup: null,
      percentile: null,
      showBadge: false,
    };
  }

  const { totalPrice } = listing;
  const { p25, p75 } = group.stats;

  let rating: PriceRating;
  if (totalPrice < p25) rating = "good";
  else if (totalPrice > p75) rating = "high";
  else rating = "fair";

  const prices = group.items.map((l) => l.totalPrice).sort((a, b) => a - b);
  const below = prices.filter((p) => p < totalPrice).length;
  const percentile = prices.length > 0 ? below / prices.length : null;

  return { listing, rating, matchedGroup: group, percentile, showBadge: true };
}

export function analysePricing(
  rawListings: RawListing[],
  searchTerm: string,
  _settings?: PricingSettings,
): PricingResult {
  clearTokenizeCache();
  resetGroupIdCounter();

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
      model: l.tokens.model,
      identity: l.tokens.identity,
      descriptors: l.tokens.descriptors,
      noise: [...l.tokens.noise],
    }))
  );
  dbgGroupEnd();

  const rootGroups = buildModelGroups(withTokens);

  dbgGroupStart("match", `active corpus — ${rootGroups.length} model groups`);
  dbg("match", "group summary", () =>
    rootGroups.map((g) => ({
      groupId: g.id,
      label: g.label,
      memberCount: g.items.length,
      confidence: g.confidence,
    }))
  );
  dbgGroupEnd();

  // Compute relevance scores vs search term
  const searchVocab = discoverIdentityVocab([searchTerm]);
  const searchTokens = tokenize(searchTerm, searchVocab);
  for (const g of rootGroups) {
    g.relevanceScore = computeRelevance(g, searchTokens);
  }

  rootGroups.sort(
    (a, b) =>
      b.relevanceScore - a.relevanceScore || b.stats.count - a.stats.count,
  );

  // Rate each active listing against its model group
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
 * Builds model-keyed groups from the sold corpus, then matches each active
 * listing to its model group via the model gate and rates it.
 */
export function analysePricingVsSold(
  activeRaw: RawListing[],
  soldRaw: RawListing[],
  searchTerm: string,
  _settings?: PricingSettings,
): PricingResult {
  clearTokenizeCache();
  resetGroupIdCounter();

  dbg("match", "config", () => ({ similarityFloor: SIMILARITY_FLOOR }));

  // Parse both corpora
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

  const soldWithTokens = soldFiltered.map((l) => ({
    ...l,
    tokens: tokenize(l.title, vocab),
  }));

  dbgGroupStart("tokenize", `sold corpus — vocab size ${vocab.size}`);
  dbg("tokenize", "identity vocab", () => ({ identityTokens: [...vocab] }));
  dbg("tokenize", "per-listing breakdown", () =>
    soldWithTokens.map((l) => ({
      title: l.title,
      model: l.tokens.model,
      identity: l.tokens.identity,
      descriptors: l.tokens.descriptors,
      noise: [...l.tokens.noise],
    }))
  );
  dbgGroupEnd();

  // Build flat model groups from sold corpus (for dashboard)
  const rootGroups = buildModelGroups(soldWithTokens);

  dbgGroupStart("match", `sold corpus — ${rootGroups.length} model groups`);
  dbg("match", "group summary", () =>
    rootGroups.map((g) => ({
      groupId: g.id,
      label: g.label,
      memberCount: g.items.length,
      confidence: g.confidence,
    }))
  );
  dbgGroupEnd();

  // Relevance against the search term
  const searchVocab = discoverIdentityVocab([searchTerm]);
  const searchTokens = tokenize(searchTerm, searchVocab);
  for (const g of rootGroups) {
    g.relevanceScore = computeRelevance(g, searchTokens);
  }
  rootGroups.sort(
    (a, b) =>
      b.relevanceScore - a.relevanceScore || b.stats.count - a.stats.count,
  );

  // Tokenize active listings with the sold vocab and rate against model groups
  const activeWithTokens = activeFiltered.map((l) => ({
    ...l,
    tokens: tokenize(l.title, vocab),
  }));

  const assessments: ListingAssessment[] = activeWithTokens.map((listing) => {
    const activeModelKey = listing.tokens.model.length > 0
      ? [...new Set(listing.tokens.model)].sort().join(" ")
      : undefined;

    const scoredComps = findCompsScored(listing, soldWithTokens);
    if (scoredComps.length === 0) {
      return {
        listing,
        rating: "no-data" as PriceRating,
        matchedGroup: null,
        percentile: null,
        showBadge: false,
        activeModelKey,
        topMatchScore: undefined,
        sampleComps: [],
      };
    }

    const topMatchScore = scoredComps[0].score;
    const sampleComps = scoredComps.slice(0, 5).map(({ listing: c }) => ({
      title: c.title,
      totalPrice: c.totalPrice,
    }));

    // Find the pre-built model group this listing belongs to (for dashboard linkage)
    const group = matchToModelGroup(listing, rootGroups);
    if (!group) {
      return {
        listing,
        rating: "no-data" as PriceRating,
        matchedGroup: null,
        percentile: null,
        showBadge: false,
        activeModelKey,
        topMatchScore,
        sampleComps,
      };
    }

    return { ...rateVsModelGroup(listing, group), activeModelKey, topMatchScore, sampleComps };
  });

  dbgGroupStart("analyse", "active corpus (vs sold) — ratings");
  dbg("analyse", "per-listing rating", () =>
    assessments.map((a) => ({
      title: a.listing.title,
      activeModelKey: a.activeModelKey ?? null,
      matchedGroup: a.matchedGroup?.label ?? null,
      topMatchScore: a.topMatchScore ?? null,
      p25: a.matchedGroup?.stats.p25 ?? null,
      p75: a.matchedGroup?.stats.p75 ?? null,
      median: a.matchedGroup?.stats.median ?? null,
      totalPrice: a.listing.totalPrice,
      rating: a.rating,
      percentile: a.percentile,
      sampleComps: a.sampleComps ?? [],
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
