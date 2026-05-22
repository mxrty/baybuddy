import { detectCurrency } from "../utils";
import type {
  PricingResult,
  ListingAssessment,
  PriceRating,
} from "../pricing/types";

function fmtPrice(amount: number, currency: string): string {
  return `${currency}${amount.toFixed(2)}`;
}

const BADGE_STYLE: Record<
  Exclude<PriceRating, "no-data">,
  { bg: string; color: string; label: string }
> = {
  good: {
    bg: "rgba(92, 184, 92, 0.1)",
    color: "#5cb85c",
    label: "🟢 Good deal",
  },
  fair: { bg: "rgba(240, 173, 78, 0.1)", color: "#f0ad4e", label: "🟡 Fair" },
  high: {
    bg: "rgba(217, 83, 79, 0.1)",
    color: "#d9534f",
    label: "🔴 Above market",
  },
};

function injectBadge(
  card: Element,
  assessment: ListingAssessment,
  currency: string,
): void {
  if (!assessment.showBadge || assessment.rating === "no-data") return;

  const style =
    BADGE_STYLE[assessment.rating as Exclude<PriceRating, "no-data">];
  const { listing, matchedGroup } = assessment;

  let container = card.querySelector(
    ".bb-badge-container",
  ) as HTMLElement | null;
  let needsAppend = false;

  if (!container) {
    container = document.createElement("details");
    container.className = "bb-badge-container";
    container.style.cssText =
      "display:inline-block;position:relative;margin-left:8px;";

    const summary = document.createElement("summary");
    summary.className = "bb-price-badge";
    summary.style.cssText =
      "display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:500;" +
      "padding:2px 6px;border-radius:4px;font-family:'Inter',-apple-system,sans-serif;" +
      "cursor:pointer;list-style:none;";

    const dropdown = document.createElement("div");
    dropdown.className = "bb-badge-dropdown";
    dropdown.style.cssText =
      "display:block;margin-top:8px;font-size:11px;color:#575b6e;background:#fff;" +
      "border:1px solid #ccc;padding:8px;border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,0.1);" +
      "width:max-content;max-width:300px;white-space:normal;";

    container.appendChild(summary);
    container.appendChild(dropdown);
    needsAppend = true;
  }

  const badge = container.querySelector(".bb-price-badge") as HTMLElement;
  const dropdown = container.querySelector(".bb-badge-dropdown") as HTMLElement;

  const totalStr = fmtPrice(listing.totalPrice, currency);
  const postageNote =
    listing.postage > 0
      ? ` (${fmtPrice(listing.itemPrice, currency)} + ${fmtPrice(listing.postage, currency)} p&p)`
      : " (free postage)";

  badge.style.background = style.bg;
  badge.style.color = style.color;
  badge.innerHTML = style.label;
  badge.title = `Total: ${totalStr}${postageNote}`;

  if (matchedGroup) {
    const g = matchedGroup;
    const medianStr = fmtPrice(g.stats.median, currency);
    const p25Str = fmtPrice(g.stats.p25, currency);
    const p75Str = fmtPrice(g.stats.p75, currency);
    dropdown.innerHTML =
      `<strong>${g.label}</strong><br>` +
      `${g.stats.count} comparable sales &middot; median ${medianStr}<br>` +
      `Typical range: ${p25Str}&ndash;${p75Str}<br>` +
      `<em style="color:#999;">Your total: ${totalStr}${postageNote}</em>`;
  } else {
    dropdown.style.display = "none";
    badge.style.cursor = "default";
  }

  if (needsAppend) {
    const priceContainer = card.querySelector(".s-item__price, .s-card__price");
    if (priceContainer) priceContainer.appendChild(container);
  }
}

export function clearBadges(root: HTMLElement): void {
  root.querySelectorAll(".bb-badge-container").forEach((el) => el.remove());
}

export function renderBadges(result: PricingResult, root: HTMLElement): void {
  const currency = detectCurrency(window.location.host);

  const byLink = new Map<string, ListingAssessment>();
  for (const a of result.assessments) {
    if (a.listing.link) byLink.set(a.listing.link, a);
  }

  const cards = root.querySelectorAll(
    "li.s-card, .s-card, li.s-item, .srp-results .s-item",
  );
  for (const card of cards) {
    const linkEl = card.querySelector(
      "a.s-item__link, a.s-card__link",
    ) as HTMLAnchorElement | null;
    if (!linkEl) continue;
    const href = linkEl.getAttribute("href") || linkEl.href || "";
    const assessment = byLink.get(href);
    if (assessment) injectBadge(card, assessment, currency);
  }
}
