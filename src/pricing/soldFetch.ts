import type { RawListing } from "./types";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_DELAY_MS = 400;
const PAGES_TO_FETCH = 5;

interface CacheEntry {
  listings: RawListing[];
  fetchedAt: number;
}

export function buildSoldUrl(
  origin: string,
  searchTerm: string,
  page: number,
): string {
  const encoded = encodeURIComponent(searchTerm.trim());
  return `${origin}/sch/i.html?_nkw=${encoded}&LH_Sold=1&LH_Complete=1&_pgn=${page}`;
}

function cacheKey(searchTerm: string): string {
  return `bb_sold_${searchTerm.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

export async function getCached(
  searchTerm: string,
): Promise<RawListing[] | null> {
  const key = cacheKey(searchTerm);
  try {
    const result = await chrome.storage.local.get(key);
    const entry = result[key] as CacheEntry | undefined;
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
    return entry.listings;
  } catch {
    return null;
  }
}

export async function setCached(
  searchTerm: string,
  listings: RawListing[],
): Promise<void> {
  const key = cacheKey(searchTerm);
  const entry: CacheEntry = { listings, fetchedAt: Date.now() };
  try {
    await chrome.storage.local.set({ [key]: entry });
  } catch {
    // storage unavailable
  }
}

const CONDITION_SELECTORS = [
  ".s-item__subtitle",
  ".s-item__secondary-info",
  ".SECONDARY_INFO",
  ".s-card__subtitle",
  ".s-item__condition",
  ".s-card__attribute-row",
];

const DELIVERY_SELECTORS = [
  ".s-card__shipping",
  ".s-card__delivery",
  ".s-item__shipping",
  ".s-item__localDelivery",
  ".s-item__delivery",
];

export function parseSoldPage(html: string): RawListing[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const cardSelectors = [
    "li.s-card",
    ".s-card",
    "li.s-item",
    ".srp-results .s-item",
    "ul.srp-results > li",
  ];

  let cards: NodeListOf<Element> | Element[] = [];
  for (const sel of cardSelectors) {
    const found = doc.querySelectorAll(sel);
    if (found.length > 0) {
      cards = found;
      break;
    }
  }

  const results: RawListing[] = [];

  cards.forEach((card) => {
    if (
      card.classList.contains("s-item__pl-on-bottom") ||
      card.classList.contains("s-card__pl-on-bottom")
    )
      return;

    const titleEl = card.querySelector(".s-item__title, .s-card__title");
    const priceEl = card.querySelector(".s-item__price, .s-card__price");
    if (!titleEl || !priceEl) return;

    const conditionText = CONDITION_SELECTORS.flatMap((sel) =>
      Array.from(card.querySelectorAll(sel)),
    )
      .map((el) => el.textContent || "")
      .join(" ")
      .trim();

    const deliveryText =
      DELIVERY_SELECTORS.map(
        (sel) => card.querySelector(sel)?.textContent || "",
      ).find((t) => t.length > 0) ?? "";

    const linkEl = card.querySelector(
      "a.s-item__link, a.s-card__link",
    ) as HTMLAnchorElement | null;

    results.push({
      title: titleEl.textContent || "",
      priceText: priceEl.textContent || "",
      condition: conditionText,
      link: linkEl?.getAttribute("href") || "",
      deliveryText,
    });
  });

  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FetchSoldOptions {
  origin?: string;
  skipPage1?: boolean;
}

export async function fetchSoldListings(
  searchTerm: string,
  opts: FetchSoldOptions = {},
): Promise<RawListing[]> {
  const cached = await getCached(searchTerm);
  if (cached) return cached;

  const origin = opts.origin ?? window.location.origin;
  const startPage = opts.skipPage1 ? 2 : 1;
  const results: RawListing[] = [];

  for (let page = startPage; page <= PAGES_TO_FETCH; page++) {
    if (page > startPage) await sleep(FETCH_DELAY_MS);

    const url = buildSoldUrl(origin, searchTerm, page);
    try {
      const response = await fetch(url, {
        credentials: "same-origin",
        headers: { Accept: "text/html" },
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
    `[BayBuddy] soldFetch: fetched ${results.length} sold listings for "${searchTerm}"`,
  );

  return results;
}
