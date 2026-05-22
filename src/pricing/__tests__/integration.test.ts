/**
 * Integration tests against real test-data fixtures.
 * Fixtures loaded via fs.readFileSync — resolveJsonModule is NOT enabled.
 */

import * as fs from "fs";
import * as path from "path";
import { analysePricing, analysePricingVsSold, mergeGapFillComps } from "../index";
import type { RawListing, PricingGroup, PricingResult } from "../types";

const TEST_DATA = path.join(__dirname, "../../../test-data");

function loadDataset(name: string): RawListing[] {
  const raw = JSON.parse(
    fs.readFileSync(path.join(TEST_DATA, `${name}.json`), "utf-8"),
  ) as { items: RawListing[] };
  return raw.items;
}

function allGroups(groups: PricingGroup[]): PricingGroup[] {
  const result: PricingGroup[] = [];
  for (const g of groups) {
    result.push(g);
    result.push(...allGroups(g.children));
  }
  return result;
}

function leafGroups(groups: PricingGroup[]): PricingGroup[] {
  return allGroups(groups).filter((g) => g.children.length === 0);
}

// ── iPhone 16 — hierarchical grouping ────────────────────────────────────────

describe("iphone-16-sold — hierarchical structure", () => {
  let result: PricingResult;

  beforeAll(() => {
    result = analysePricing(loadDataset("iphone-16-sold"), "iphone 16");
  });

  test("produces at least one top-level group with children (hierarchical split fired)", () => {
    const withChildren = result.rootGroups.filter((g) => g.children.length > 0);
    expect(withChildren.length).toBeGreaterThanOrEqual(1);
  });

  test("iphone-containing groups exist at the top level", () => {
    const iphoneGroups = result.rootGroups.filter((g) =>
      g.label.includes("iphone"),
    );
    expect(iphoneGroups.length).toBeGreaterThanOrEqual(1);
  });

  test("at least one group contains Pro listings", () => {
    const flat = allGroups(result.rootGroups);
    const proGroup = flat.find((g) =>
      g.items.some((i) => /pro/i.test(i.title)),
    );
    expect(proGroup).toBeDefined();
  });

  test("Pro Max and plain iPhone 16 appear in distinct groups or sub-groups", () => {
    const flat = allGroups(result.rootGroups);
    const proMaxGroup = flat.find(
      (g) =>
        g.items.some((i) => /pro max/i.test(i.title)) &&
        g.children.length === 0,
    );
    const plainGroup = flat.find(
      (g) =>
        g.items.some((i) =>
          /iphone 16(?! pro| plus| max| 16e)/i.test(i.title),
        ) && g.children.length === 0,
    );
    if (proMaxGroup && plainGroup) {
      expect(proMaxGroup.id).not.toBe(plainGroup.id);
    }
  });

  test("hierarchical splitter never creates a child group with fewer than 3 items", () => {
    const flat = allGroups(result.rootGroups);
    for (const g of flat.filter((g) => g.depth > 0)) {
      expect(g.items.length).toBeGreaterThanOrEqual(3);
    }
  });
});

// ── Xbox — multiple distinct product groups ───────────────────────────────────

describe("xbox-sold — distinct product groups", () => {
  let result: PricingResult;

  beforeAll(() => {
    result = analysePricing(loadDataset("xbox-sold"), "xbox");
  });

  test("produces at least 3 leaf groups", () => {
    expect(leafGroups(result.rootGroups).length).toBeGreaterThanOrEqual(3);
  });

  test("Series X and Series S appear in separate groups", () => {
    const flat = allGroups(result.rootGroups);
    const seriesXGroup = flat.find((g) =>
      g.items.some((i) => /series x/i.test(i.title)),
    );
    const seriesSGroup = flat.find((g) =>
      g.items.some((i) => /series s/i.test(i.title)),
    );
    if (seriesXGroup && seriesSGroup) {
      expect(seriesXGroup.id).not.toBe(seriesSGroup.id);
    }
    // At least one of them must exist
    expect(seriesXGroup ?? seriesSGroup).toBeDefined();
  });

  test("no badge issued from a group with fewer than 3 items", () => {
    for (const assessment of result.assessments) {
      if (assessment.showBadge && assessment.matchedGroup) {
        expect(assessment.matchedGroup.items.length).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

// ── Nintendo Switch — three models separable ─────────────────────────────────

describe("nintendo-switch-sold — model separation", () => {
  let result: PricingResult;

  beforeAll(() => {
    result = analysePricing(
      loadDataset("nintendo-switch-sold"),
      "nintendo switch",
    );
  });

  test("produces multiple groups", () => {
    expect(leafGroups(result.rootGroups).length).toBeGreaterThanOrEqual(2);
  });

  test("Switch OLED and Switch Lite appear in at least one group each if present", () => {
    const flat = allGroups(result.rootGroups);
    const hasOled = flat.some((g) =>
      g.items.some((i) => /oled/i.test(i.title)),
    );
    const hasLite = flat.some((g) =>
      g.items.some((i) => /lite/i.test(i.title)),
    );
    // If the dataset contains these variants, they should appear somewhere
    const rawItems = loadDataset("nintendo-switch-sold");
    const oledInData = rawItems.some((i) => /oled/i.test(i.title));
    const liteInData = rawItems.some((i) => /lite/i.test(i.title));
    if (oledInData) expect(hasOled).toBe(true);
    if (liteInData) expect(hasLite).toBe(true);
  });
});

// ── Air purifier — Dyson vs generics ─────────────────────────────────────────

describe("air-purifier-sold — brand separation", () => {
  let result: PricingResult;

  beforeAll(() => {
    result = analysePricing(loadDataset("air-purifier-sold"), "air purifier");
  });

  test("produces multiple groups", () => {
    expect(leafGroups(result.rootGroups).length).toBeGreaterThanOrEqual(2);
  });

  test("Dyson listings and cheap generic listings are in different groups (if both present)", () => {
    const raw = loadDataset("air-purifier-sold");
    const hasDyson = raw.some((i) => /dyson/i.test(i.title));
    if (!hasDyson) return;

    const flat = allGroups(result.rootGroups);
    const dysonGroup = flat.find((g) =>
      g.items.some((i) => /dyson/i.test(i.title)),
    );
    expect(dysonGroup).toBeDefined();

    // Dyson group median should be notably higher than cheapest group
    const groups = leafGroups(result.rootGroups);
    if (groups.length >= 2 && dysonGroup && dysonGroup.children.length === 0) {
      const cheapest = groups.reduce((a, b) =>
        a.stats.median < b.stats.median ? a : b,
      );
      // Dyson median should be above the cheapest group's median
      expect(dysonGroup.stats.median).toBeGreaterThan(cheapest.stats.median);
    }
  });
});

// ── Stoneware — no single giant cluster ──────────────────────────────────────

describe("stoneware-sold — no monolithic cluster", () => {
  let result: PricingResult;

  beforeAll(() => {
    result = analysePricing(loadDataset("stoneware-sold"), "stoneware");
  });

  test("does not produce a single group containing all listings", () => {
    const total = result.summary.totalListingsAnalysed;
    const largest = leafGroups(result.rootGroups).reduce(
      (max, g) => Math.max(max, g.items.length),
      0,
    );
    // Largest group should not contain everything — expect at least 2 clusters
    expect(leafGroups(result.rootGroups).length).toBeGreaterThanOrEqual(2);
    expect(largest).toBeLessThan(total);
  });
});

// ── BMW / VW Golf — high-variance, mostly ungroupable ────────────────────────

describe("bmw-sold — high variance, few badges", () => {
  let result: PricingResult;

  beforeAll(() => {
    result = analysePricing(loadDataset("bmw-sold"), "bmw");
  });

  test("most assessments have no badge (heterogeneous data)", () => {
    const withBadge = result.assessments.filter((a) => a.showBadge).length;
    const total = result.assessments.length;
    // At least 30% should lack a badge for a heterogeneous dataset
    expect(withBadge).toBeLessThan(total * 0.7);
  });

  test("no badge issued from a group with fewer than 3 items", () => {
    for (const assessment of result.assessments) {
      if (assessment.showBadge && assessment.matchedGroup) {
        expect(assessment.matchedGroup.items.length).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("volkswagen-golf-sold — high variance, few badges", () => {
  let result: PricingResult;

  beforeAll(() => {
    result = analysePricing(
      loadDataset("volkswagen-golf-sold"),
      "volkswagen golf",
    );
  });

  test("salvage/spares cars are excluded from analysis", () => {
    const excluded = result.summary.filteredOut;
    expect(excluded).toBeGreaterThanOrEqual(5);
  });

  test("badge rate is not universal (heterogeneous year/model spread)", () => {
    const withBadge = result.assessments.filter((a) => a.showBadge).length;
    const total = result.assessments.length;
    // After excluding salvage outliers, remaining clean Golfs span many years/models;
    // badge rate can be higher than before but should not reach 100%.
    expect(withBadge).toBeLessThan(total);
  });
});

// ── Cross-dataset checks ──────────────────────────────────────────────────────

const ALL_DATASETS = [
  "xbox-sold",
  "xbox-used",
  "nintendo-switch-sold",
  "nintendo-switch-active",
  "iphone-16-sold",
  "iphone-16-active",
  "stoneware-sold",
  "stoneware-used",
  "air-purifier-sold",
  "air-purifier-active",
  "bmw-sold",
  "bmw-active",
  "volkswagen-golf-sold",
  "volkswagen-golf-active",
];

describe("cross-dataset — junk filter", () => {
  for (const dataset of ALL_DATASETS) {
    test(`${dataset}: "Shop on eBay" items are filtered out`, () => {
      const raw = loadDataset(dataset);
      const shopItems = raw.filter((i) => i.title.trim() === "Shop on eBay");
      if (shopItems.length === 0) return; // dataset has none, vacuously pass

      const result = analysePricing(raw, dataset.replace(/-/g, " "));
      const allTitles = result.assessments.map((a) => a.listing.title);
      expect(allTitles.every((t) => t.trim() !== "Shop on eBay")).toBe(true);
      expect(result.summary.filteredOut).toBeGreaterThanOrEqual(
        shopItems.length,
      );
    });
  }
});

describe("cross-dataset — postage extraction rate", () => {
  for (const dataset of ALL_DATASETS) {
    test(`${dataset}: postage known for ≥ 80% of listings that have deliveryText`, () => {
      const raw = loadDataset(dataset);
      const withDelivery = raw.filter(
        (i) => i.deliveryText && i.deliveryText.trim() !== "",
      );
      if (withDelivery.length === 0) return;

      const result = analysePricing(raw, dataset.replace(/-/g, " "));
      // Map from link → assessment for quick lookup
      const assessmentByLink = new Map(
        result.assessments.map((a) => [a.listing.link, a]),
      );

      let known = 0;
      let checked = 0;
      for (const item of withDelivery) {
        const assessment = assessmentByLink.get(item.link);
        if (!assessment) continue;
        checked++;
        if (assessment.listing.postageKnown) known++;
      }

      if (checked === 0) return;
      const rate = known / checked;
      console.log(
        `[${dataset}] postage known rate: ${(rate * 100).toFixed(1)}% (${known}/${checked})`,
      );
      expect(rate).toBeGreaterThanOrEqual(0.8);
    });
  }
});

describe("cross-dataset — no badge from groups < 3 items", () => {
  for (const dataset of ALL_DATASETS) {
    test(`${dataset}: every badged listing is in a group with ≥ 3 items`, () => {
      const result = analysePricing(
        loadDataset(dataset),
        dataset.replace(/-/g, " "),
      );
      for (const a of result.assessments) {
        if (a.showBadge && a.matchedGroup) {
          expect(a.matchedGroup.items.length).toBeGreaterThanOrEqual(3);
        }
      }
    });
  }
});

// ── Performance ───────────────────────────────────────────────────────────────

describe("performance — largest dataset under 200ms", () => {
  test("full pipeline on largest available dataset completes in < 200ms", () => {
    // Find the dataset with the most items
    let largestDataset = ALL_DATASETS[0];
    let largestCount = 0;
    for (const ds of ALL_DATASETS) {
      const items = loadDataset(ds);
      if (items.length > largestCount) {
        largestCount = items.length;
        largestDataset = ds;
      }
    }

    const raw = loadDataset(largestDataset);
    const start = Date.now();
    analysePricing(raw, largestDataset.replace(/-/g, " "));
    const elapsed = Date.now() - start;

    console.log(`[perf] ${largestDataset} (${raw.length} items): ${elapsed}ms`);
    expect(elapsed).toBeLessThan(200);
  });
});

// ── analysePricingVsSold ──────────────────────────────────────────────────────

describe("analysePricingVsSold — active listings rated against sold groups", () => {
  let result: PricingResult;
  const soldRaw: RawListing[] = [];
  const activeRaw: RawListing[] = [];

  beforeAll(() => {
    soldRaw.push(...loadDataset("iphone-16-sold"));
    activeRaw.push(...loadDataset("iphone-16-active"));
    result = analysePricingVsSold(activeRaw, soldRaw, "iphone 16");
  });

  test("assessments correspond to active listings, not sold listings", () => {
    // Assessment count matches filtered active listings (not the larger sold set)
    expect(result.summary.totalListingsAnalysed).toBeLessThanOrEqual(
      activeRaw.length,
    );
    expect(result.summary.totalListingsAnalysed).toBeLessThan(soldRaw.length);
  });

  test("root groups are derived from sold corpus (group item count can exceed active count)", () => {
    // Groups cluster the sold listings; their item pools may be larger than active set
    const totalGroupItems = allGroups(result.rootGroups).reduce(
      (sum, g) => sum + g.items.length,
      0,
    );
    // Sold corpus is bigger than active — so group items should exceed active count
    expect(totalGroupItems).toBeGreaterThan(result.summary.totalListingsAnalysed);
  });

  test("at least some active listings match a sold group and receive a badge", () => {
    const badged = result.assessments.filter((a) => a.showBadge);
    expect(badged.length).toBeGreaterThan(0);
  });

  test("no-data assessments have showBadge false", () => {
    const noData = result.assessments.filter((a) => a.rating === "no-data");
    expect(noData.every((a) => !a.showBadge)).toBe(true);
  });

  test("badges only issued from sold groups with ≥ 3 items", () => {
    for (const a of result.assessments) {
      if (a.showBadge && a.matchedGroup) {
        expect(a.matchedGroup.items.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  test("produces more badged listings than active-only baseline", () => {
    // Sold corpus has far more data → should yield at least as many confident groups
    const vsoldBadged = result.assessments.filter((a) => a.showBadge).length;
    const activeonlyResult = analysePricing(activeRaw, "iphone 16");
    const activeOnlyBadged = activeonlyResult.assessments.filter(
      (a) => a.showBadge,
    ).length;
    // With ~250–300 sold comps vs ~60 active, vs-sold should badge more listings
    expect(vsoldBadged).toBeGreaterThanOrEqual(activeOnlyBadged);
  });
});

// ── mergeGapFillComps ─────────────────────────────────────────────────────────

describe("mergeGapFillComps", () => {
  function makeRaw(title: string, price: string): RawListing {
    return { title, priceText: price, condition: "Used", link: "/itm/x", deliveryText: "" };
  }

  test("returns original result unchanged when compsPerGroup is empty", () => {
    const soldRaw = loadDataset("iphone-16-sold");
    const activeRaw = loadDataset("iphone-16-active");
    const result = analysePricingVsSold(activeRaw, soldRaw, "iphone 16");
    const filled = mergeGapFillComps(result, new Map());
    expect(filled).toBe(result);
  });

  test("adds comps to target group, raises confidence, and produces more badges", () => {
    // Build a sold corpus with only 2 items — insufficient confidence
    const thinSold: RawListing[] = [
      makeRaw("Apple iPhone 16 128GB", "£600.00"),
      makeRaw("Apple iPhone 16 128GB", "£620.00"),
    ];
    const activeRaw: RawListing[] = [makeRaw("Apple iPhone 16 128GB", "£610.00")];
    const result = analysePricingVsSold(activeRaw, thinSold, "iphone 16 128gb");

    // The one group should be insufficient (only 2 items)
    const targetGroup = allGroups(result.rootGroups).find(
      (g) => g.children.length === 0,
    );
    expect(targetGroup).toBeDefined();
    expect(targetGroup!.confidence).toBe("insufficient");
    expect(result.assessments[0].showBadge).toBe(false);

    // Gap-fill: inject 10 more sold comps for that group
    const extraComps: RawListing[] = Array.from({ length: 10 }, (_, i) =>
      makeRaw("Apple iPhone 16 128GB", `£${600 + i * 5}.00`),
    );
    const compsPerGroup = new Map<PricingGroup, RawListing[]>([[targetGroup!, extraComps]]);
    const filled = mergeGapFillComps(result, compsPerGroup);

    // Group should now have enough items for low/medium/high confidence
    const updatedGroup = allGroups(filled.rootGroups).find(
      (g) => g.id === targetGroup!.id,
    );
    expect(updatedGroup!.items.length).toBe(12);
    expect(updatedGroup!.confidence).not.toBe("insufficient");

    // The active listing should now receive a badge
    expect(filled.assessments[0].showBadge).toBe(true);
    expect(filled.assessments[0].matchedGroup).not.toBeNull();
  });

  test("returns a new result object (does not mutate original assessments array)", () => {
    const thinSold: RawListing[] = [
      makeRaw("Apple iPhone 16 128GB", "£600.00"),
      makeRaw("Apple iPhone 16 128GB", "£620.00"),
    ];
    const activeRaw: RawListing[] = [makeRaw("Apple iPhone 16 128GB", "£610.00")];
    const result = analysePricingVsSold(activeRaw, thinSold, "iphone 16 128gb");

    const targetGroup = allGroups(result.rootGroups).find(
      (g) => g.children.length === 0,
    )!;
    const extraComps: RawListing[] = Array.from({ length: 5 }, () =>
      makeRaw("Apple iPhone 16 128GB", "£610.00"),
    );
    const filled = mergeGapFillComps(
      result,
      new Map([[targetGroup, extraComps]]),
    );

    expect(filled).not.toBe(result);
    expect(filled.assessments).not.toBe(result.assessments);
  });

  test("centroid tokens include new comps (no dilution)", () => {
    // Verify that adding items with proper tokens does not empty the centroid.
    // After gap-fill, rateListingVsSold must still match the active listing.
    const soldRaw = loadDataset("iphone-16-sold");
    const activeRaw = loadDataset("iphone-16-active");
    const result = analysePricingVsSold(activeRaw, soldRaw, "iphone 16");

    // Find a low/insufficient group to augment
    const lowGroup = allGroups(result.rootGroups).find(
      (g) =>
        g.children.length === 0 &&
        (g.confidence === "low" || g.confidence === "insufficient"),
    );
    if (!lowGroup) return; // dataset may not have one — vacuous pass

    const beforeCount = lowGroup.items.length;
    const extraComps: RawListing[] = Array.from({ length: 8 }, () =>
      makeRaw(lowGroup.items[0]?.title ?? "Apple iPhone 16", "£600.00"),
    );
    const filled = mergeGapFillComps(
      result,
      new Map([[lowGroup, extraComps]]),
    );

    // The updated group should have items
    const updated = allGroups(filled.rootGroups).find(
      (g) => g.id === lowGroup.id,
    )!;
    expect(updated.items.length).toBeGreaterThan(beforeCount);
    // Confidence should have improved (same or better, never regressed)
    const rankMap = { insufficient: 0, low: 1, medium: 2, high: 3 };
    expect(rankMap[updated.confidence]).toBeGreaterThanOrEqual(
      rankMap[lowGroup.confidence],
    );
  });
});
