import { buildSoldUrl, parseSoldPage, getCached, setCached } from "../soldFetch";
import type { RawListing } from "../types";

// ── chrome.storage.local mock ─────────────────────────────────────────────────

const store: Record<string, unknown> = {};
const chromeMock = {
  storage: {
    local: {
      get: jest.fn(async (key: string) => ({ [key]: store[key] })),
      set: jest.fn(async (obj: Record<string, unknown>) => {
        Object.assign(store, obj);
      }),
    },
  },
};
(globalThis as unknown as Record<string, unknown>).chrome = chromeMock;

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(store).forEach((k) => delete store[k]);
});

// ── buildSoldUrl ──────────────────────────────────────────────────────────────

describe("buildSoldUrl", () => {
  test("builds correct sold URL for page 1", () => {
    const url = buildSoldUrl("https://www.ebay.co.uk", "iphone 16", 1);
    expect(url).toBe(
      "https://www.ebay.co.uk/sch/i.html?_nkw=iphone%2016&LH_Sold=1&LH_Complete=1&_pgn=1",
    );
  });

  test("builds correct sold URL for page 3", () => {
    const url = buildSoldUrl("https://www.ebay.com", "dyson v15", 3);
    expect(url).toBe(
      "https://www.ebay.com/sch/i.html?_nkw=dyson%20v15&LH_Sold=1&LH_Complete=1&_pgn=3",
    );
  });

  test("trims leading/trailing whitespace from search term", () => {
    const url = buildSoldUrl("https://www.ebay.co.uk", "  iphone 16  ", 1);
    expect(url).toContain("_nkw=iphone%2016");
  });

  test("encodes special characters in search term", () => {
    const url = buildSoldUrl("https://www.ebay.co.uk", "apple & co", 1);
    expect(url).toContain("_nkw=apple%20%26%20co");
  });
});

// ── parseSoldPage ─────────────────────────────────────────────────────────────

function makeSoldPageHtml(items: Array<{ title: string; price: string; condition?: string; delivery?: string; link?: string }>): string {
  const cards = items
    .map(
      ({ title, price, condition = "", delivery = "", link = "/itm/123" }) => `
      <li class="s-item">
        <a class="s-item__link" href="${link}">
          <div class="s-item__title">${title}</div>
          <span class="s-item__price">${price}</span>
          ${condition ? `<span class="s-item__subtitle">${condition}</span>` : ""}
          ${delivery ? `<span class="s-item__shipping">${delivery}</span>` : ""}
        </a>
      </li>
    `,
    )
    .join("");
  return `<html><body><ul class="srp-results">${cards}</ul></body></html>`;
}

describe("parseSoldPage", () => {
  test("parses basic listings", () => {
    const html = makeSoldPageHtml([
      { title: "Apple iPhone 16 128GB", price: "£650.00", condition: "Used", link: "/itm/1" },
      { title: "Apple iPhone 16 256GB", price: "£750.00", condition: "New", link: "/itm/2" },
    ]);
    const listings = parseSoldPage(html);
    expect(listings).toHaveLength(2);
    expect(listings[0].title).toBe("Apple iPhone 16 128GB");
    expect(listings[0].priceText).toBe("£650.00");
    expect(listings[0].condition).toBe("Used");
    expect(listings[0].link).toBe("/itm/1");
    expect(listings[1].title).toBe("Apple iPhone 16 256GB");
  });

  test("skips cards without title or price", () => {
    const html = `
      <html><body><ul class="srp-results">
        <li class="s-item"><div class="s-item__title">Has Title</div></li>
        <li class="s-item"><span class="s-item__price">£100</span></li>
        <li class="s-item">
          <div class="s-item__title">Both</div>
          <span class="s-item__price">£200</span>
        </li>
      </ul></body></html>
    `;
    const listings = parseSoldPage(html);
    expect(listings).toHaveLength(1);
    expect(listings[0].title).toBe("Both");
  });

  test("skips pl-on-bottom cards", () => {
    const html = `
      <html><body><ul class="srp-results">
        <li class="s-item s-item__pl-on-bottom">
          <div class="s-item__title">Skip Me</div>
          <span class="s-item__price">£100</span>
        </li>
        <li class="s-item">
          <div class="s-item__title">Keep Me</div>
          <span class="s-item__price">£200</span>
        </li>
      </ul></body></html>
    `;
    const listings = parseSoldPage(html);
    expect(listings).toHaveLength(1);
    expect(listings[0].title).toBe("Keep Me");
  });

  test("captures delivery text", () => {
    const html = makeSoldPageHtml([
      { title: "iPhone 16", price: "£600", delivery: "Free postage" },
    ]);
    const listings = parseSoldPage(html);
    expect(listings[0].deliveryText).toBe("Free postage");
  });

  test("returns empty array for empty HTML", () => {
    expect(parseSoldPage("<html><body></body></html>")).toEqual([]);
  });

  test("returns empty array for malformed HTML", () => {
    expect(parseSoldPage("not html at all")).toEqual([]);
  });
});

// ── cache TTL ─────────────────────────────────────────────────────────────────

describe("getCached / setCached", () => {
  test("returns null when nothing cached", async () => {
    const result = await getCached("iphone 16");
    expect(result).toBeNull();
  });

  test("returns cached listings within TTL", async () => {
    const listings: RawListing[] = [
      { title: "iPhone 16", priceText: "£600", condition: "Used", link: "/itm/1", deliveryText: "" },
    ];
    await setCached("iphone 16", listings);
    const result = await getCached("iphone 16");
    expect(result).toEqual(listings);
  });

  test("normalizes search term for cache key", async () => {
    const listings: RawListing[] = [
      { title: "iPhone 16", priceText: "£600", condition: "Used", link: "/itm/1", deliveryText: "" },
    ];
    await setCached("  iPhone 16  ", listings);
    const result = await getCached("iphone 16");
    expect(result).toEqual(listings);
  });

  test("returns null when cache entry is expired", async () => {
    const listings: RawListing[] = [
      { title: "iPhone 16", priceText: "£600", condition: "Used", link: "/itm/1", deliveryText: "" },
    ];
    // Plant a stale entry directly in the store
    const key = "bb_sold_iphone 16";
    store[key] = { listings, fetchedAt: Date.now() - 25 * 60 * 60 * 1000 };

    const result = await getCached("iphone 16");
    expect(result).toBeNull();
  });

  test("setCached writes to chrome.storage.local", async () => {
    const listings: RawListing[] = [];
    await setCached("dyson v15", listings);
    expect(chromeMock.storage.local.set).toHaveBeenCalledTimes(1);
    const call = chromeMock.storage.local.set.mock.calls[0][0] as Record<string, { listings: RawListing[]; fetchedAt: number }>;
    expect(Object.keys(call)[0]).toBe("bb_sold_dyson v15");
    expect(call["bb_sold_dyson v15"].listings).toEqual(listings);
    expect(typeof call["bb_sold_dyson v15"].fetchedAt).toBe("number");
  });
});
