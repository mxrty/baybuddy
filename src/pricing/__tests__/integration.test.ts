/**
 * Integration tests against real test-data fixtures.
 * Fixtures loaded via fs.readFileSync — resolveJsonModule is NOT enabled.
 */

import * as fs from "fs";
import * as path from "path";
import { analysePricing, analysePricingVsSold } from "../index";
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

// ── iPhone 16 — flat model groups ────────────────────────────────────────────

describe("iphone-16-sold — flat model groups", () => {
  let result: PricingResult;

  beforeAll(() => {
    result = analysePricing(loadDataset("iphone-16-sold"), "iphone 16");
  });

  test("all model groups are flat (depth 0, no children)", () => {
    for (const g of result.rootGroups) {
      expect(g.depth).toBe(0);
      expect(g.children).toHaveLength(0);
    }
  });

  test("group labels are model-token keys, not brand names", () => {
    for (const g of result.rootGroups) {
      // Groups keyed by storage/model tokens like "128gb", "256gb" — never brand "iphone"
      expect(g.label).not.toMatch(/^iphone/i);
    }
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

// ── Stoneware — no monolithic cluster ──────────────────────────────────────

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

describe("cross-dataset — flat model structure", () => {
  for (const dataset of ALL_DATASETS) {
    test(`${dataset}: all groups have depth 0 and no children`, () => {
      const result = analysePricing(
        loadDataset(dataset),
        dataset.replace(/-/g, " "),
      );
      for (const g of result.rootGroups) {
        expect(g.depth).toBe(0);
        expect(g.children).toHaveLength(0);
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

// ── Debug fields — sampleComps / topMatchScore / activeModelKey ───────────────

describe("analysePricingVsSold — debug fields populated", () => {
  let result: PricingResult;

  beforeAll(() => {
    result = analysePricingVsSold(
      loadDataset("iphone-16-active"),
      loadDataset("iphone-16-sold"),
      "iphone 16",
    );
  });

  test("badged assessments have sampleComps with title+totalPrice", () => {
    const badged = result.assessments.filter((a) => a.showBadge);
    expect(badged.length).toBeGreaterThan(0);
    for (const a of badged) {
      expect(a.sampleComps).toBeDefined();
      expect((a.sampleComps ?? []).length).toBeGreaterThan(0);
      for (const c of a.sampleComps ?? []) {
        expect(typeof c.title).toBe("string");
        expect(c.title.length).toBeGreaterThan(0);
        expect(typeof c.totalPrice).toBe("number");
        expect(c.totalPrice).toBeGreaterThan(0);
      }
      expect((a.sampleComps ?? []).length).toBeLessThanOrEqual(5);
    }
  });

  test("badged assessments have a positive topMatchScore", () => {
    const badged = result.assessments.filter((a) => a.showBadge);
    for (const a of badged) {
      expect(typeof a.topMatchScore).toBe("number");
      expect(a.topMatchScore as number).toBeGreaterThan(0);
    }
  });

  test("assessments with model tokens have an activeModelKey string", () => {
    const withModel = result.assessments.filter(
      (a) => a.listing.tokens.model.length > 0,
    );
    expect(withModel.length).toBeGreaterThan(0);
    for (const a of withModel) {
      expect(typeof a.activeModelKey).toBe("string");
      expect((a.activeModelKey ?? "").length).toBeGreaterThan(0);
    }
  });
});

// ── Comp quality — model gate regression guard ───────────────────────────────

describe("comp quality — model gate regression guard", () => {
  test("every badged assessment: all comps in matchedGroup share ≥1 model token with the active listing", () => {
    const sold = loadDataset("iphone-16-sold");
    const active = loadDataset("iphone-16-active");
    const result = analysePricingVsSold(active, sold, "iphone 16");

    let assertionCount = 0;
    for (const assessment of result.assessments) {
      if (!assessment.showBadge || !assessment.matchedGroup) continue;
      const listingModels = new Set(assessment.listing.tokens.model);
      if (listingModels.size === 0) continue;

      for (const comp of assessment.matchedGroup.items) {
        const hasOverlap = comp.tokens.model.some((m) => listingModels.has(m));
        expect(hasOverlap).toBe(true);
        assertionCount++;
      }
    }

    // Ensure the guard actually ran — at least one badged listing with model tokens
    expect(assertionCount).toBeGreaterThan(0);
  });

  test("Xbox 360 comps do not bleed into Series X/S groups (cross-model gate)", () => {
    const sold = loadDataset("xbox-sold");
    const result = analysePricing(sold, "xbox");

    for (const assessment of result.assessments) {
      if (!assessment.showBadge || !assessment.matchedGroup) continue;
      const listingModels = new Set(assessment.listing.tokens.model);
      if (listingModels.size === 0) continue;

      for (const comp of assessment.matchedGroup.items) {
        const compModels = comp.tokens.model;
        if (compModels.length === 0) continue;
        // Both have model tokens — they must share at least one
        const hasOverlap = compModels.some((m) => listingModels.has(m));
        expect(hasOverlap).toBe(true);
      }
    }
  });
});
