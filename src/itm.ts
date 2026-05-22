/**
 * BayBuddy — Item detail page content script (/itm/*)
 * Fetches sold comps for the current listing and shows a price badge.
 */

import { detectCurrency } from "./utils";
import { initDebug } from "./debug";
import { isExcluded, isMultiVariant, cleanTitle } from "./pricing/parse";
import { analysePricingVsSold } from "./pricing/index";
import { fetchSoldListings } from "./pricing/soldFetch";
import { createBadgeElement } from "./ui/badge";
import type { RawListing } from "./pricing/types";

// Multiple candidates per field; first non-empty wins.
const TITLE_SELECTORS = [
  "h1.x-item-title__mainTitle span.ux-textspans",
  "h1.x-item-title__mainTitle",
  "#itemTitle span",
  "#itemTitle",
  "h1[itemprop='name']",
];

const PRICE_SELECTORS = [
  ".x-price-primary",
  "#prcIsum",
  "#mm-saleDscPrc",
  "[itemprop='price']",
];

const CONDITION_SELECTORS = [
  "[data-testid='x-item-condition-value'] .ux-textspans",
  ".vim.d-vim-condition .condText",
  ".condText",
  "#vi-itm-cond",
  ".ux-labels-values__values .ux-textspans",
];

const DELIVERY_SELECTORS = [
  "[data-testid='x-shipping-section'] .ux-textspans",
  ".vim.d-shipping-section .ux-textspans",
  "#fshippingCost",
  "#shSummary",
];

function getFirstText(selectors: string[]): string {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  return "";
}

function scrapeItem(): RawListing | null {
  const rawTitle = getFirstText(TITLE_SELECTORS);
  if (!rawTitle) return null;

  const priceText = getFirstText(PRICE_SELECTORS);
  if (!priceText) return null;

  const condition = getFirstText(CONDITION_SELECTORS);
  const deliveryText = getFirstText(DELIVERY_SELECTORS);

  return {
    title: rawTitle,
    priceText,
    condition,
    deliveryText,
    link: window.location.href,
  };
}

function findPriceElement(): Element | null {
  for (const sel of PRICE_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

async function run(): Promise<void> {
  const settings = await new Promise<{ priceBadges: boolean; debugMode: boolean }>(
    (resolve) => {
      chrome.storage.sync.get(
        { priceBadges: true, debugMode: false },
        (s) => resolve(s as { priceBadges: boolean; debugMode: boolean }),
      );
    },
  );
  initDebug(settings.debugMode);

  if (!settings.priceBadges) return;

  const raw = scrapeItem();
  if (!raw) {
    console.log("[BayBuddy] itm: could not scrape item details");
    return;
  }

  // Respect A1/A2 exclusions: no badge on for-parts or multi-variant pages
  if (isExcluded(raw) || isMultiVariant(raw)) {
    console.log("[BayBuddy] itm: item excluded (for-parts or multi-variant)");
    return;
  }

  const priceEl = findPriceElement();
  if (!priceEl) return;

  const searchTerm = cleanTitle(raw.title);
  console.log(`[BayBuddy] itm: fetching sold comps for "${searchTerm}"`);

  let soldListings: RawListing[];
  try {
    soldListings = await fetchSoldListings(searchTerm, {
      origin: window.location.origin,
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
    `[BayBuddy] itm: rating=${assessment.rating} matchedGroup=${assessment.matchedGroup?.label ?? "none"}`,
  );

  const currency = detectCurrency(window.location.host);
  const badge = createBadgeElement(assessment, currency);
  if (!badge) return;

  // Insert the badge immediately after the price container
  badge.style.cssText =
    badge.style.cssText + "display:block;margin-top:8px;margin-left:0;";
  priceEl.insertAdjacentElement("afterend", badge);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", run);
} else {
  run();
}
