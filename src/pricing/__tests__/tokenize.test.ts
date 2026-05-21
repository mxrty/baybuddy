import * as fs from "fs";
import * as path from "path";
import {
  discoverIdentityVocab,
  tokenize,
  weightedSimilarity,
  clearTokenizeCache,
} from "../tokenize";
import { cleanTitle } from "../parse";
import type { RawListing } from "../types";

const TEST_DATA = path.join(__dirname, "../../../test-data");

function loadTitles(dataset: string): string[] {
  const raw = JSON.parse(
    fs.readFileSync(path.join(TEST_DATA, `${dataset}.json`), "utf-8"),
  ) as { items: RawListing[] };
  return raw.items
    .filter((i) => i.title.toLowerCase().trim() !== "shop on ebay")
    .map((i) => cleanTitle(i.title));
}

function loadPrices(dataset: string): number[] {
  const raw = JSON.parse(
    fs.readFileSync(path.join(TEST_DATA, `${dataset}.json`), "utf-8"),
  ) as { items: RawListing[] };
  return raw.items
    .filter((i) => i.title.toLowerCase().trim() !== "shop on ebay")
    .map((i) => {
      const m = i.priceText.replace(/[£$€,]/g, "").match(/[\d.]+/);
      return m ? parseFloat(m[0]) : 0;
    });
}

beforeEach(() => {
  clearTokenizeCache();
});

// ── discoverIdentityVocab ─────────────────────────────────────────────────────

describe("discoverIdentityVocab — model-shaped tokens", () => {
  test("always includes alphanumeric model tokens regardless of frequency", () => {
    const vocab = discoverIdentityVocab([
      "HP072UK air purifier",
      "Some other listing",
    ]);
    expect(vocab.has("hp072uk")).toBe(true);
  });

  test("includes BP01 model token", () => {
    const vocab = discoverIdentityVocab(["BP01 unit", "unrelated listing"]);
    expect(vocab.has("bp01")).toBe(true);
  });

  test("preserves capacity tokens as identity", () => {
    const vocab = discoverIdentityVocab([
      "512GB storage device",
      "another listing",
    ]);
    expect(vocab.has("512gb")).toBe(true);
  });

  test("preserves 1TB capacity", () => {
    const vocab = discoverIdentityVocab(["1TB hard drive", "other listing"]);
    expect(vocab.has("1tb")).toBe(true);
  });
});

describe("discoverIdentityVocab — frequency-based brand discovery", () => {
  test("discovers Dyson from air-purifier corpus", () => {
    const titles = loadTitles("air-purifier-sold");
    const prices = loadPrices("air-purifier-sold");
    const vocab = discoverIdentityVocab(titles, prices);
    expect(vocab.has("dyson")).toBe(true);
  });

  test("discovers Shark from air-purifier corpus", () => {
    const titles = loadTitles("air-purifier-sold");
    const prices = loadPrices("air-purifier-sold");
    const vocab = discoverIdentityVocab(titles, prices);
    expect(vocab.has("shark")).toBe(true);
  });

  test("discovers iPhone from iphone-16 corpus", () => {
    const titles = loadTitles("iphone-16-sold");
    const prices = loadPrices("iphone-16-sold");
    const vocab = discoverIdentityVocab(titles, prices);
    expect(vocab.has("iphone")).toBe(true);
  });

  test("discovers Pfaltzgraff from stoneware corpus", () => {
    const titles = loadTitles("stoneware-sold");
    const prices = loadPrices("stoneware-sold");
    const vocab = discoverIdentityVocab(titles, prices);
    expect(vocab.has("pfaltzgraff")).toBe(true);
  });

  test("discovers Denby from stoneware corpus", () => {
    const titles = loadTitles("stoneware-sold");
    const prices = loadPrices("stoneware-sold");
    const vocab = discoverIdentityVocab(titles, prices);
    expect(vocab.has("denby")).toBe(true);
  });

  test("does not use capitalisation as a signal — discovers brand even in lower-case corpus", () => {
    const titles = [
      "dyson hp07 pure cool air purifier",
      "dyson hp09 air purifier white",
      "dyson pure cool link desk fan",
    ];
    const vocab = discoverIdentityVocab(titles);
    expect(vocab.has("dyson")).toBe(true);
  });
});

// ── tokenize ─────────────────────────────────────────────────────────────────

describe("tokenize — model number preservation", () => {
  test("HP072UK is preserved as an identity token", () => {
    const vocab = new Set<string>();
    const result = tokenize(
      "Shark NEVERCHANGE5 Compact Pro Air Purifier HP072UK",
      vocab,
    );
    expect(result.identity).toContain("hp072uk");
  });

  test("AC0820/30 is preserved as an identity token", () => {
    const vocab = new Set<string>();
    const result = tokenize("Philips AC0820/30 Air Purifier", vocab);
    expect(result.identity).toContain("ac0820/30");
  });

  test("BP01 is preserved as an identity token", () => {
    const vocab = new Set<string>();
    const result = tokenize(
      "Dyson BP01 Pure Cool Me Personal Air Purifier",
      vocab,
    );
    expect(result.identity).toContain("bp01");
  });

  test("MQ073B/A is preserved as an identity token", () => {
    const vocab = new Set<string>();
    const result = tokenize("Apple MacBook Pro MQ073B/A", vocab);
    expect(result.identity).toContain("mq073b/a");
  });

  test("5s model suffix is an identity token", () => {
    const vocab = new Set<string>();
    const result = tokenize(
      "Apple iPhone 5s Silver 16GB Unlocked Smartphone",
      vocab,
    );
    expect(result.identity).toContain("5s");
  });
});

describe("tokenize — capacity token preservation", () => {
  test("512GB is identity", () => {
    const vocab = new Set<string>();
    const result = tokenize("Apple iPhone 16 Pro 512GB Black Unlocked", vocab);
    expect(result.identity).toContain("512gb");
  });

  test("1TB is identity", () => {
    const vocab = new Set<string>();
    const result = tokenize("Xbox Series X 1TB Console", vocab);
    expect(result.identity).toContain("1tb");
  });

  test("16-piece is identity", () => {
    const vocab = new Set<string>();
    const result = tokenize("Denby 16-piece dinner set", vocab);
    expect(result.identity).toContain("16-piece");
  });

  test("128GB is identity", () => {
    const vocab = new Set<string>();
    const result = tokenize("Apple iPhone 16 128GB Pink Unlocked", vocab);
    expect(result.identity).toContain("128gb");
  });
});

describe("tokenize — vocab-driven identity classification", () => {
  test("word in identityVocab is placed in identity", () => {
    const vocab = new Set(["dyson", "shark"]);
    const result = tokenize("Dyson HP04 Pure Hot Cool Air Purifier", vocab);
    expect(result.identity).toContain("dyson");
  });

  test("word not in vocab is a descriptor", () => {
    const vocab = new Set<string>();
    const result = tokenize("White air purifier bedroom", vocab);
    expect(result.descriptors).toContain("white");
    expect(result.descriptors).toContain("air");
    expect(result.descriptors).toContain("purifier");
  });

  test("stopwords end up in noise", () => {
    const vocab = new Set<string>();
    const result = tokenize("for parts only or repair", vocab);
    expect(result.noise.has("for")).toBe(true);
    expect(result.noise.has("or")).toBe(true);
  });

  test("raw set contains all tokens", () => {
    const vocab = new Set(["dyson"]);
    const result = tokenize("Dyson HP04 White Fan", vocab);
    expect(result.raw.has("dyson")).toBe(true);
    expect(result.raw.has("hp04")).toBe(true);
    expect(result.raw.has("white")).toBe(true);
    expect(result.raw.has("fan")).toBe(true);
  });
});

describe("tokenize — memoisation", () => {
  test("same title returns the same object reference", () => {
    const vocab = new Set<string>();
    const a = tokenize("Xbox Series X Console 1TB", vocab);
    const b = tokenize("Xbox Series X Console 1TB", vocab);
    expect(a).toBe(b);
  });

  test("clearTokenizeCache invalidates memo", () => {
    const vocab = new Set<string>();
    const a = tokenize("Xbox Series X Console 1TB", vocab);
    clearTokenizeCache();
    const b = tokenize("Xbox Series X Console 1TB", vocab);
    expect(a).not.toBe(b);
  });
});

// ── weightedSimilarity ────────────────────────────────────────────────────────

describe("weightedSimilarity — identity overlap dominates", () => {
  test("identical listings have similarity > 1.0", () => {
    const vocab = new Set(["apple", "iphone"]);
    const a = tokenize("Apple iPhone 16 Pro 128GB Black", vocab);
    const b = tokenize("Apple iPhone 16 Pro 128GB Black", vocab);
    clearTokenizeCache();
    expect(weightedSimilarity(a, b)).toBeGreaterThan(1.0);
  });

  test("pure identity overlap scores higher than pure descriptor overlap", () => {
    // Two listings sharing a model number in identity
    const identityVocab = new Set(["dyson"]);
    const sharesIdentity = {
      identity: ["dyson", "hp04"],
      descriptors: ["white", "fan"],
      noise: new Set<string>(),
      raw: new Set<string>(),
    };
    const identityRef = {
      identity: ["dyson", "hp04"],
      descriptors: ["blue", "compact"],
      noise: new Set<string>(),
      raw: new Set<string>(),
    };
    // Two listings sharing only descriptors
    const sharesDescriptors = {
      identity: ["shark", "nv501"],
      descriptors: ["white", "fan"],
      noise: new Set<string>(),
      raw: new Set<string>(),
    };
    const descriptorRef = {
      identity: ["dyson", "hp04"],
      descriptors: ["white", "fan"],
      noise: new Set<string>(),
      raw: new Set<string>(),
    };

    const identityScore = weightedSimilarity(sharesIdentity, identityRef);
    const descriptorScore = weightedSimilarity(
      sharesDescriptors,
      descriptorRef,
    );
    expect(identityScore).toBeGreaterThan(descriptorScore);
  });

  test("completely different listings score 0", () => {
    const vocab = new Set<string>();
    const a = tokenize("Xbox Series X Console", vocab);
    const b = tokenize("Dyson HP04 Air Purifier", vocab);
    clearTokenizeCache();
    expect(weightedSimilarity(a, b)).toBe(0);
  });

  test("empty token sets return 0", () => {
    const a = {
      identity: [],
      descriptors: [],
      noise: new Set<string>(),
      raw: new Set<string>(),
    };
    const b = {
      identity: [],
      descriptors: [],
      noise: new Set<string>(),
      raw: new Set<string>(),
    };
    expect(weightedSimilarity(a, b)).toBe(0);
  });
});
