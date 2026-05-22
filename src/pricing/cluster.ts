/*
 * Clustering approach: centroid-based greedy assignment, iterative refinement,
 * followed by discriminating-token hierarchical splitting.
 *
 * Centroid = tokens appearing in ≥ ceil(n * 0.55) members.
 * Default similarity threshold: 0.35 (lower than the plan's 0.45 to handle
 * real-world eBay data where product variants share a subset of identity tokens —
 * e.g. "iPhone 16 Pro Max" and "iPhone 16" share only "iphone").
 *
 * Listings are pre-sorted by identity-token count (ascending) so that simpler
 * items seed clusters first; more specific variants then join by matching on the
 * shared core token. Iterative refinement (up to 5 passes) fixes order-dependent
 * misassignments from the initial greedy pass.
 *
 * Hierarchical splitting uses ALL non-core tokens (identity + descriptor) as
 * discriminating candidates so that differentiators like "Pro", "Max", "Plus"
 * are found even when they are classified as identity tokens.
 */

import type {
  ParsedListing,
  PricingGroup,
  ClusterOptions,
  GroupStatistics,
  WeightedTokens,
} from "./types";
import { weightedSimilarity } from "./tokenize";

const DEFAULT_THRESHOLD = 0.35;
// Two clusters whose centroids are at least this similar are merged after
// refinement. Catches duplicate groups for the same product that the greedy
// pass seeded apart (and, with cosmetic tokens demoted to noise, groups that
// differ only by a price-irrelevant variant axis → identical centroids).
const MERGE_THRESHOLD = 0.6;
const MIN_GROUP_TO_SPLIT = 6;
const MIN_CHILD_SIZE = 3;
const MAX_DEPTH = 2;
const MAX_ITER = 5;
const CENTROID_MAJORITY = 0.55;
const CENTROID_CORE = 0.6;

const EMPTY_STATS: GroupStatistics = {
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

let _idCounter = 0;

export function resetClusterIdCounter(): void {
  _idCounter = 0;
}

function nextId(): string {
  return `g${++_idCounter}`;
}

interface CentroidState {
  items: ParsedListing[];
  identityCounts: Map<string, number>;
  descriptorCounts: Map<string, number>;
}

function createState(items: ParsedListing[]): CentroidState {
  const identityCounts = new Map<string, number>();
  const descriptorCounts = new Map<string, number>();
  for (const item of items) {
    for (const tok of item.tokens.identity) {
      identityCounts.set(tok, (identityCounts.get(tok) ?? 0) + 1);
    }
    for (const tok of item.tokens.descriptors) {
      descriptorCounts.set(tok, (descriptorCounts.get(tok) ?? 0) + 1);
    }
  }
  return { items: [...items], identityCounts, descriptorCounts };
}

function addToState(state: CentroidState, item: ParsedListing): void {
  state.items.push(item);
  for (const tok of item.tokens.identity) {
    state.identityCounts.set(tok, (state.identityCounts.get(tok) ?? 0) + 1);
  }
  for (const tok of item.tokens.descriptors) {
    state.descriptorCounts.set(tok, (state.descriptorCounts.get(tok) ?? 0) + 1);
  }
}

function removeFromState(state: CentroidState, item: ParsedListing): void {
  state.items = state.items.filter((i) => i !== item);
  for (const tok of item.tokens.identity) {
    const c = (state.identityCounts.get(tok) ?? 0) - 1;
    if (c <= 0) state.identityCounts.delete(tok);
    else state.identityCounts.set(tok, c);
  }
  for (const tok of item.tokens.descriptors) {
    const c = (state.descriptorCounts.get(tok) ?? 0) - 1;
    if (c <= 0) state.descriptorCounts.delete(tok);
    else state.descriptorCounts.set(tok, c);
  }
}

function buildCentroidTokens(state: CentroidState): WeightedTokens {
  const n = state.items.length;
  const threshold = Math.max(1, Math.ceil(n * CENTROID_MAJORITY));
  return {
    identity: [...state.identityCounts.entries()]
      .filter(([, c]) => c >= threshold)
      .map(([t]) => t),
    descriptors: [...state.descriptorCounts.entries()]
      .filter(([, c]) => c >= threshold)
      .map(([t]) => t),
    noise: new Set<string>(),
    raw: new Set<string>(),
  };
}

function matchScore(item: ParsedListing, state: CentroidState): number {
  return weightedSimilarity(item.tokens, buildCentroidTokens(state));
}

function makeLabel(state: CentroidState): string {
  const n = state.items.length;
  const threshold = Math.max(1, Math.ceil(n * 0.4));
  return (
    [...state.identityCounts.entries()]
      .filter(([, c]) => c >= threshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => t)
      .join(" ") || "group"
  );
}

function splitHierarchical(
  state: CentroidState,
  depth: number,
  parentId: string | null,
): PricingGroup {
  const id = nextId();
  const group: PricingGroup = {
    id,
    label: makeLabel(state),
    items: [...state.items],
    children: [],
    parent: parentId,
    depth,
    stats: { ...EMPTY_STATS, count: state.items.length },
    confidence: "insufficient",
    relevanceScore: 0,
  };

  if (state.items.length < MIN_GROUP_TO_SPLIT || depth >= MAX_DEPTH) {
    return group;
  }

  const n = state.items.length;
  const coreThreshold = Math.ceil(n * CENTROID_CORE);

  const coreTokens = new Set<string>([
    ...[...state.identityCounts.entries()]
      .filter(([, c]) => c >= coreThreshold)
      .map(([t]) => t),
    ...[...state.descriptorCounts.entries()]
      .filter(([, c]) => c >= coreThreshold)
      .map(([t]) => t),
  ]);

  // Candidate discriminating tokens: present in ≥ MIN_CHILD_SIZE AND ≤ n-MIN_CHILD_SIZE members
  let bestToken: string | null = null;
  let bestCount = 0;

  for (const [tok, cnt] of state.identityCounts) {
    if (
      !coreTokens.has(tok) &&
      cnt >= MIN_CHILD_SIZE &&
      n - cnt >= MIN_CHILD_SIZE &&
      cnt > bestCount
    ) {
      bestToken = tok;
      bestCount = cnt;
    }
  }
  for (const [tok, cnt] of state.descriptorCounts) {
    if (
      !coreTokens.has(tok) &&
      cnt >= MIN_CHILD_SIZE &&
      n - cnt >= MIN_CHILD_SIZE &&
      cnt > bestCount
    ) {
      bestToken = tok;
      bestCount = cnt;
    }
  }

  if (!bestToken) return group;

  const withTok: ParsedListing[] = [];
  const withoutTok: ParsedListing[] = [];
  for (const item of state.items) {
    const has =
      item.tokens.identity.includes(bestToken) ||
      item.tokens.descriptors.includes(bestToken);
    if (has) withTok.push(item);
    else withoutTok.push(item);
  }

  if (withTok.length < MIN_CHILD_SIZE || withoutTok.length < MIN_CHILD_SIZE) {
    return group;
  }

  group.children = [
    splitHierarchical(createState(withTok), depth + 1, id),
    splitHierarchical(createState(withoutTok), depth + 1, id),
  ];

  return group;
}

export function clusterListings(
  listings: ParsedListing[],
  options?: ClusterOptions,
): PricingGroup[] {
  const threshold = options?.similarityThreshold ?? DEFAULT_THRESHOLD;

  // Only cluster non-junk, non-excluded listings
  const eligible = listings
    .filter((l) => !l.isJunk && !l.isExcluded)
    // Sort simpler items first so they seed clusters; richer variants join by shared tokens
    .sort((a, b) => a.tokens.identity.length - b.tokens.identity.length);

  if (eligible.length === 0) return [];

  const states: CentroidState[] = [];

  // Initial greedy pass
  for (const item of eligible) {
    let bestIdx = -1;
    let bestScore = threshold - 0.001;

    for (let i = 0; i < states.length; i++) {
      const score = matchScore(item, states[i]);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      addToState(states[bestIdx], item);
    } else {
      states.push(createState([item]));
    }
  }

  // Iterative refinement: reassign listings to better clusters until stable
  for (let iter = 0; iter < MAX_ITER; iter++) {
    let changed = false;

    for (const item of eligible) {
      const curIdx = states.findIndex((s) => s.items.includes(item));
      if (curIdx < 0) continue;

      let bestIdx = curIdx;
      let bestScore = matchScore(item, states[curIdx]);

      for (let i = 0; i < states.length; i++) {
        if (i === curIdx) continue;
        const score = matchScore(item, states[i]);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      if (bestIdx !== curIdx && bestScore >= threshold) {
        removeFromState(states[curIdx], item);
        addToState(states[bestIdx], item);
        changed = true;
      }
    }

    // Remove empty clusters
    for (let i = states.length - 1; i >= 0; i--) {
      if (states[i].items.length === 0) states.splice(i, 1);
    }

    if (!changed) break;
  }

  // Post-cluster merge pass: combine clusters whose centroids are near-identical
  // (≥ MERGE_THRESHOLD). Repeats until no pair merges. Hierarchical splitting
  // below then re-runs on the merged result, so genuine sub-variants that share
  // a centroid still get separated by their discriminating tokens.
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < states.length; i++) {
      const ci = buildCentroidTokens(states[i]);
      for (let j = i + 1; j < states.length; j++) {
        const sim = weightedSimilarity(ci, buildCentroidTokens(states[j]));
        if (sim >= MERGE_THRESHOLD) {
          for (const item of states[j].items) addToState(states[i], item);
          states.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  return states
    .filter((s) => s.items.length > 0)
    .map((s) => splitHierarchical(s, 0, null));
}
