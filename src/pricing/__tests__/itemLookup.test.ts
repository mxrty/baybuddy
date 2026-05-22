import { analyseItemLookup } from "../index";
import type { RawListing } from "../types";

function listing(
  title: string,
  priceText: string,
  condition = "Used",
  link = "/itm/1",
): RawListing {
  return { title, priceText, condition, link, deliveryText: "" };
}

describe("analyseItemLookup", () => {
  test("aggregates valid sold comps into a price distribution", () => {
    const comps: RawListing[] = [
      listing("Apple iPhone 16 128GB", "£600"),
      listing("Apple iPhone 16 128GB", "£700"),
      listing("Apple iPhone 16 128GB", "£800"),
    ];
    const result = analyseItemLookup(comps);
    expect(result.totalComps).toBe(3);
    expect(result.stats.count).toBe(3);
    expect(result.stats.median).toBe(700);
    expect(result.stats.min).toBe(600);
    expect(result.stats.max).toBe(800);
    expect(result.examples).toHaveLength(3);
  });

  test("filters excluded (for-parts) and zero-price comps", () => {
    const comps: RawListing[] = [
      listing("Apple iPhone 16 128GB", "£600"),
      listing("Apple iPhone 16 128GB for parts not working", "£200"),
      listing("Apple iPhone 16 128GB", "£700"),
      listing("Apple iPhone 16 128GB", "no price"),
    ];
    const result = analyseItemLookup(comps);
    expect(result.totalComps).toBe(2);
    expect(result.stats.count).toBe(2);
    expect(result.stats.median).toBe(650);
  });

  test("caps examples at 6", () => {
    const comps: RawListing[] = Array.from({ length: 10 }, (_, i) =>
      listing(`Apple iPhone 16 128GB unit ${i}`, `£${600 + i}`),
    );
    const result = analyseItemLookup(comps);
    expect(result.totalComps).toBe(10);
    expect(result.examples).toHaveLength(6);
  });

  test("returns empty stats when no valid comps", () => {
    const result = analyseItemLookup([]);
    expect(result.totalComps).toBe(0);
    expect(result.stats.count).toBe(0);
    expect(result.examples).toHaveLength(0);
  });
});
