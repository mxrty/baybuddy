"use strict";
(() => {
  // src/pricing/tokenize.ts
  var COMPOUND_TOKEN_RE = /\b([A-Za-z]+\d[A-Za-z0-9]*(?:[\/\-][A-Za-z0-9]+)*|\d+[A-Za-z][A-Za-z0-9]*(?:[\/\-][A-Za-z0-9]+)*)\b|\b(\d+(?:\.\d+)?(?:TB|GB|MB|KB|GHz|MHz|MP|mAh|W|V)s?)\b|\b(\d+-(?:piece|pieces|pack|packs|pcs|set|sets))\b/gi;
  var STOPWORDS = /* @__PURE__ */ new Set([
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
    "any"
  ]);
  var memoMap = /* @__PURE__ */ new Map();
  function clearTokenizeCache() {
    memoMap.clear();
  }
  function isModelShaped(tok) {
    return /[A-Za-z]/.test(tok) && /\d/.test(tok);
  }
  function isCapacity(tok) {
    return /^\d+(?:\.\d+)?(?:TB|GB|MB|KB|GHz|MHz|MP|mAh|W|V)s?$/i.test(tok) || /^\d+-(?:piece|pieces|pack|packs|pcs|set|sets)$/i.test(tok);
  }
  function extractRawTokens(title) {
    const tokens = [];
    const lower = title.toLowerCase();
    const consumed = new Uint8Array(lower.length);
    let m;
    COMPOUND_TOKEN_RE.lastIndex = 0;
    while ((m = COMPOUND_TOKEN_RE.exec(lower)) !== null) {
      tokens.push(m[1] ?? m[2] ?? m[3] ?? m[0]);
      for (let i = m.index; i < m.index + m[0].length; i++) consumed[i] = 1;
    }
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
  function discoverIdentityVocab(titles, prices) {
    const vocab = /* @__PURE__ */ new Set();
    let q1 = 0, q2 = 0, q3 = 0;
    const hasPrices = prices && prices.length === titles.length;
    if (hasPrices) {
      const sorted = [...prices].sort((a, b) => a - b);
      q1 = sorted[Math.floor(sorted.length * 0.25)];
      q2 = sorted[Math.floor(sorted.length * 0.5)];
      q3 = sorted[Math.floor(sorted.length * 0.75)];
    }
    const titleFreq = /* @__PURE__ */ new Map();
    const tokenQuartiles = /* @__PURE__ */ new Map();
    for (let idx = 0; idx < titles.length; idx++) {
      const price = hasPrices ? prices[idx] : 0;
      const quartile = price <= q1 ? 0 : price <= q2 ? 1 : price <= q3 ? 2 : 3;
      const seen = /* @__PURE__ */ new Set();
      for (const tok of extractRawTokens(titles[idx])) {
        if (isModelShaped(tok) || isCapacity(tok)) {
          vocab.add(tok);
          continue;
        }
        if (!seen.has(tok)) {
          titleFreq.set(tok, (titleFreq.get(tok) ?? 0) + 1);
          if (hasPrices) {
            if (!tokenQuartiles.has(tok)) tokenQuartiles.set(tok, /* @__PURE__ */ new Set());
            tokenQuartiles.get(tok).add(quartile);
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
  function tokenize(title, identityVocab) {
    const cacheKey = title;
    const cached = memoMap.get(cacheKey);
    if (cached) return cached;
    const lower = title.toLowerCase();
    const identity = [];
    const descriptors = [];
    const noise = /* @__PURE__ */ new Set();
    const raw = /* @__PURE__ */ new Set();
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
    const result = { identity, descriptors, noise, raw };
    memoMap.set(cacheKey, result);
    return result;
  }
  function weightedSimilarity(a, b) {
    const identityScore = jaccardSets(new Set(a.identity), new Set(b.identity));
    const descriptorScore = jaccardSets(
      new Set(a.descriptors),
      new Set(b.descriptors)
    );
    return identityScore + descriptorScore * 0.3;
  }
  function jaccardSets(a, b) {
    if (a.size === 0 && b.size === 0) return 0;
    let intersection = 0;
    for (const tok of a) {
      if (b.has(tok)) intersection++;
    }
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  // src/pricing/parse.ts
  var TITLE_NOISE = ["Opens in a new window or tab", "New listing"];
  function cleanTitle(title) {
    let out = title;
    for (const phrase of TITLE_NOISE) {
      out = out.split(phrase).join("");
    }
    return out.trim();
  }
  function parsePriceText(text) {
    const cleaned = text.replace(/[£$€,]/g, "").replace(/AU\s*/i, "").replace(/US\s*/i, "").replace(/C\s*/i, "").trim();
    const match = cleaned.match(/[\d]+(\.[\d]+)?/g);
    if (!match) return 0;
    if (cleaned.includes(" to ") && match.length >= 2) {
      const low = parseFloat(match[0]);
      const high = parseFloat(match[1]);
      if (!isNaN(low) && !isNaN(high)) return (low + high) / 2;
    }
    const val = parseFloat(match[0]);
    return isNaN(val) ? 0 : val;
  }
  function parsePostageFromText(text) {
    if (!text) return { postage: 0, postageKnown: false };
    const lower = text.toLowerCase();
    if (lower.includes("free delivery") || lower.includes("free postage") || lower.includes("free collection") || lower.includes("collection in person") || lower.includes("collection only")) {
      return { postage: 0, postageKnown: true };
    }
    const plusMatch = text.match(/^\+[£$€]?([\d,]+\.?\d*)/);
    if (plusMatch) {
      const val = parseFloat(plusMatch[1].replace(/,/g, ""));
      if (!isNaN(val)) return { postage: val, postageKnown: true };
    }
    if (lower === "postage not specified") {
      return { postage: 0, postageKnown: false };
    }
    if (lower.startsWith("delivery in") || lower.startsWith("free delivery in")) {
      return { postage: 0, postageKnown: true };
    }
    if (lower.startsWith("free")) {
      return { postage: 0, postageKnown: true };
    }
    return { postage: 0, postageKnown: false };
  }
  var JUNK_TITLE = "shop on ebay";
  var JUNK_PRICE_PATTERN = /^\$20\.00$/;
  function isJunk(item) {
    if (item.title.trim().toLowerCase() === JUNK_TITLE) return true;
    if (JUNK_PRICE_PATTERN.test(item.priceText.trim()) && item.title.trim().toLowerCase() === JUNK_TITLE)
      return true;
    return false;
  }
  var EXCLUDED_CONDITIONS = [
    "for parts",
    "spares or repair",
    "not working",
    "parts only"
  ];
  var DEFECT_TITLE_PHRASES = [
    "for parts",
    "spares",
    "parts only",
    "not working",
    "faulty",
    "cracked",
    "damaged",
    "broken",
    "repair",
    "no face id",
    "read description",
    "please read"
  ];
  function isExcluded(item) {
    const cond = item.condition.toLowerCase();
    if (EXCLUDED_CONDITIONS.some((phrase) => cond.includes(phrase))) return true;
    const title = item.title.toLowerCase();
    return DEFECT_TITLE_PHRASES.some((phrase) => title.includes(phrase));
  }
  var MULTI_VARIANT_TITLE_PHRASES = ["all colours", "all colors", "all sizes"];
  function isMultiVariant(item) {
    const title = item.title.toLowerCase();
    if (MULTI_VARIANT_TITLE_PHRASES.some((phrase) => title.includes(phrase)))
      return true;
    const cleaned = item.priceText.replace(/[£$€,]/g, "").replace(/AU\s*/i, "").replace(/US\s*/i, "");
    if (cleaned.includes(" to ")) {
      const nums = cleaned.match(/[\d]+(?:\.[\d]+)?/g);
      if (nums && nums.length >= 2) return true;
    }
    const capacityMatches = item.title.match(/\b\d+\s*(?:gb|tb)\b/gi);
    if (capacityMatches && capacityMatches.length >= 2) return true;
    return false;
  }
  function parseRawListings(items) {
    return items.map((item) => {
      const junk = isJunk(item);
      const excluded = isExcluded(item) || isMultiVariant(item);
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
        tokens: {
          identity: [],
          descriptors: [],
          noise: /* @__PURE__ */ new Set(),
          raw: /* @__PURE__ */ new Set()
        },
        isJunk: junk,
        isExcluded: excluded
      };
    });
  }

  // src/pricing/cluster.ts
  var DEFAULT_THRESHOLD = 0.35;
  var MERGE_THRESHOLD = 0.6;
  var MIN_GROUP_TO_SPLIT = 6;
  var MIN_CHILD_SIZE = 3;
  var MAX_DEPTH = 2;
  var MAX_ITER = 5;
  var CENTROID_MAJORITY = 0.55;
  var CENTROID_CORE = 0.6;
  var EMPTY_STATS = {
    count: 0,
    min: 0,
    max: 0,
    mean: 0,
    median: 0,
    p25: 0,
    p75: 0,
    stdDev: 0,
    iqr: 0
  };
  var _idCounter = 0;
  function resetClusterIdCounter() {
    _idCounter = 0;
  }
  function nextId() {
    return `g${++_idCounter}`;
  }
  function createState(items) {
    const identityCounts = /* @__PURE__ */ new Map();
    const descriptorCounts = /* @__PURE__ */ new Map();
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
  function addToState(state, item) {
    state.items.push(item);
    for (const tok of item.tokens.identity) {
      state.identityCounts.set(tok, (state.identityCounts.get(tok) ?? 0) + 1);
    }
    for (const tok of item.tokens.descriptors) {
      state.descriptorCounts.set(tok, (state.descriptorCounts.get(tok) ?? 0) + 1);
    }
  }
  function removeFromState(state, item) {
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
  function buildCentroidTokens(state) {
    const n = state.items.length;
    const threshold = Math.max(1, Math.ceil(n * CENTROID_MAJORITY));
    return {
      identity: [...state.identityCounts.entries()].filter(([, c]) => c >= threshold).map(([t]) => t),
      descriptors: [...state.descriptorCounts.entries()].filter(([, c]) => c >= threshold).map(([t]) => t),
      noise: /* @__PURE__ */ new Set(),
      raw: /* @__PURE__ */ new Set()
    };
  }
  function matchScore(item, state) {
    return weightedSimilarity(item.tokens, buildCentroidTokens(state));
  }
  function makeLabel(state) {
    const n = state.items.length;
    const threshold = Math.max(1, Math.ceil(n * 0.4));
    return [...state.identityCounts.entries()].filter(([, c]) => c >= threshold).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t).join(" ") || "group";
  }
  function splitHierarchical(state, depth, parentId) {
    const id = nextId();
    const group = {
      id,
      label: makeLabel(state),
      items: [...state.items],
      children: [],
      parent: parentId,
      depth,
      stats: { ...EMPTY_STATS, count: state.items.length },
      confidence: "insufficient",
      relevanceScore: 0
    };
    if (state.items.length < MIN_GROUP_TO_SPLIT || depth >= MAX_DEPTH) {
      return group;
    }
    const n = state.items.length;
    const coreThreshold = Math.ceil(n * CENTROID_CORE);
    const coreTokens = /* @__PURE__ */ new Set([
      ...[...state.identityCounts.entries()].filter(([, c]) => c >= coreThreshold).map(([t]) => t),
      ...[...state.descriptorCounts.entries()].filter(([, c]) => c >= coreThreshold).map(([t]) => t)
    ]);
    let bestToken = null;
    let bestCount = 0;
    for (const [tok, cnt] of state.identityCounts) {
      if (!coreTokens.has(tok) && cnt >= MIN_CHILD_SIZE && n - cnt >= MIN_CHILD_SIZE && cnt > bestCount) {
        bestToken = tok;
        bestCount = cnt;
      }
    }
    for (const [tok, cnt] of state.descriptorCounts) {
      if (!coreTokens.has(tok) && cnt >= MIN_CHILD_SIZE && n - cnt >= MIN_CHILD_SIZE && cnt > bestCount) {
        bestToken = tok;
        bestCount = cnt;
      }
    }
    if (!bestToken) return group;
    const withTok = [];
    const withoutTok = [];
    for (const item of state.items) {
      const has = item.tokens.identity.includes(bestToken) || item.tokens.descriptors.includes(bestToken);
      if (has) withTok.push(item);
      else withoutTok.push(item);
    }
    if (withTok.length < MIN_CHILD_SIZE || withoutTok.length < MIN_CHILD_SIZE) {
      return group;
    }
    group.children = [
      splitHierarchical(createState(withTok), depth + 1, id),
      splitHierarchical(createState(withoutTok), depth + 1, id)
    ];
    return group;
  }
  function clusterListings(listings, options) {
    const threshold = options?.similarityThreshold ?? DEFAULT_THRESHOLD;
    const eligible = listings.filter((l) => !l.isJunk && !l.isExcluded).sort((a, b) => a.tokens.identity.length - b.tokens.identity.length);
    if (eligible.length === 0) return [];
    const states = [];
    for (const item of eligible) {
      let bestIdx = -1;
      let bestScore = threshold - 1e-3;
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
      for (let i = states.length - 1; i >= 0; i--) {
        if (states[i].items.length === 0) states.splice(i, 1);
      }
      if (!changed) break;
    }
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
    return states.filter((s) => s.items.length > 0).map((s) => splitHierarchical(s, 0, null));
  }

  // src/pricing/analyse.ts
  var OUTLIER_MIN_COUNT = 8;
  function computeStats(prices) {
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
        iqr: 0
      };
    }
    const sorted = [...prices].sort((a, b) => a - b);
    const n = sorted.length;
    const min = sorted[0];
    const max = sorted[n - 1];
    const mean = sorted.reduce((s, v) => s + v, 0) / n;
    function percentile(p) {
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
  function removeOutliers(prices) {
    if (prices.length < OUTLIER_MIN_COUNT) return prices;
    const sorted = [...prices].sort((a, b) => a - b);
    const n = sorted.length;
    function pct(p) {
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
  function assignConfidence(group) {
    const { count, iqr, median } = group.stats;
    if (count >= 10 && median > 0 && iqr / median < 0.4) return "high";
    if (count >= 5) return "medium";
    if (count >= 3) return "low";
    return "insufficient";
  }
  function computeGroupStats(group) {
    if (group.children.length > 0) {
      for (const child of group.children) {
        computeGroupStats(child);
      }
      const allPrices = group.items.map((l) => l.totalPrice);
      group.stats = computeStats(removeOutliers(allPrices));
    } else {
      const prices = removeOutliers(group.items.map((l) => l.totalPrice));
      group.stats = computeStats(prices);
    }
    group.confidence = assignConfidence(group);
  }
  function computeRelevance(group, searchTermTokens) {
    const centroidIdentity = /* @__PURE__ */ new Set();
    for (const item of group.items) {
      for (const tok of item.tokens.identity) {
        centroidIdentity.add(tok.toLowerCase());
      }
    }
    const searchSet = new Set(
      searchTermTokens.identity.map((t) => t.toLowerCase())
    );
    if (centroidIdentity.size === 0 || searchSet.size === 0) return 0;
    let intersection = 0;
    for (const tok of searchSet) {
      if (centroidIdentity.has(tok)) intersection++;
    }
    const union = (/* @__PURE__ */ new Set([...centroidIdentity, ...searchSet])).size;
    return union === 0 ? 0 : intersection / union;
  }
  function findDeepestConfidentGroup(listing, group) {
    if (!group.items.includes(listing)) return null;
    for (const child of group.children) {
      const match = findDeepestConfidentGroup(listing, child);
      if (match && match.confidence !== "insufficient") return match;
    }
    return group.confidence !== "insufficient" ? group : null;
  }
  function rateListing(listing, groups) {
    let matchedGroup = null;
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
        showBadge: false
      };
    }
    const { totalPrice } = listing;
    const { p25, p75 } = matchedGroup.stats;
    let rating;
    if (totalPrice < p25) rating = "good";
    else if (totalPrice > p75) rating = "high";
    else rating = "fair";
    const prices = matchedGroup.items.map((l) => l.totalPrice).sort((a, b) => a - b);
    const below = prices.filter((p) => p < totalPrice).length;
    const percentile = prices.length > 0 ? below / prices.length : null;
    return { listing, rating, matchedGroup, percentile, showBadge: true };
  }

  // src/pricing/index.ts
  function allLeafGroups(groups) {
    const result = [];
    for (const g of groups) {
      if (g.children.length === 0) {
        result.push(g);
      } else {
        result.push(...allLeafGroups(g.children));
      }
    }
    return result;
  }
  function analysePricing(rawListings, searchTerm, settings) {
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
      tokens: tokenize(l.title, vocab)
    }));
    const clusterOptions = settings?.similarityThreshold !== void 0 ? { similarityThreshold: settings.similarityThreshold } : void 0;
    const rootGroups = clusterListings(withTokens, clusterOptions);
    for (const g of rootGroups) {
      computeGroupStats(g);
    }
    const searchVocab = discoverIdentityVocab([searchTerm]);
    const searchTokens = tokenize(searchTerm, searchVocab);
    function assignRelevance(groups) {
      for (const g of groups) {
        g.relevanceScore = computeRelevance(g, searchTokens);
        assignRelevance(g.children);
      }
    }
    assignRelevance(rootGroups);
    rootGroups.sort(
      (a, b) => b.relevanceScore - a.relevanceScore || b.stats.count - a.stats.count
    );
    const assessments = withTokens.map(
      (listing) => rateListing(listing, rootGroups)
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
        overallPriceRange: { min: overallMin, max: overallMax }
      },
      searchTerm
    };
  }

  // src/utils.ts
  function detectCurrency(host) {
    if (host.includes("ebay.co.uk")) return "\xA3";
    if (host.includes("ebay.com.au")) return "AU $";
    if (host.includes("ebay.ca")) return "C $";
    if (host.includes("ebay.de") || host.includes("ebay.fr") || host.includes("ebay.it") || host.includes("ebay.es") || host.includes("ebay.ie") || host.includes("ebay.nl") || host.includes("ebay.at"))
      return "\u20AC";
    return "$";
  }

  // src/ui/badge.ts
  function fmtPrice(amount, currency) {
    return `${currency}${amount.toFixed(2)}`;
  }
  var BADGE_STYLE = {
    good: {
      bg: "rgba(92, 184, 92, 0.1)",
      color: "#5cb85c",
      label: "\u{1F7E2} Good deal"
    },
    fair: { bg: "rgba(240, 173, 78, 0.1)", color: "#f0ad4e", label: "\u{1F7E1} Fair" },
    high: {
      bg: "rgba(217, 83, 79, 0.1)",
      color: "#d9534f",
      label: "\u{1F534} Above market"
    }
  };
  function injectBadge(card, assessment, currency) {
    if (!assessment.showBadge || assessment.rating === "no-data") return;
    const style = BADGE_STYLE[assessment.rating];
    const { listing, matchedGroup } = assessment;
    let container = card.querySelector(
      ".bb-badge-container"
    );
    let needsAppend = false;
    if (!container) {
      container = document.createElement("details");
      container.className = "bb-badge-container";
      container.style.cssText = "display:inline-block;position:relative;margin-left:8px;";
      const summary = document.createElement("summary");
      summary.className = "bb-price-badge";
      summary.style.cssText = "display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:500;padding:2px 6px;border-radius:4px;font-family:'Inter',-apple-system,sans-serif;cursor:pointer;list-style:none;";
      const dropdown2 = document.createElement("div");
      dropdown2.className = "bb-badge-dropdown";
      dropdown2.style.cssText = "display:block;margin-top:8px;font-size:11px;color:#575b6e;background:#fff;border:1px solid #ccc;padding:8px;border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,0.1);width:max-content;max-width:300px;white-space:normal;";
      container.appendChild(summary);
      container.appendChild(dropdown2);
      needsAppend = true;
    }
    const badge = container.querySelector(".bb-price-badge");
    const dropdown = container.querySelector(".bb-badge-dropdown");
    const totalStr = fmtPrice(listing.totalPrice, currency);
    const postageNote = listing.postage > 0 ? ` (${fmtPrice(listing.itemPrice, currency)} + ${fmtPrice(listing.postage, currency)} p&p)` : " (free postage)";
    badge.style.background = style.bg;
    badge.style.color = style.color;
    badge.innerHTML = style.label;
    badge.title = `Total: ${totalStr}${postageNote}`;
    if (matchedGroup) {
      const g = matchedGroup;
      const medianStr = fmtPrice(g.stats.median, currency);
      const p25Str = fmtPrice(g.stats.p25, currency);
      const p75Str = fmtPrice(g.stats.p75, currency);
      dropdown.innerHTML = `<strong>${g.label}</strong><br>${g.stats.count} comparable sales &middot; median ${medianStr}<br>Typical range: ${p25Str}&ndash;${p75Str}<br><em style="color:#999;">Your total: ${totalStr}${postageNote}</em>`;
    } else {
      dropdown.style.display = "none";
      badge.style.cursor = "default";
    }
    if (needsAppend) {
      const priceContainer = card.querySelector(".s-item__price, .s-card__price");
      if (priceContainer) priceContainer.appendChild(container);
    }
  }
  function renderBadges(result, root) {
    const currency = detectCurrency(window.location.host);
    const byLink = /* @__PURE__ */ new Map();
    for (const a of result.assessments) {
      if (a.listing.link) byLink.set(a.listing.link, a);
    }
    const cards = root.querySelectorAll(
      "li.s-card, .s-card, li.s-item, .srp-results .s-item"
    );
    for (const card of cards) {
      const linkEl = card.querySelector(
        "a.s-item__link, a.s-card__link"
      );
      if (!linkEl) continue;
      const href = linkEl.getAttribute("href") || linkEl.href || "";
      const assessment = byLink.get(href);
      if (assessment) injectBadge(card, assessment, currency);
    }
  }

  // src/ui/dashboard.ts
  function fmtPrice2(amount, currency) {
    return `${currency}${amount.toFixed(2)}`;
  }
  var CONFIDENCE_LABEL = {
    high: "\u25CF High confidence",
    medium: "\u25CF Med confidence",
    low: "\u25CF Low confidence",
    insufficient: "\u25CF Insufficient data"
  };
  var CONFIDENCE_COLOR = {
    high: "#5cb85c",
    medium: "#f0ad4e",
    low: "#f0ad4e",
    insufficient: "#aaa"
  };
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function renderGroupCard(group, currency, depth) {
    const isInsufficient = group.confidence === "insufficient";
    const opacity = isInsufficient ? "0.55" : "1";
    const indentPx = depth * 12;
    const confColor = CONFIDENCE_COLOR[group.confidence] ?? "#aaa";
    const confLabel = CONFIDENCE_LABEL[group.confidence] ?? "";
    const medianStr = fmtPrice2(group.stats.median, currency);
    const minStr = fmtPrice2(group.stats.min, currency);
    const maxStr = fmtPrice2(group.stats.max, currency);
    let bodyHtml;
    if (group.children.length > 0) {
      bodyHtml = `<div style="padding-left:${indentPx + 8}px;margin-top:6px;">` + group.children.map((c) => renderGroupCard(c, currency, depth + 1)).join("") + "</div>";
    } else {
      const items = group.items.map((item) => {
        const href = escapeHtml(item.link || "#");
        const title = escapeHtml(item.title.substring(0, 60)) + (item.title.length > 60 ? "&hellip;" : "");
        const price = fmtPrice2(item.totalPrice, currency);
        return `<li style="margin:2px 0;"><a href="${href}" target="_blank" rel="noopener" style="color:#3665f3;text-decoration:none;font-size:11px;">${title} &mdash; ${price}</a></li>`;
      });
      bodyHtml = `<ul style="margin:6px 0 0;padding-left:${indentPx + 16}px;color:#575b6e;">` + items.join("") + "</ul>";
    }
    return `<details style="margin-top:8px;padding:8px;background:rgba(0,0,0,0.02);border-radius:4px;opacity:${opacity};"><summary style="cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;padding-left:${indentPx}px;"><strong style="font-size:12px;">${escapeHtml(group.label)}</strong><span style="font-size:11px;color:#575b6e;">${group.stats.count} items &middot; median ${medianStr} &middot; ${minStr}&ndash;${maxStr}</span><span style="font-size:10px;color:${confColor};margin-left:auto;">${confLabel}</span></summary>` + bodyHtml + `</details>`;
  }
  function renderDashboard(result, root) {
    const currency = detectCurrency(window.location.host);
    const { rootGroups, summary } = result;
    let panel = document.getElementById("bb-overview-panel");
    let needsAppend = false;
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "bb-overview-panel";
      needsAppend = true;
    }
    if (rootGroups.length === 0) {
      panel.remove();
      return;
    }
    const groupsHtml = rootGroups.map((g) => renderGroupCard(g, currency, 0)).join("");
    const rangeStr = summary.overallPriceRange.max > 0 ? `${fmtPrice2(summary.overallPriceRange.min, currency)}&ndash;${fmtPrice2(summary.overallPriceRange.max, currency)}` : "n/a";
    panel.innerHTML = `<details style="margin:16px auto;background:rgba(54,101,243,0.05);border:1px solid rgba(54,101,243,0.2);border-radius:8px;font-family:'Inter',-apple-system,sans-serif;color:#161822;"><summary style="padding:12px 16px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;list-style:none;"><div style="display:flex;align-items:center;gap:8px;"><span style="font-size:16px;">&#x1F4CA;</span><span style="font-size:13px;font-weight:600;">Price Intelligence</span><span style="font-size:12px;color:#575b6e;">${summary.totalListingsAnalysed} items &middot; ${summary.totalGroups} groups</span></div><div style="display:flex;gap:16px;font-size:13px;align-items:center;"><span style="color:#575b6e;">Range: <strong style="color:#3665f3;">${rangeStr}</strong></span><span style="color:#3665f3;font-size:10px;">&#x25BC;</span></div></summary><div style="padding:0 16px 16px;font-size:12px;">${groupsHtml}</div></details>`;
    if (needsAppend) {
      const resultsContainer = root.querySelector(".srp-results") || root.querySelector("#srp-river-results") || root.querySelector('[id*="ResultSet"]') || root.querySelector(".srp-river-main");
      if (resultsContainer && resultsContainer.parentNode) {
        resultsContainer.parentNode.insertBefore(panel, resultsContainer);
      } else {
        const main = root.querySelector("#mainContent") || root.querySelector("#srp-river") || root;
        main.insertBefore(panel, main.firstChild);
      }
    }
  }

  // src/content.ts
  (function() {
    "use strict";
    const HIDDEN_ATTR = "data-bb-hidden";
    const BB_APPLIED = "data-bb-applied";
    const COLLECTION_PATTERNS = [
      /collection\s*(only|in\s*person)?/i,
      /collect\s*in\s*person/i,
      /local\s*pick\s*up/i,
      /pickup\s*only/i
    ];
    const POSTAGE_PATTERNS = [
      /\+\s*[£$€]\s*[\d.]+\s*(postage|delivery|p&p)/i,
      /free\s*(postage|delivery|p&p|shipping)/i,
      /[£$€]\s*[\d.]+\s*delivery/i,
      /fast\s*&?\s*free/i,
      /estimated\s*delivery/i,
      /royal\s*mail/i,
      /hermes/i,
      /evri/i,
      /dpd/i,
      /yodel/i,
      /parcelforce/i,
      /usps/i,
      /fedex/i,
      /ups\b/i,
      /australia\s*post/i,
      /canada\s*post/i
    ];
    const NON_STICKY_PARAMS = /* @__PURE__ */ new Set([
      "_nkw",
      "_pgn",
      "_skc",
      "_sop",
      "_sacat",
      "_dmd",
      "_ipg",
      "_fosrp",
      "_fcid",
      "_localstpos",
      "LH_Complete",
      "LH_Sold",
      "LH_PrefLoc",
      "_trksid",
      "hash",
      "rt",
      "_from"
    ]);
    function getListingCards() {
      const selectors = [
        "li.s-card",
        ".s-card",
        "li.s-item",
        ".srp-results .s-item",
        "ul.srp-results > li",
        "[data-viewport]"
      ];
      for (const sel of selectors) {
        const cards = document.querySelectorAll(sel);
        if (cards.length > 0) return cards;
      }
      return [];
    }
    function getDeliveryText(card) {
      const deliverySelectors = [
        ".s-card__shipping",
        ".s-card__delivery",
        ".s-item__shipping",
        ".s-item__localDelivery",
        ".s-item__delivery",
        ".s-item__freeXDays",
        ".s-item__dynamic",
        '[class*="shipping"]',
        '[class*="delivery"]',
        '[class*="logistic"]',
        '[class*="Delivery"]',
        '[class*="Shipping"]'
      ];
      let deliveryText = "";
      for (const sel of deliverySelectors) {
        const els = card.querySelectorAll(sel);
        els.forEach((el) => {
          deliveryText += " " + el.textContent;
        });
      }
      if (deliveryText.trim().length === 0) {
        const allSpans = card.querySelectorAll(
          "span, .s-item__detail, .s-card__detail"
        );
        allSpans.forEach((el) => {
          const text = el.textContent.trim().toLowerCase();
          if (text.includes("collect") || text.includes("delivery") || text.includes("postage") || text.includes("shipping") || text.includes("p&p")) {
            deliveryText += " " + el.textContent;
          }
        });
      }
      return deliveryText;
    }
    function isCollectionOnly(card) {
      const text = getDeliveryText(card);
      if (!text.trim()) return false;
      const hasCollection = COLLECTION_PATTERNS.some((p) => p.test(text));
      if (!hasCollection) return false;
      const hasPostage = POSTAGE_PATTERNS.some((p) => p.test(text));
      return !hasPostage;
    }
    function processCard(card) {
      if (card.hasAttribute(HIDDEN_ATTR)) return;
      if (card.classList && (card.classList.contains("s-item__pl-on-bottom") || card.classList.contains("s-card__pl-on-bottom")))
        return;
      if (isCollectionOnly(card)) {
        card.style.display = "none";
        card.setAttribute(HIDDEN_ATTR, "true");
      }
    }
    function renderCollectionHiddenPill(hiddenCount, totalCount) {
      const PILL_ID = "bb-collection-hidden-pill";
      let pill = document.getElementById(PILL_ID);
      if (hiddenCount === 0) {
        pill?.remove();
        return;
      }
      const allHidden = hiddenCount === totalCount && totalCount > 0;
      const text = allHidden ? `All ${totalCount} listing${totalCount !== 1 ? "s" : ""} hidden (collection only)` : `${hiddenCount} collection-only listing${hiddenCount !== 1 ? "s" : ""} hidden`;
      if (!pill) {
        pill = document.createElement("div");
        pill.id = PILL_ID;
        pill.style.cssText = [
          "display:inline-block",
          "margin:8px 4px",
          "padding:4px 10px",
          "background:#f5f5f5",
          "border:1px solid #ddd",
          "border-radius:12px",
          "font-size:12px",
          "color:#666",
          "font-family:sans-serif"
        ].join(";");
        const container = document.querySelector(
          ".srp-results, #srp-river-results, .srp-river-main"
        );
        if (container) container.insertBefore(pill, container.firstChild);
      }
      pill.textContent = text;
    }
    function processAllCards() {
      const cards = getListingCards();
      cards.forEach(processCard);
      const realCards = Array.from(cards).filter(
        (card) => !card.classList?.contains("s-item__pl-on-bottom") && !card.classList?.contains("s-card__pl-on-bottom")
      );
      const hiddenCount = realCards.filter(
        (card) => card.hasAttribute(HIDDEN_ATTR)
      ).length;
      renderCollectionHiddenPill(hiddenCount, realCards.length);
    }
    function applyLocalItemsOnly() {
      const url = new URL(window.location.href);
      if (url.searchParams.get("LH_PrefLoc") === "1") return;
      const guardKey = "bb_localApplied_" + url.searchParams.get("_nkw");
      if (sessionStorage.getItem(guardKey)) {
        sessionStorage.removeItem(guardKey);
        return;
      }
      url.searchParams.set("LH_PrefLoc", "1");
      sessionStorage.setItem(guardKey, "1");
      window.location.replace(url.toString());
    }
    function isViewingSold() {
      const url = new URL(window.location.href);
      return url.searchParams.get("LH_Sold") === "1" && url.searchParams.get("LH_Complete") === "1";
    }
    function createSoldButton() {
      if (document.getElementById("bb-sold-btn")) return;
      const viewing = isViewingSold();
      const btn = document.createElement("button");
      btn.id = "bb-sold-btn";
      btn.innerHTML = viewing ? "\u2190 Back to Active Listings" : "\u{1F50D} Search Sold Listings";
      Object.assign(btn.style, {
        position: "fixed",
        bottom: "24px",
        right: "24px",
        zIndex: "99999",
        padding: "12px 20px",
        border: "none",
        borderRadius: "50px",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        fontSize: "13px",
        fontWeight: "600",
        cursor: "pointer",
        boxShadow: viewing ? "0 4px 20px rgba(92, 184, 92, 0.4)" : "0 4px 20px rgba(54, 101, 243, 0.4)",
        background: viewing ? "linear-gradient(135deg, #5cb85c, #4cae4c)" : "linear-gradient(135deg, #3665f3, #4f7af8)",
        color: "white",
        transition: "all 150ms cubic-bezier(0.4, 0, 0.2, 1)",
        letterSpacing: "-0.2px"
      });
      btn.addEventListener("mouseenter", () => {
        btn.style.transform = "translateY(-2px) scale(1.02)";
        btn.style.boxShadow = viewing ? "0 6px 28px rgba(92, 184, 92, 0.5)" : "0 6px 28px rgba(54, 101, 243, 0.5)";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.transform = "translateY(0) scale(1)";
        btn.style.boxShadow = viewing ? "0 4px 20px rgba(92, 184, 92, 0.4)" : "0 4px 20px rgba(54, 101, 243, 0.4)";
      });
      btn.addEventListener("click", () => {
        const url = new URL(window.location.href);
        if (viewing) {
          url.searchParams.delete("LH_Sold");
          url.searchParams.delete("LH_Complete");
        } else {
          url.searchParams.set("LH_Sold", "1");
          url.searchParams.set("LH_Complete", "1");
        }
        window.location.href = url.toString();
      });
      document.body.appendChild(btn);
    }
    function collectRawListings() {
      const cards = getListingCards();
      const raw = [];
      cards.forEach((card) => {
        if (card.classList && (card.classList.contains("s-item__pl-on-bottom") || card.classList.contains("s-card__pl-on-bottom")))
          return;
        const titleEl = card.querySelector(".s-item__title, .s-card__title");
        const priceEl = card.querySelector(".s-item__price, .s-card__price");
        const conditionSelectors = [
          ".s-item__subtitle",
          ".s-item__secondary-info",
          ".SECONDARY_INFO",
          ".s-card__subtitle",
          ".s-item__condition",
          ".s-card__attribute-row"
        ];
        const conditionText = conditionSelectors.flatMap((sel) => Array.from(card.querySelectorAll(sel))).map((el) => el.textContent || "").join(" ").trim();
        const linkEl = card.querySelector(
          "a.s-item__link, a.s-card__link"
        );
        if (!titleEl || !priceEl) return;
        raw.push({
          title: titleEl.textContent || "",
          priceText: priceEl.textContent || "",
          condition: conditionText,
          link: linkEl?.href || linkEl?.getAttribute("href") || "",
          deliveryText: getDeliveryText(card)
        });
      });
      return raw;
    }
    let isApplyingPriceIntelligence = false;
    let needsReapply = false;
    function applyPriceIntelligence(settings, retryCount = 0) {
      if (isApplyingPriceIntelligence) {
        needsReapply = true;
        return;
      }
      isApplyingPriceIntelligence = true;
      try {
        const cards = getListingCards();
        if (cards.length === 0 && retryCount < 5) {
          isApplyingPriceIntelligence = false;
          setTimeout(() => applyPriceIntelligence(settings, retryCount + 1), 500);
          return;
        }
        const rawListings = collectRawListings();
        const searchTerm = new URL(window.location.href).searchParams.get("_nkw") || "";
        const result = analysePricing(rawListings, searchTerm, {
          enabled: true,
          similarityThreshold: settings.confidenceThreshold / 100
        });
        const root = document.documentElement;
        renderBadges(result, root);
        renderDashboard(result, root);
      } finally {
        isApplyingPriceIntelligence = false;
        if (needsReapply) {
          needsReapply = false;
          setTimeout(() => applyPriceIntelligence(settings), 50);
        }
      }
    }
    const STICKY_STORAGE_KEY = "bb_stickyParams";
    function getCurrentFilterParams() {
      const url = new URL(window.location.href);
      const params = {};
      url.searchParams.forEach((value, key) => {
        if (!NON_STICKY_PARAMS.has(key)) {
          params[key] = value;
        }
      });
      return params;
    }
    function saveStickyParams(params) {
      try {
        sessionStorage.setItem(STICKY_STORAGE_KEY, JSON.stringify(params));
      } catch (e) {
      }
    }
    function loadStickyParams() {
      try {
        const raw = sessionStorage.getItem(STICKY_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    }
    function applyStickyFilters() {
      const saved = loadStickyParams();
      if (!saved || Object.keys(saved).length === 0) {
        saveStickyParams(getCurrentFilterParams());
        return;
      }
      const url = new URL(window.location.href);
      let changed = false;
      Object.entries(saved).forEach(([key, value]) => {
        if (!url.searchParams.has(key)) {
          url.searchParams.set(key, String(value));
          changed = true;
        }
      });
      saveStickyParams(getCurrentFilterParams());
      if (changed) {
        const guardKey = "bb_stickyApplied";
        if (sessionStorage.getItem(guardKey)) {
          sessionStorage.removeItem(guardKey);
          return;
        }
        sessionStorage.setItem(guardKey, "1");
        window.location.replace(url.toString());
      }
    }
    function init() {
      const defaultSettings = {
        hideCollectionOnly: true,
        localItemsOnly: true,
        priceBadges: true,
        excludeBroken: true,
        stickyFilters: false,
        confidenceThreshold: 70
      };
      chrome.storage.sync.get(defaultSettings, function(settings) {
        if (settings.stickyFilters) {
          applyStickyFilters();
        }
        if (settings.localItemsOnly) {
          applyLocalItemsOnly();
        }
        if (settings.hideCollectionOnly || settings.priceBadges) {
          if (settings.hideCollectionOnly) processAllCards();
          if (settings.priceBadges) applyPriceIntelligence(settings);
          const resultsContainer = document.querySelector(".srp-results") || document.querySelector("#srp-river-results") || document.querySelector(".srp-river-main") || document.querySelector('[id*="ResultSet"]') || document.body;
          const observer = new MutationObserver((mutations) => {
            let hasNewNodes = false;
            for (const mutation of mutations) {
              for (const node of Array.from(mutation.addedNodes)) {
                const el = node.nodeType === 1 ? node : node.parentNode;
                if (el && el.closest && el.closest(
                  "#bb-overview-panel, .bb-badge-container, .bb-price-badge"
                )) {
                  continue;
                }
                hasNewNodes = true;
              }
              if (hasNewNodes) break;
            }
            if (hasNewNodes) {
              if (settings.hideCollectionOnly) processAllCards();
              if (settings.priceBadges) applyPriceIntelligence(settings);
            }
          });
          observer.observe(resultsContainer, {
            childList: true,
            subtree: true
          });
        }
        createSoldButton();
      });
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  })();
})();
