import type { WeightedTokens } from "./types";

// Matches tokens that should be kept as a single unit:
//  1. Letters+digits (or digit+letters) combos with optional internal / or -  → model numbers
//  2. Numeric capacity units: 512GB, 1TB, 2.4GHz
//  3. Hyphenated piece counts: 16-piece, 8-pack, 24-pcs, 6-set
const COMPOUND_TOKEN_RE =
  /\b([A-Za-z]+\d[A-Za-z0-9]*(?:[\/\-][A-Za-z0-9]+)*|\d+[A-Za-z][A-Za-z0-9]*(?:[\/\-][A-Za-z0-9]+)*)\b|\b(\d+(?:\.\d+)?(?:TB|GB|MB|KB|GHz|MHz|MP|mAh|W|V)s?)\b|\b(\d+-(?:piece|pieces|pack|packs|pcs|set|sets))\b/gi;

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "for",
  "to",
  "of",
  "with",
  "by",
  "from",
  "into",
  "up",
  "is",
  "it",
  "its",
  "this",
  "that",
  "as",
  "be",
  "was",
  "has",
  "have",
  "had",
  "not",
  "no",
  "so",
  "if",
  "are",
  "can",
  "very",
  "also",
  "just",
  "only",
  "than",
  "more",
  "most",
  "some",
  "any",
]);

// Per-run memo — cleared each analysePricing run
const memoMap = new Map<string, WeightedTokens>();

export function clearTokenizeCache(): void {
  memoMap.clear();
}

function isModelShaped(tok: string): boolean {
  return /[A-Za-z]/.test(tok) && /\d/.test(tok);
}

function isCapacity(tok: string): boolean {
  return (
    /^\d+(?:\.\d+)?(?:TB|GB|MB|KB|GHz|MHz|MP|mAh|W|V)s?$/i.test(tok) ||
    /^\d+-(?:piece|pieces|pack|packs|pcs|set|sets)$/i.test(tok)
  );
}

/**
 * Extract all raw word/model tokens from a title.
 * Returns lowercased tokens, preserving model-shaped ones with internal punctuation.
 */
function extractRawTokens(title: string): string[] {
  const tokens: string[] = [];
  const lower = title.toLowerCase();

  // First pass: extract model-shaped tokens (letters+digits, optional / or -)
  // We track which char ranges are already consumed
  const consumed = new Uint8Array(lower.length);

  let m: RegExpExecArray | null;
  COMPOUND_TOKEN_RE.lastIndex = 0;
  while ((m = COMPOUND_TOKEN_RE.exec(lower)) !== null) {
    // m[1]=model-shaped, m[2]=capacity unit, m[3]=hyphenated piece count
    tokens.push(m[1] ?? m[2] ?? m[3] ?? m[0]);
    for (let i = m.index; i < m.index + m[0].length; i++) consumed[i] = 1;
  }

  // Second pass: extract remaining word tokens from unconsumed chars
  let word = "";
  for (let i = 0; i <= lower.length; i++) {
    const ch = i < lower.length ? lower[i] : "";
    if (ch && !consumed[i] && /[a-z0-9]/.test(ch)) {
      word += ch;
    } else if (word) {
      tokens.push(word);
      word = "";
    }
  }

  return tokens;
}

/**
 * Build an identity vocabulary from a corpus of titles.
 *
 * Identity tokens are:
 *  1. All model-shaped tokens (letter+digit combos) — always identity signals.
 *  2. Plain-word tokens appearing in ≥ 2 titles AND spanning ≥ 2 price quartiles
 *     (or ≥ 2 titles when no prices are supplied) AND not stopwords.
 *
 * @param titles  Array of (already-cleaned) listing titles.
 * @param prices  Corresponding total prices (same length as titles).
 *                When omitted, the quartile-spanning check is skipped.
 */
export function discoverIdentityVocab(
  titles: string[],
  prices?: number[],
): Set<string> {
  const vocab = new Set<string>();

  // Compute price quartiles when available
  let q1 = 0,
    q2 = 0,
    q3 = 0;
  const hasPrices = prices && prices.length === titles.length;
  if (hasPrices) {
    const sorted = [...prices!].sort((a, b) => a - b);
    q1 = sorted[Math.floor(sorted.length * 0.25)];
    q2 = sorted[Math.floor(sorted.length * 0.5)];
    q3 = sorted[Math.floor(sorted.length * 0.75)];
  }

  const titleFreq = new Map<string, number>();
  const tokenQuartiles = new Map<string, Set<number>>();

  for (let idx = 0; idx < titles.length; idx++) {
    const price = hasPrices ? prices![idx] : 0;
    const quartile = price <= q1 ? 0 : price <= q2 ? 1 : price <= q3 ? 2 : 3;
    const seen = new Set<string>();

    for (const tok of extractRawTokens(titles[idx])) {
      if (isModelShaped(tok) || isCapacity(tok)) {
        vocab.add(tok);
        continue;
      }

      if (!seen.has(tok)) {
        titleFreq.set(tok, (titleFreq.get(tok) ?? 0) + 1);
        if (hasPrices) {
          if (!tokenQuartiles.has(tok)) tokenQuartiles.set(tok, new Set());
          tokenQuartiles.get(tok)!.add(quartile);
        }
        seen.add(tok);
      }
    }
  }

  for (const [tok, freq] of titleFreq) {
    if (freq < 2) continue;
    if (STOPWORDS.has(tok)) continue;
    if (tok.length < 2) continue;
    if (hasPrices && (tokenQuartiles.get(tok)?.size ?? 0) < 2) continue;
    vocab.add(tok);
  }

  return vocab;
}

/**
 * Tokenize a single listing title into weighted token buckets.
 * Results are memoised — call clearTokenizeCache() at the start of each analysis run.
 */
export function tokenize(
  title: string,
  identityVocab: Set<string>,
): WeightedTokens {
  const cacheKey = title;
  const cached = memoMap.get(cacheKey);
  if (cached) return cached;

  const lower = title.toLowerCase();
  const identity: string[] = [];
  const descriptors: string[] = [];
  const noise = new Set<string>();
  const raw = new Set<string>();

  for (const tok of extractRawTokens(lower)) {
    raw.add(tok);

    if (isModelShaped(tok) || isCapacity(tok) || identityVocab.has(tok)) {
      identity.push(tok);
    } else if (tok.length < 2 || STOPWORDS.has(tok) || /^\d+$/.test(tok)) {
      noise.add(tok);
    } else {
      descriptors.push(tok);
    }
  }

  const result: WeightedTokens = { identity, descriptors, noise, raw };
  memoMap.set(cacheKey, result);
  return result;
}

/**
 * Weighted Jaccard similarity between two token sets.
 * Identity overlap dominates (weight 1.0); descriptor overlap is down-weighted (0.3).
 */
export function weightedSimilarity(
  a: WeightedTokens,
  b: WeightedTokens,
): number {
  const identityScore = jaccardSets(new Set(a.identity), new Set(b.identity));
  const descriptorScore = jaccardSets(
    new Set(a.descriptors),
    new Set(b.descriptors),
  );
  return identityScore + descriptorScore * 0.3;
}

function jaccardSets(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const tok of a) {
    if (b.has(tok)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
