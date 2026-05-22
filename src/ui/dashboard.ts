import { detectCurrency } from "../utils";
import type { PricingResult, PricingGroup, ListingAssessment } from "../pricing/types";

function fmtPrice(amount: number, currency: string): string {
  return `${currency}${amount.toFixed(2)}`;
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "● High confidence",
  medium: "● Med confidence",
  low: "● Low confidence",
  insufficient: "● Insufficient data",
};

const CONFIDENCE_COLOR: Record<string, string> = {
  high: "#5cb85c",
  medium: "#f0ad4e",
  low: "#f0ad4e",
  insufficient: "#aaa",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isPageViewingSold(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get("LH_Sold") === "1" && params.get("LH_Complete") === "1";
}

// ── Card finding + highlighting ─────────────────────────────

function findCardByListing(link: string, title: string): Element | null {
  // Match by URL pathname — eBay item paths are stable, query params are not
  try {
    const targetPath = new URL(link).pathname;
    const cards = document.querySelectorAll<Element>(
      "li.s-card, li.s-item, [data-viewport]",
    );
    for (const card of Array.from(cards)) {
      const a = card.querySelector<HTMLAnchorElement>(
        "a.s-item__link, a.s-card__link",
      );
      if (a) {
        try {
          if (new URL(a.href).pathname === targetPath) return card;
        } catch {}
      }
    }
  } catch {}

  // Fallback: title text prefix match
  const normTitle = title.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 50);
  const cards = document.querySelectorAll<Element>(
    "li.s-card, li.s-item, [data-viewport]",
  );
  for (const card of Array.from(cards)) {
    const titleEl = card.querySelector(".s-item__title, .s-card__title");
    const cardTitle =
      titleEl?.textContent?.toLowerCase().replace(/\s+/g, " ").trim() ?? "";
    if (normTitle && cardTitle.includes(normTitle.slice(0, 40))) return card;
  }
  return null;
}

function scrollToAndHighlight(cards: Element[]): void {
  if (cards.length === 0) return;
  cards[0].scrollIntoView({ behavior: "smooth", block: "center" });
  for (const card of cards) {
    const el = card as HTMLElement;
    el.style.outline = "3px solid #3665f3";
    el.style.borderRadius = "4px";
    setTimeout(() => {
      el.style.outline = "";
      el.style.borderRadius = "";
    }, 2000);
  }
}

// Collect {link, title} from all leaf items in a group hierarchy
function collectLeafItems(
  group: PricingGroup,
): { link: string; title: string }[] {
  if (group.children.length === 0) {
    return group.items
      .slice(0, 20)
      .map((i) => ({ link: i.link, title: i.title }));
  }
  const all: { link: string; title: string }[] = [];
  for (const child of group.children) {
    all.push(...collectLeafItems(child));
    if (all.length >= 20) break;
  }
  return all.slice(0, 20);
}

// ── Top deals section ───────────────────────────────────────

function renderTopDeals(
  assessments: ListingAssessment[],
  currency: string,
): string {
  const deals = assessments
    .filter(
      (a) =>
        a.showBadge &&
        a.rating === "good" &&
        a.matchedGroup !== null &&
        a.matchedGroup.stats.median > 0,
    )
    .map((a) => {
      const discountPct =
        ((a.matchedGroup!.stats.median - a.listing.totalPrice) /
          a.matchedGroup!.stats.median) *
        100;
      return { a, discountPct };
    })
    .sort((x, y) => y.discountPct - x.discountPct)
    .slice(0, 5);

  if (deals.length === 0) return "";

  const rows = deals
    .map(({ a, discountPct }) => {
      const titleText = a.listing.title;
      const titleDisplay =
        escapeHtml(titleText.substring(0, 55)) +
        (titleText.length > 55 ? "&hellip;" : "");
      const price = fmtPrice(a.listing.totalPrice, currency);
      const discount = discountPct.toFixed(0);
      return (
        `<div data-bb-link="${escapeHtml(a.listing.link)}" ` +
        `data-bb-title="${escapeHtml(titleText)}" ` +
        `style="display:flex;align-items:center;gap:6px;padding:5px 0;` +
        `border-bottom:1px solid rgba(0,0,0,0.05);cursor:pointer;" ` +
        `title="Click to scroll to this listing">` +
        `<span style="font-size:10px;font-weight:700;color:#5cb85c;` +
        `background:rgba(92,184,92,0.12);padding:1px 5px;border-radius:3px;` +
        `white-space:nowrap;">-${discount}%</span>` +
        `<span style="font-size:11px;flex:1;min-width:0;overflow:hidden;` +
        `text-overflow:ellipsis;white-space:nowrap;color:#161822;">${titleDisplay}</span>` +
        `<span style="font-size:11px;font-weight:600;color:#3665f3;` +
        `white-space:nowrap;">${price}</span>` +
        `</div>`
      );
    })
    .join("");

  return (
    `<div style="margin-bottom:12px;padding-bottom:4px;` +
    `border-bottom:1px solid rgba(0,0,0,0.08);">` +
    `<div style="font-size:11px;font-weight:700;color:#161822;` +
    `margin-bottom:6px;letter-spacing:0.3px;text-transform:uppercase;">` +
    `&#x1F3C6; Top Deals</div>` +
    rows +
    `</div>`
  );
}

// ── Group cards ─────────────────────────────────────────────

function renderGroupCard(
  group: PricingGroup,
  currency: string,
  depth: number,
): string {
  const isInsufficient = group.confidence === "insufficient";
  const opacity = isInsufficient ? "0.55" : "1";
  const indentPx = depth * 12;
  const confColor = CONFIDENCE_COLOR[group.confidence] ?? "#aaa";
  const confLabel = CONFIDENCE_LABEL[group.confidence] ?? "";

  const medianStr = fmtPrice(group.stats.median, currency);
  const minStr = fmtPrice(group.stats.min, currency);
  const maxStr = fmtPrice(group.stats.max, currency);

  // Encode leaf item links/titles for click-to-scroll
  const leafItems = collectLeafItems(group);
  const itemsAttr = escapeHtml(JSON.stringify(leafItems));

  let bodyHtml: string;

  if (group.children.length > 0) {
    bodyHtml =
      `<div style="padding-left:${indentPx + 8}px;margin-top:6px;">` +
      group.children
        .map((c) => renderGroupCard(c, currency, depth + 1))
        .join("") +
      "</div>";
  } else {
    const items = group.items.map((item) => {
      const href = escapeHtml(item.link || "#");
      const title =
        escapeHtml(item.title.substring(0, 60)) +
        (item.title.length > 60 ? "&hellip;" : "");
      const price = fmtPrice(item.totalPrice, currency);
      return (
        `<li style="margin:2px 0;">` +
        `<a href="${href}" target="_blank" rel="noopener" ` +
        `style="color:#3665f3;text-decoration:none;font-size:11px;">` +
        `${title} &mdash; ${price}` +
        `</a></li>`
      );
    });
    bodyHtml =
      `<ul style="margin:6px 0 0;padding-left:${indentPx + 16}px;color:#575b6e;">` +
      items.join("") +
      "</ul>";
  }

  return (
    `<details data-bb-items="${itemsAttr}" ` +
    `style="margin-top:8px;padding:8px;background:rgba(0,0,0,0.02);` +
    `border-radius:4px;opacity:${opacity};">` +
    `<summary style="cursor:pointer;list-style:none;display:flex;align-items:center;` +
    `gap:8px;padding-left:${indentPx}px;">` +
    `<strong style="font-size:12px;">${escapeHtml(group.label)}</strong>` +
    `<span style="font-size:11px;color:#575b6e;">` +
    `${group.stats.count} items &middot; median ${medianStr} &middot; ${minStr}&ndash;${maxStr}` +
    `</span>` +
    `<span style="font-size:10px;color:${confColor};margin-left:auto;">${confLabel}</span>` +
    `</summary>` +
    bodyHtml +
    `</details>`
  );
}

// ── Event listener wiring ───────────────────────────────────

function attachScrollListeners(panel: HTMLElement): void {
  // Top-deal rows → scroll to matching card
  panel.querySelectorAll<HTMLElement>("[data-bb-link]").forEach((el) => {
    el.addEventListener("click", () => {
      const link = el.dataset.bbLink ?? "";
      const title = el.dataset.bbTitle ?? "";
      const card = findCardByListing(link, title);
      if (card) scrollToAndHighlight([card]);
    });
  });

  // Group <details> → scroll to member cards on open
  panel
    .querySelectorAll<HTMLDetailsElement>("details[data-bb-items]")
    .forEach((el) => {
      el.addEventListener("toggle", () => {
        if (!el.open) return;
        let items: { link: string; title: string }[] = [];
        try {
          items = JSON.parse(el.dataset.bbItems ?? "[]");
        } catch {}
        const found: Element[] = [];
        for (const { link, title } of items) {
          const card = findCardByListing(link, title);
          if (card) found.push(card);
        }
        scrollToAndHighlight(found);
      });
    });
}

// ── Main entry point ────────────────────────────────────────

export function renderDashboard(
  result: PricingResult,
  root: HTMLElement,
): void {
  const currency = detectCurrency(window.location.host);
  const { rootGroups, summary, assessments } = result;

  let panel = document.getElementById("bb-overview-panel");
  let needsAppend = false;

  if (!panel) {
    panel = document.createElement("div");
    panel.id = "bb-overview-panel";
    panel.style.cssText =
      "position:fixed;right:16px;top:88px;width:320px;z-index:9999;" +
      "font-family:'Inter',-apple-system,sans-serif;color:#161822;";
    needsAppend = true;
  }

  if (rootGroups.length === 0) {
    panel.remove();
    return;
  }

  // rootGroups are already sorted by relevanceScore desc, count desc (done in analysePricing)
  const groupsHtml = rootGroups
    .map((g) => renderGroupCard(g, currency, 0))
    .join("");

  const rangeStr =
    summary.overallPriceRange.max > 0
      ? `${fmtPrice(summary.overallPriceRange.min, currency)}&ndash;${fmtPrice(summary.overallPriceRange.max, currency)}`
      : "n/a";

  // Only show top deals on active (non-sold) pages
  const topDealsHtml = isPageViewingSold()
    ? ""
    : renderTopDeals(assessments, currency);

  panel.innerHTML =
    `<details style="background:#fff;border:1px solid rgba(54,101,243,0.2);` +
    `border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.12);">` +
    `<summary style="padding:12px 16px;display:flex;align-items:center;` +
    `justify-content:space-between;cursor:pointer;list-style:none;` +
    `background:rgba(54,101,243,0.05);border-radius:8px;">` +
    `<div style="display:flex;align-items:center;gap:8px;">` +
    `<span style="font-size:16px;">&#x1F4CA;</span>` +
    `<span style="font-size:13px;font-weight:600;">Price Intelligence</span>` +
    `<span style="font-size:12px;color:#575b6e;">` +
    `${summary.totalListingsAnalysed} items &middot; ${summary.totalGroups} groups` +
    `</span></div>` +
    `<div style="display:flex;gap:16px;font-size:13px;align-items:center;">` +
    `<span style="color:#575b6e;">Range: <strong style="color:#3665f3;">${rangeStr}</strong></span>` +
    `<span style="color:#3665f3;font-size:10px;">&#x25BC;</span>` +
    `</div></summary>` +
    `<div style="padding:0 16px 16px;font-size:12px;` +
    `max-height:calc(100vh - 160px);overflow-y:auto;">` +
    topDealsHtml +
    groupsHtml +
    `</div>` +
    `</details>`;

  attachScrollListeners(panel);

  if (needsAppend) {
    document.body.appendChild(panel);
  }

  void root; // root param kept for API compatibility
}
