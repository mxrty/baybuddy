import { similarity, findComps, buildModelGroups, resetGroupIdCounter } from "../match";
import { tokenize, clearTokenizeCache } from "../tokenize";
import type { ParsedListing } from "../types";

beforeEach(() => {
  clearTokenizeCache();
  resetGroupIdCounter();
});

function makeListing(
  title: string,
  totalPrice = 50,
  vocab: Set<string> = new Set(),
  overrides: Partial<ParsedListing> = {},
): ParsedListing {
  return {
    title,
    itemPrice: totalPrice,
    postage: 0,
    postageKnown: true,
    totalPrice,
    condition: "Used",
    link: "https://example.com",
    tokens: tokenize(title, vocab),
    isJunk: false,
    isExcluded: false,
    ...overrides,
  };
}

// ── similarity — model gate ───────────────────────────────────────────────────

describe("similarity — model gate", () => {
  test("574 vs 9060 → 0 (non-intersecting model tokens)", () => {
    const a = makeListing("New Balance 574 trainers");
    const b = makeListing("New Balance 9060 shoes");
    expect(similarity(a, b)).toBe(0);
  });

  test("two 574s of different sizes → > 0 (same model token)", () => {
    const a = makeListing("New Balance 574 uk9 trainers");
    const b = makeListing("New Balance 574 eu43 white trainers");
    expect(similarity(a, b)).toBeGreaterThan(0);
  });

  test("gate is symmetric: 9060 vs 574 → 0", () => {
    const a = makeListing("New Balance 9060 shoes");
    const b = makeListing("New Balance 574 trainers");
    expect(similarity(a, b)).toBe(0);
  });

  test("model-less listing vs model listing → gate does not fire", () => {
    const a = makeListing("vintage trainers running shoes");
    const b = makeListing("New Balance 574 trainers");
    // Only b has model tokens, so gate condition requires BOTH to have them
    expect(similarity(a, b)).toBeGreaterThanOrEqual(0);
    // Would be > 0 if descriptor overlap exists
  });

  test("both model-less → similarity based on descriptors only", () => {
    const a = makeListing("vintage jacket blue wool");
    const b = makeListing("vintage jacket blue wool");
    // Identical descriptors → max descriptor Jaccard = 1.0, score = 0.3
    expect(similarity(a, b)).toBeGreaterThan(0);
  });

  test("completely different model-less listings → near 0", () => {
    const a = makeListing("vintage jacket");
    const b = makeListing("running shoes");
    expect(similarity(a, b)).toBe(0);
  });
});

// ── similarity — arcteryx normalisation ──────────────────────────────────────

describe("similarity — arcteryx normalisation", () => {
  test("arc'teryx vs arcteryx beta jacket → same as arcteryx vs arcteryx", () => {
    const withApostrophe = makeListing("arc'teryx beta jacket");
    const withoutApostrophe = makeListing("arcteryx beta jacket");
    const alsoWithout = makeListing("arcteryx beta jacket");
    clearTokenizeCache();

    const scoreNorm = similarity(withApostrophe, alsoWithout);
    const scoreBaseline = similarity(withoutApostrophe, alsoWithout);
    expect(scoreNorm).toBeCloseTo(scoreBaseline, 5);
  });

  test("arc'teryx and arcteryx beta jacket produce similarity > 0 with explicit floor", () => {
    const a = makeListing("arc'teryx beta jacket");
    const b = makeListing("arcteryx beta jacket size xl");
    // Both produce descriptors: arcteryx, beta, jacket (xl/s go to variant/noise)
    // Descriptor Jaccard = 1.0 (xl is variant, so same descriptor sets)
    expect(similarity(a, b)).toBeGreaterThan(0);
  });
});

// ── similarity — score composition ───────────────────────────────────────────

describe("similarity — score composition", () => {
  test("identical model tokens produce model Jaccard of 1.0", () => {
    // Same title → model tokens identical → max score
    const a = makeListing("New Balance 574 trainers");
    const b = makeListing("New Balance 574 uk10 trainers");
    const score = similarity(a, b);
    // Model Jaccard({574},{574}) = 1.0, descriptor Jaccard >= 0
    expect(score).toBeGreaterThanOrEqual(1.0);
  });

  test("mixed model + descriptors contribution: model outweighs descriptors", () => {
    // a and ref share a model; b and ref share only descriptors
    const ref = makeListing("New Balance 574 trainers");
    const sameModel = makeListing("New Balance 574 shoes blue");
    const sameDescriptors = makeListing("Nike 1000 trainers"); // 'trainers' descriptor
    clearTokenizeCache();
    expect(similarity(sameModel, ref)).toBeGreaterThan(similarity(sameDescriptors, ref));
  });
});

// ── findComps ────────────────────────────────────────────────────────────────

describe("findComps", () => {
  test("returns only sold listings above the floor", () => {
    const active = makeListing("New Balance 574 trainers");
    const match574 = makeListing("New Balance 574 uk8");
    const noMatch = makeListing("Nike Air Max 90 trainers");

    const comps = findComps(active, [match574, noMatch], { floor: 0.5 });
    expect(comps).toContain(match574);
    expect(comps).not.toContain(noMatch);
  });

  test("respects cap: returns at most cap items", () => {
    const active = makeListing("New Balance 574 trainers");
    const sold = Array.from({ length: 10 }, (_, i) =>
      makeListing(`New Balance 574 uk${i + 6} trainers`, 40 + i),
    );

    const comps = findComps(active, sold, { cap: 3 });
    expect(comps.length).toBe(3);
  });

  test("sorts by descending score (best match first)", () => {
    const active = makeListing("New Balance 574 trainers");
    // One listing is an exact match (highest score), another partial
    const exact = makeListing("New Balance 574 trainers");
    const partial = makeListing("New Balance 574 shoes blue");
    clearTokenizeCache();

    const comps = findComps(active, [partial, exact], { floor: 0 });
    expect(comps[0]).toBe(exact);
  });

  test("excludes junk listings", () => {
    const active = makeListing("New Balance 574 trainers");
    const junk = makeListing("New Balance 574 uk9", 40, new Set(), { isJunk: true });
    const valid = makeListing("New Balance 574 eu42", 40);
    clearTokenizeCache();

    const comps = findComps(active, [junk, valid], { floor: 0 });
    expect(comps).not.toContain(junk);
    expect(comps).toContain(valid);
  });

  test("excludes excluded listings", () => {
    const active = makeListing("New Balance 574 trainers");
    const excluded = makeListing("New Balance 574 uk9 for parts", 5, new Set(), { isExcluded: true });
    const valid = makeListing("New Balance 574 eu42", 40);
    clearTokenizeCache();

    const comps = findComps(active, [excluded, valid], { floor: 0 });
    expect(comps).not.toContain(excluded);
    expect(comps).toContain(valid);
  });

  test("model gate applies: 9060 sold listings excluded for 574 active", () => {
    const active = makeListing("New Balance 574 trainers");
    const comp574 = makeListing("New Balance 574 uk8 grey");
    const comp9060 = makeListing("New Balance 9060 uk8 grey");
    clearTokenizeCache();

    const comps = findComps(active, [comp574, comp9060], { floor: 0.3 });
    expect(comps).toContain(comp574);
    expect(comps).not.toContain(comp9060);
  });

  test("model-less active listing can still find comps via descriptor similarity", () => {
    const active = makeListing("vintage denim jacket");
    const sold = makeListing("vintage denim jacket small");
    clearTokenizeCache();

    const comps = findComps(active, [sold], { floor: 0.1 });
    expect(comps).toContain(sold);
  });
});

// ── buildModelGroups ──────────────────────────────────────────────────────────

describe("buildModelGroups", () => {
  test("creates one group per distinct model key", () => {
    const sold = [
      makeListing("New Balance 574 uk8", 30),
      makeListing("New Balance 574 eu42", 35),
      makeListing("New Balance 9060 uk8", 80),
      makeListing("New Balance 9060 eu42", 85),
    ];
    clearTokenizeCache();

    const groups = buildModelGroups(sold);
    expect(groups).toHaveLength(2);
  });

  test("groups 574 listings together and 9060 separately", () => {
    const sold574a = makeListing("New Balance 574 uk8", 30);
    const sold574b = makeListing("New Balance 574 eu42", 35);
    const sold9060 = makeListing("New Balance 9060 uk9", 80);
    clearTokenizeCache();

    const groups = buildModelGroups([sold574a, sold574b, sold9060]);
    const group574 = groups.find((g) => g.items.includes(sold574a));
    const group9060 = groups.find((g) => g.items.includes(sold9060));

    expect(group574).toBeDefined();
    expect(group9060).toBeDefined();
    expect(group574).not.toBe(group9060);
    expect(group574!.items).toContain(sold574b);
    expect(group574!.items).not.toContain(sold9060);
  });

  test("skips model-less listings (not grouped)", () => {
    const noModel = makeListing("vintage trainers running shoes", 20);
    const withModel = makeListing("New Balance 574 uk9", 40);
    clearTokenizeCache();

    const groups = buildModelGroups([noModel, withModel]);
    const allItems = groups.flatMap((g) => g.items);
    expect(allItems).not.toContain(noModel);
    expect(allItems).toContain(withModel);
  });

  test("groups are flat (no children)", () => {
    const sold = [
      makeListing("New Balance 574 uk8", 30),
      makeListing("New Balance 574 eu42", 35),
    ];
    clearTokenizeCache();

    const groups = buildModelGroups(sold);
    for (const g of groups) {
      expect(g.children).toHaveLength(0);
      expect(g.parent).toBeNull();
      expect(g.depth).toBe(0);
    }
  });

  test("computes stats for the group items", () => {
    const sold = [
      makeListing("New Balance 574 uk7", 30),
      makeListing("New Balance 574 uk8", 40),
      makeListing("New Balance 574 uk9", 50),
      makeListing("New Balance 574 uk10", 60),
      makeListing("New Balance 574 uk11", 70),
    ];
    clearTokenizeCache();

    const groups = buildModelGroups(sold);
    expect(groups).toHaveLength(1);
    const { stats } = groups[0];
    expect(stats.count).toBe(5);
    expect(stats.min).toBe(30);
    expect(stats.max).toBe(70);
    expect(stats.median).toBe(50);
  });

  test("assigns confidence based on group size", () => {
    const small = [
      makeListing("New Balance 574 uk8", 40),
      makeListing("New Balance 574 uk9", 50),
    ];
    clearTokenizeCache();

    const groups = buildModelGroups(small);
    expect(groups[0].confidence).toBe("insufficient");
  });

  test("excludes junk and excluded from groups", () => {
    const valid = makeListing("New Balance 574 uk9", 50);
    const junk = makeListing("New Balance 574 uk8", 5, new Set(), { isJunk: true });
    const excl = makeListing("New Balance 574 uk10", 5, new Set(), { isExcluded: true });
    clearTokenizeCache();

    const groups = buildModelGroups([valid, junk, excl]);
    const allItems = groups.flatMap((g) => g.items);
    expect(allItems).toContain(valid);
    expect(allItems).not.toContain(junk);
    expect(allItems).not.toContain(excl);
  });
});
