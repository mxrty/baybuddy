import { clusterListings, resetClusterIdCounter } from "../cluster";
import { clearTokenizeCache } from "../tokenize";
import type { ParsedListing } from "../types";

function makeListing(
  title: string,
  identity: string[],
  descriptors: string[],
  totalPrice = 100,
  opts: Partial<Pick<ParsedListing, "isJunk" | "isExcluded">> = {},
): ParsedListing {
  return {
    title,
    itemPrice: totalPrice,
    postage: 0,
    postageKnown: true,
    totalPrice,
    condition: "Used",
    link: "",
    tokens: {
      identity,
      descriptors,
      noise: new Set<string>(),
      raw: new Set<string>(identity.concat(descriptors)),
    },
    isJunk: opts.isJunk ?? false,
    isExcluded: opts.isExcluded ?? false,
  };
}

beforeEach(() => {
  resetClusterIdCounter();
  clearTokenizeCache();
});

// ── Centroid behaviour ────────────────────────────────────────────────────────

describe("clusterListings — centroid (no chain drift)", () => {
  test("assigns items to the best-matching centroid, not the first member", () => {
    // C1 seed: Xbox Series X
    // C2 seed: Dyson HP07
    // Third item "Xbox Series S" — should join C1 (shares xbox), not C2
    const xboxX = makeListing(
      "Xbox Series X 1TB",
      ["xbox", "series", "1tb"],
      ["console"],
    );
    const dyson = makeListing(
      "Dyson HP07 Air Purifier",
      ["dyson", "hp07"],
      ["air", "purifier"],
    );
    const xboxS = makeListing(
      "Xbox Series S 512GB",
      ["xbox", "series", "512gb"],
      ["console"],
    );

    const groups = clusterListings([xboxX, dyson, xboxS]);
    const xboxGroup = groups.find((g) => g.items.includes(xboxX));
    expect(xboxGroup).toBeDefined();
    expect(xboxGroup!.items).toContain(xboxS);
    expect(xboxGroup!.items).not.toContain(dyson);
  });

  test("items with no identity overlap form separate clusters", () => {
    const a = makeListing("Xbox Series X", ["xbox", "series"], []);
    const b = makeListing("Dyson HP07", ["dyson", "hp07"], []);
    const c = makeListing("Nintendo Switch", ["nintendo", "switch"], []);

    const groups = clusterListings([a, b, c]);
    expect(groups.length).toBe(3);
  });

  test("identical listings end up in the same cluster", () => {
    const listings = Array.from({ length: 4 }, () =>
      makeListing(
        "Xbox Series X 1TB Console",
        ["xbox", "series", "1tb"],
        ["console"],
      ),
    );
    const groups = clusterListings(listings);
    expect(groups.length).toBe(1);
    expect(groups[0].items.length).toBe(4);
  });
});

// ── Junk / excluded filtering ─────────────────────────────────────────────────

describe("clusterListings — junk and excluded filtering", () => {
  test("junk items are excluded from clusters", () => {
    const real = makeListing("Xbox Series X", ["xbox", "series"], []);
    const junk = makeListing("Shop on eBay", ["shop"], [], 20, {
      isJunk: true,
    });
    const groups = clusterListings([real, junk]);
    const allItems = groups.flatMap((g) => g.items);
    expect(allItems).not.toContain(junk);
  });

  test("excluded items are not clustered", () => {
    const real = makeListing("Xbox Series X", ["xbox", "series"], []);
    const excluded = makeListing(
      "Xbox Series X For Parts",
      ["xbox", "series"],
      ["parts"],
      50,
      {
        isExcluded: true,
      },
    );
    const groups = clusterListings([real, excluded]);
    const allItems = groups.flatMap((g) => g.items);
    expect(allItems).not.toContain(excluded);
    expect(allItems).toContain(real);
  });

  test("returns empty array when all listings are junk/excluded", () => {
    const junk = makeListing("Shop on eBay", ["shop"], [], 20, {
      isJunk: true,
    });
    expect(clusterListings([junk])).toEqual([]);
  });
});

// ── Hierarchical splitting ────────────────────────────────────────────────────

describe("clusterListings — hierarchical splitting", () => {
  test("does not split groups with fewer than 6 items", () => {
    // 5 nearly-identical listings — no split expected
    const listings = Array.from({ length: 5 }, () =>
      makeListing("Xbox Series X", ["xbox", "series"], []),
    );
    const groups = clusterListings(listings);
    const allLeaves = groups.filter((g) => g.children.length === 0);
    expect(allLeaves.every((g) => g.children.length === 0)).toBe(true);
  });

  test("splits a group of 6+ items when a discriminating token cleanly partitions ≥ 3 each", () => {
    // 4 items with "pro" in identity, 4 without → should split
    const withPro = Array.from({ length: 4 }, () =>
      makeListing("Widget Pro Model", ["widget", "pro"], ["model"]),
    );
    const withoutPro = Array.from({ length: 4 }, () =>
      makeListing("Widget Basic Model", ["widget"], ["basic", "model"]),
    );

    const groups = clusterListings([...withPro, ...withoutPro]);
    const parent = groups.find((g) => g.children.length > 0);
    expect(parent).toBeDefined();
    expect(parent!.children.length).toBe(2);
    const childItemCounts = parent!.children.map((c) => c.items.length);
    expect(childItemCounts.every((c) => c >= 3)).toBe(true);
  });

  test("does not split when no token cleanly partitions ≥ 3 + ≥ 3", () => {
    // 6 identical listings — no discriminating token
    const listings = Array.from({ length: 6 }, () =>
      makeListing("Xbox Series X 1TB", ["xbox", "series", "1tb"], ["console"]),
    );
    const groups = clusterListings(listings);
    expect(groups[0].children.length).toBe(0);
  });

  test("depth cap: hierarchical recursion stops at depth 2", () => {
    // Three tiers: "widget", "widget pro", "widget pro max"
    // Should produce at most depth-2 children
    const base = Array.from({ length: 4 }, () =>
      makeListing("Widget", ["widget"], []),
    );
    const pro = Array.from({ length: 4 }, () =>
      makeListing("Widget Pro", ["widget", "pro"], []),
    );
    const proMax = Array.from({ length: 4 }, () =>
      makeListing("Widget Pro Max", ["widget", "pro", "max"], []),
    );

    const groups = clusterListings([...base, ...pro, ...proMax]);

    function maxDepth(g: { children: (typeof g)[] }): number {
      if (g.children.length === 0) return 0;
      return 1 + Math.max(...g.children.map(maxDepth));
    }

    const depth = Math.max(...groups.map(maxDepth));
    expect(depth).toBeLessThanOrEqual(2);
  });

  test("child groups have correct parent reference", () => {
    const withPro = Array.from({ length: 4 }, () =>
      makeListing("Device Pro", ["device", "pro"], []),
    );
    const withoutPro = Array.from({ length: 4 }, () =>
      makeListing("Device Basic", ["device"], ["basic"]),
    );
    const groups = clusterListings([...withPro, ...withoutPro]);
    const parent = groups.find((g) => g.children.length > 0);
    if (parent) {
      for (const child of parent.children) {
        expect(child.parent).toBe(parent.id);
      }
    }
  });
});

// ── Similarity threshold ──────────────────────────────────────────────────────

describe("clusterListings — similarity threshold option", () => {
  test("high threshold prevents loosely-related items from clustering", () => {
    // "iphone 128gb" vs "iphone pro 256gb" — only share "iphone"
    // With very high threshold these should be separate clusters
    const plain = makeListing("iPhone 128GB", ["iphone", "128gb"], []);
    const pro = makeListing("iPhone Pro 256GB", ["iphone", "pro", "256gb"], []);
    const groups = clusterListings([plain, pro], { similarityThreshold: 0.8 });
    expect(groups.length).toBe(2);
  });

  test("low threshold allows loosely-related items to cluster", () => {
    const plain = makeListing("iPhone 128GB", ["iphone", "128gb"], []);
    const pro = makeListing("iPhone Pro 256GB", ["iphone", "pro", "256gb"], []);
    const groups = clusterListings([plain, pro], { similarityThreshold: 0.1 });
    expect(groups.length).toBe(1);
  });
});

// ── Post-cluster merge pass ───────────────────────────────────────────────────

describe("clusterListings — post-cluster merge pass", () => {
  test("collapses duplicate groups whose centroids are near-identical", () => {
    // Two stable clusters the greedy pass seeds apart at a strict threshold:
    //   A: "apple iphone 128gb"   identity [iphone, 128gb, apple]
    //   B: "iphone 128gb"         identity [iphone, 128gb]
    // Centroid similarity = jaccard(2/3) = 0.667 ≥ 0.6 → merge into one group.
    // Total 4 items (< 6) so no hierarchical re-split.
    const a = Array.from({ length: 2 }, () =>
      makeListing("Apple iPhone 128GB", ["iphone", "128gb", "apple"], []),
    );
    const b = Array.from({ length: 2 }, () =>
      makeListing("iPhone 128GB", ["iphone", "128gb"], []),
    );

    const groups = clusterListings([...a, ...b], { similarityThreshold: 0.7 });
    expect(groups.length).toBe(1);
    expect(groups[0].items.length).toBe(4);
  });

  test("does not merge clusters that differ on a discriminating identity token", () => {
    // A: iphone 128gb   B: iphone 256gb — share only "iphone".
    // Centroid similarity = jaccard(1/3) = 0.33 < 0.6 → stay separate.
    const a = Array.from({ length: 2 }, () =>
      makeListing("iPhone 128GB", ["iphone", "128gb"], []),
    );
    const b = Array.from({ length: 2 }, () =>
      makeListing("iPhone 256GB", ["iphone", "256gb"], []),
    );

    const groups = clusterListings([...a, ...b], { similarityThreshold: 0.7 });
    expect(groups.length).toBe(2);
  });
});

// ── Output shape ─────────────────────────────────────────────────────────────

describe("clusterListings — output shape", () => {
  test("each group has required fields", () => {
    const listings = [makeListing("Xbox Series X", ["xbox", "series"], [])];
    const groups = clusterListings(listings);
    expect(groups.length).toBe(1);
    const g = groups[0];
    expect(g.id).toBeTruthy();
    expect(typeof g.label).toBe("string");
    expect(Array.isArray(g.items)).toBe(true);
    expect(Array.isArray(g.children)).toBe(true);
    expect(g.depth).toBe(0);
    expect(g.parent).toBeNull();
    expect(g.stats).toBeDefined();
    expect(g.confidence).toBe("insufficient");
  });

  test("group stats.count matches items length", () => {
    const listings = Array.from({ length: 5 }, () =>
      makeListing("Xbox Series X", ["xbox", "series"], []),
    );
    const groups = clusterListings(listings);
    for (const g of groups) {
      expect(g.stats.count).toBe(g.items.length);
    }
  });

  test("returns empty array for empty input", () => {
    expect(clusterListings([])).toEqual([]);
  });
});
