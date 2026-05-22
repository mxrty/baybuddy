import type { ParsedListing, PricingGroup } from "./types";
import { computeGroupStats } from "./analyse";

export const SIMILARITY_FLOOR = 0.3;
const COMP_CAP = 25;

function hasIntersection(a: string[], b: string[]): boolean {
  const setB = new Set(b);
  return a.some((t) => setB.has(t));
}

function jaccardArray(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Similarity between two listings: model token Jaccard (weight 1.0) + descriptor
 * Jaccard (weight 0.3). Hard gate: if both listings have model tokens and those
 * sets don't intersect, returns 0 — a 574 can never match a 9060.
 */
export function similarity(a: ParsedListing, b: ParsedListing): number {
  const aModel = a.tokens.model;
  const bModel = b.tokens.model;

  if (aModel.length > 0 && bModel.length > 0 && !hasIntersection(aModel, bModel)) {
    return 0;
  }

  const modelScore = jaccardArray(aModel, bModel);
  const descriptorScore = jaccardArray(a.tokens.descriptors, b.tokens.descriptors);
  return modelScore + descriptorScore * 0.3;
}

export interface FindCompsOptions {
  floor?: number;
  cap?: number;
}

/**
 * Find the best matching sold listings for an active listing.
 * Applies the model gate via similarity(), filters by floor, sorts desc, caps result.
 */
export function findComps(
  active: ParsedListing,
  sold: ParsedListing[],
  opts?: FindCompsOptions,
): ParsedListing[] {
  return findCompsScored(active, sold, opts).map(({ listing }) => listing);
}

/**
 * Like findComps but returns each comp paired with its similarity score.
 * Use when the winning score is needed for debug logging.
 */
export function findCompsScored(
  active: ParsedListing,
  sold: ParsedListing[],
  opts?: FindCompsOptions,
): { listing: ParsedListing; score: number }[] {
  const floor = opts?.floor ?? SIMILARITY_FLOOR;
  const cap = opts?.cap ?? COMP_CAP;

  return sold
    .filter((s) => !s.isJunk && !s.isExcluded)
    .map((s) => ({ listing: s, score: similarity(active, s) }))
    .filter(({ score }) => score >= floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, cap);
}

let _groupIdCounter = 0;

export function resetGroupIdCounter(): void {
  _groupIdCounter = 0;
}

/**
 * Build flat PricingGroups from sold listings, one per distinct model key.
 * Listings with no model tokens are skipped (no badge possible without a model).
 */
export function buildModelGroups(sold: ParsedListing[]): PricingGroup[] {
  const eligible = sold.filter((s) => !s.isJunk && !s.isExcluded);

  const byModel = new Map<string, ParsedListing[]>();
  for (const listing of eligible) {
    const key = [...new Set(listing.tokens.model)].sort().join("+");
    if (!key) continue;
    if (!byModel.has(key)) byModel.set(key, []);
    byModel.get(key)!.push(listing);
  }

  const groups: PricingGroup[] = [];
  for (const [key, items] of byModel) {
    const group: PricingGroup = {
      id: `mg${++_groupIdCounter}`,
      label: key.replace(/\+/g, " "),
      items,
      children: [],
      parent: null,
      depth: 0,
      stats: { count: 0, min: 0, max: 0, mean: 0, median: 0, p25: 0, p75: 0, stdDev: 0, iqr: 0 },
      confidence: "insufficient",
      relevanceScore: 0,
    };
    computeGroupStats(group);
    groups.push(group);
  }

  return groups;
}
