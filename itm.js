"use strict";
(() => {
  // src/utils.ts
  function detectCurrency(host) {
    if (host.includes("ebay.co.uk")) return "\xA3";
    if (host.includes("ebay.com.au")) return "AU $";
    if (host.includes("ebay.ca")) return "C $";
    if (host.includes("ebay.de") || host.includes("ebay.fr") || host.includes("ebay.it") || host.includes("ebay.es") || host.includes("ebay.ie") || host.includes("ebay.nl") || host.includes("ebay.at"))
      return "\u20AC";
    return "$";
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
    const cacheKey2 = title;
    const cached = memoMap.get(cacheKey2);
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
    memoMap.set(cacheKey2, result);
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
  var CROSS_CORPUS_THRESHOLD = 0.15;
  var CENTROID_MAJORITY2 = 0.5;
  function buildGroupCentroid(group) {
    const identityCounts = /* @__PURE__ */ new Map();
    const descriptorCounts = /* @__PURE__ */ new Map();
    const n = group.items.length;
    for (const item of group.items) {
      for (const tok of item.tokens.identity) {
        identityCounts.set(tok, (identityCounts.get(tok) ?? 0) + 1);
      }
      for (const tok of item.tokens.descriptors) {
        descriptorCounts.set(tok, (descriptorCounts.get(tok) ?? 0) + 1);
      }
    }
    const threshold = Math.max(1, Math.ceil(n * CENTROID_MAJORITY2));
    return {
      identity: [...identityCounts.entries()].filter(([, c]) => c >= threshold).map(([t]) => t),
      descriptors: [...descriptorCounts.entries()].filter(([, c]) => c >= threshold).map(([t]) => t),
      noise: /* @__PURE__ */ new Set(),
      raw: /* @__PURE__ */ new Set()
    };
  }
  function rateListingVsSold(listing, groups) {
    let matchedGroup = null;
    let bestScore = CROSS_CORPUS_THRESHOLD;
    function search(gs) {
      for (const g of gs) {
        if (g.confidence === "insufficient") {
          search(g.children);
          continue;
        }
        const score = weightedSimilarity(listing.tokens, buildGroupCentroid(g));
        if (score > bestScore) {
          bestScore = score;
          matchedGroup = g;
        }
        search(g.children);
      }
    }
    search(groups);
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
  function analysePricingVsSold(activeRaw, soldRaw, searchTerm, settings) {
    clearTokenizeCache();
    resetClusterIdCounter();
    const parsedSold = parseRawListings(soldRaw);
    const soldFiltered = parsedSold.filter((l) => !l.isJunk && !l.isExcluded);
    const parsedActive = parseRawListings(activeRaw);
    const activeFiltered = parsedActive.filter((l) => !l.isJunk && !l.isExcluded);
    const filteredOut = parsedActive.filter((l) => l.isJunk || l.isExcluded).length;
    const soldTitles = soldFiltered.map((l) => l.title);
    const soldPrices = soldFiltered.map((l) => l.totalPrice);
    const vocab = discoverIdentityVocab(soldTitles, soldPrices);
    const soldWithTokens = soldFiltered.map((l) => ({
      ...l,
      tokens: tokenize(l.title, vocab)
    }));
    const clusterOptions = settings?.similarityThreshold !== void 0 ? { similarityThreshold: settings.similarityThreshold } : void 0;
    const rootGroups = clusterListings(soldWithTokens, clusterOptions);
    for (const g of rootGroups) computeGroupStats(g);
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
    const activeWithTokens = activeFiltered.map((l) => ({
      ...l,
      tokens: tokenize(l.title, vocab)
    }));
    const assessments = activeWithTokens.map(
      (listing) => rateListingVsSold(listing, rootGroups)
    );
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
        overallPriceRange: { min: overallMin, max: overallMax }
      },
      searchTerm
    };
  }

  // src/pricing/soldFetch.ts
  var CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
  var FETCH_DELAY_MS = 400;
  var PAGES_TO_FETCH = 5;
  function buildSoldUrl(origin, searchTerm, page) {
    const encoded = encodeURIComponent(searchTerm.trim());
    return `${origin}/sch/i.html?_nkw=${encoded}&LH_Sold=1&LH_Complete=1&_pgn=${page}`;
  }
  function cacheKey(searchTerm) {
    return `bb_sold_${searchTerm.trim().toLowerCase().replace(/\s+/g, " ")}`;
  }
  async function getCached(searchTerm) {
    const key = cacheKey(searchTerm);
    try {
      const result = await chrome.storage.local.get(key);
      const entry = result[key];
      if (!entry) return null;
      if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
      return entry.listings;
    } catch {
      return null;
    }
  }
  async function setCached(searchTerm, listings) {
    const key = cacheKey(searchTerm);
    const entry = { listings, fetchedAt: Date.now() };
    try {
      await chrome.storage.local.set({ [key]: entry });
    } catch {
    }
  }
  var CONDITION_SELECTORS = [
    ".s-item__subtitle",
    ".s-item__secondary-info",
    ".SECONDARY_INFO",
    ".s-card__subtitle",
    ".s-item__condition",
    ".s-card__attribute-row"
  ];
  var DELIVERY_SELECTORS = [
    ".s-card__shipping",
    ".s-card__delivery",
    ".s-item__shipping",
    ".s-item__localDelivery",
    ".s-item__delivery"
  ];
  function parseSoldPage(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const cardSelectors = [
      "li.s-card",
      ".s-card",
      "li.s-item",
      ".srp-results .s-item",
      "ul.srp-results > li"
    ];
    let cards = [];
    for (const sel of cardSelectors) {
      const found = doc.querySelectorAll(sel);
      if (found.length > 0) {
        cards = found;
        break;
      }
    }
    const results = [];
    cards.forEach((card) => {
      if (card.classList.contains("s-item__pl-on-bottom") || card.classList.contains("s-card__pl-on-bottom"))
        return;
      const titleEl = card.querySelector(".s-item__title, .s-card__title");
      const priceEl = card.querySelector(".s-item__price, .s-card__price");
      if (!titleEl || !priceEl) return;
      const conditionText = CONDITION_SELECTORS.flatMap(
        (sel) => Array.from(card.querySelectorAll(sel))
      ).map((el) => el.textContent || "").join(" ").trim();
      const deliveryText = DELIVERY_SELECTORS.map(
        (sel) => card.querySelector(sel)?.textContent || ""
      ).find((t) => t.length > 0) ?? "";
      const linkEl = card.querySelector(
        "a.s-item__link, a.s-card__link"
      );
      results.push({
        title: titleEl.textContent || "",
        priceText: priceEl.textContent || "",
        condition: conditionText,
        link: linkEl?.getAttribute("href") || "",
        deliveryText
      });
    });
    return results;
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async function fetchSoldListings(searchTerm, opts = {}) {
    const cached = await getCached(searchTerm);
    if (cached) return cached;
    const origin = opts.origin ?? window.location.origin;
    const startPage = opts.skipPage1 ? 2 : 1;
    const results = [];
    for (let page = startPage; page <= PAGES_TO_FETCH; page++) {
      if (page > startPage) await sleep(FETCH_DELAY_MS);
      const url = buildSoldUrl(origin, searchTerm, page);
      try {
        const response = await fetch(url, {
          credentials: "same-origin",
          headers: { Accept: "text/html" }
        });
        if (!response.ok) break;
        const html = await response.text();
        results.push(...parseSoldPage(html));
      } catch {
        break;
      }
    }
    if (results.length > 0) {
      await setCached(searchTerm, results);
    }
    console.log(
      `[BayBuddy] soldFetch: fetched ${results.length} sold listings for "${searchTerm}"`
    );
    return results;
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
  function createBadgeElement(assessment, currency) {
    if (!assessment.showBadge || assessment.rating === "no-data") return null;
    const style = BADGE_STYLE[assessment.rating];
    const { listing, matchedGroup } = assessment;
    const container = document.createElement("details");
    container.className = "bb-badge-container";
    container.style.cssText = "display:inline-block;position:relative;margin-left:8px;";
    const summary = document.createElement("summary");
    summary.className = "bb-price-badge";
    summary.style.cssText = "display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:500;padding:2px 6px;border-radius:4px;font-family:'Inter',-apple-system,sans-serif;cursor:pointer;list-style:none;";
    const dropdown = document.createElement("div");
    dropdown.className = "bb-badge-dropdown";
    dropdown.style.cssText = "display:block;margin-top:8px;font-size:11px;color:#575b6e;background:#fff;border:1px solid #ccc;padding:8px;border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,0.1);width:max-content;max-width:300px;white-space:normal;";
    container.appendChild(summary);
    container.appendChild(dropdown);
    const totalStr = fmtPrice(listing.totalPrice, currency);
    const postageNote = listing.postage > 0 ? ` (${fmtPrice(listing.itemPrice, currency)} + ${fmtPrice(listing.postage, currency)} p&p)` : " (free postage)";
    summary.style.background = style.bg;
    summary.style.color = style.color;
    summary.innerHTML = style.label;
    summary.title = `Total: ${totalStr}${postageNote}`;
    if (matchedGroup) {
      const g = matchedGroup;
      const medianStr = fmtPrice(g.stats.median, currency);
      const p25Str = fmtPrice(g.stats.p25, currency);
      const p75Str = fmtPrice(g.stats.p75, currency);
      dropdown.innerHTML = `<strong>${g.label}</strong><br>${g.stats.count} comparable sales &middot; median ${medianStr}<br>Typical range: ${p25Str}&ndash;${p75Str}<br><em style="color:#999;">Your total: ${totalStr}${postageNote}</em>`;
    } else {
      dropdown.style.display = "none";
      summary.style.cursor = "default";
    }
    return container;
  }

  // src/itm.ts
  var TITLE_SELECTORS = [
    "h1.x-item-title__mainTitle span.ux-textspans",
    "h1.x-item-title__mainTitle",
    "#itemTitle span",
    "#itemTitle",
    "h1[itemprop='name']"
  ];
  var PRICE_SELECTORS = [
    ".x-price-primary",
    "#prcIsum",
    "#mm-saleDscPrc",
    "[itemprop='price']"
  ];
  var CONDITION_SELECTORS2 = [
    "[data-testid='x-item-condition-value'] .ux-textspans",
    ".vim.d-vim-condition .condText",
    ".condText",
    "#vi-itm-cond",
    ".ux-labels-values__values .ux-textspans"
  ];
  var DELIVERY_SELECTORS2 = [
    "[data-testid='x-shipping-section'] .ux-textspans",
    ".vim.d-shipping-section .ux-textspans",
    "#fshippingCost",
    "#shSummary"
  ];
  function getFirstText(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const text = el?.textContent?.trim();
      if (text) return text;
    }
    return "";
  }
  function scrapeItem() {
    const rawTitle = getFirstText(TITLE_SELECTORS);
    if (!rawTitle) return null;
    const priceText = getFirstText(PRICE_SELECTORS);
    if (!priceText) return null;
    const condition = getFirstText(CONDITION_SELECTORS2);
    const deliveryText = getFirstText(DELIVERY_SELECTORS2);
    return {
      title: rawTitle,
      priceText,
      condition,
      deliveryText,
      link: window.location.href
    };
  }
  function findPriceElement() {
    for (const sel of PRICE_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }
  async function run() {
    const settings = await new Promise((resolve) => {
      chrome.storage.sync.get(
        { priceBadges: true },
        (s) => resolve(s)
      );
    });
    if (!settings.priceBadges) return;
    const raw = scrapeItem();
    if (!raw) {
      console.log("[BayBuddy] itm: could not scrape item details");
      return;
    }
    if (isExcluded(raw) || isMultiVariant(raw)) {
      console.log("[BayBuddy] itm: item excluded (for-parts or multi-variant)");
      return;
    }
    const priceEl = findPriceElement();
    if (!priceEl) return;
    const searchTerm = cleanTitle(raw.title);
    console.log(`[BayBuddy] itm: fetching sold comps for "${searchTerm}"`);
    let soldListings;
    try {
      soldListings = await fetchSoldListings(searchTerm, {
        origin: window.location.origin
      });
    } catch {
      console.log("[BayBuddy] itm: sold fetch failed");
      return;
    }
    if (soldListings.length === 0) {
      console.log("[BayBuddy] itm: no sold comps found");
      return;
    }
    const result = analysePricingVsSold([raw], soldListings, searchTerm);
    const assessment = result.assessments[0];
    if (!assessment) return;
    console.log(
      `[BayBuddy] itm: rating=${assessment.rating} matchedGroup=${assessment.matchedGroup?.label ?? "none"}`
    );
    const currency = detectCurrency(window.location.host);
    const badge = createBadgeElement(assessment, currency);
    if (!badge) return;
    badge.style.cssText = badge.style.cssText + "display:block;margin-top:8px;margin-left:0;";
    priceEl.insertAdjacentElement("afterend", badge);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
