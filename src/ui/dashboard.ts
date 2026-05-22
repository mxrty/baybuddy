import { detectCurrency } from "../utils";
import type { PricingResult, PricingGroup, ListingAssessment, GroupStatistics } from "../pricing/types";

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

const CONF_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
  insufficient: 3,
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

// ── Module-level sort/filter state ───────────────────────────

let _lastResult: PricingResult | null = null;
let _currentCurrency = "";
type SortKey = "confidence" | "count" | "median";
let _sort: SortKey = "confidence";
let _hideInsufficient = false;

function sortedFilteredGroups(groups: PricingGroup[]): PricingGroup[] {
  let out = _hideInsufficient
    ? groups.filter((g) => g.confidence !== "insufficient")
    : [...groups];
  if (_sort === "count") {
    out.sort((a, b) => b.stats.count - a.stats.count);
  } else if (_sort === "median") {
    out.sort((a, b) => a.stats.median - b.stats.median); // asc: cheapest first
  } else {
    out.sort(
      (a, b) => (CONF_ORDER[a.confidence] ?? 3) - (CONF_ORDER[b.confidence] ?? 3),
    );
  }
  return out;
}

// ── Card finding + highlighting ─────────────────────────────

function findCardByListing(link: string, title: string): Element | null {
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

// ── Box-plot ─────────────────────────────────────────────────

function renderBoxPlot(stats: GroupStatistics, currency: string): string {
  const { min, max, p25, median, p75 } = stats;

  if (max <= min || stats.count < 2) {
    return (
      `<div style="font-size:10px;color:#888;margin-top:4px;">` +
      `${fmtPrice(median, currency)}` +
      `</div>`
    );
  }

  const range = max - min;
  const pct = (v: number) =>
    `${Math.max(0, Math.min(100, ((v - min) / range) * 100)).toFixed(1)}%`;

  const p25pct = pct(p25);
  const medpct = pct(median);
  const p75pct = pct(p75);
  const boxWidth = `${Math.max(2, Math.min(100, ((p75 - p25) / range) * 100)).toFixed(1)}%`;

  return (
    `<div style="margin-top:6px;">` +
    // Bar track
    `<div style="position:relative;height:12px;margin:0 2px;">` +
    `<div style="position:absolute;top:5px;left:0;right:0;height:2px;` +
    `background:rgba(0,0,0,0.1);border-radius:1px;"></div>` +
    // Left whisker (min → p25)
    `<div style="position:absolute;top:5px;left:0;width:${p25pct};height:2px;background:#bbb;"></div>` +
    // IQR box (p25 → p75)
    `<div style="position:absolute;top:2px;left:${p25pct};width:${boxWidth};height:8px;` +
    `background:rgba(54,101,243,0.2);border:1px solid rgba(54,101,243,0.45);border-radius:2px;"></div>` +
    // Median tick
    `<div style="position:absolute;top:1px;left:${medpct};width:2px;height:10px;` +
    `background:#3665f3;border-radius:1px;transform:translateX(-1px);"></div>` +
    // Right whisker (p75 → max)
    `<div style="position:absolute;top:5px;left:${p75pct};right:0;height:2px;background:#bbb;"></div>` +
    `</div>` +
    // Price labels: min — median — max
    `<div style="display:flex;justify-content:space-between;font-size:9px;` +
    `color:#888;margin-top:2px;padding:0 2px;">` +
    `<span>${fmtPrice(min, currency)}</span>` +
    `<span style="color:#3665f3;font-weight:600;">${fmtPrice(median, currency)}</span>` +
    `<span>${fmtPrice(max, currency)}</span>` +
    `</div>` +
    `</div>`
  );
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

// ── Sort/filter controls ─────────────────────────────────────

function renderControls(): string {
  const btnBase =
    `display:inline-flex;align-items:center;padding:2px 7px;border-radius:3px;` +
    `font-size:10px;font-weight:600;cursor:pointer;border:1px solid rgba(54,101,243,0.3);` +
    `background:transparent;color:#3665f3;`;
  const btnActive =
    `background:rgba(54,101,243,0.12);border-color:#3665f3;color:#3665f3;`;

  const sortButtons: { key: SortKey; label: string }[] = [
    { key: "confidence", label: "Confidence" },
    { key: "count", label: "Count" },
    { key: "median", label: "Median" },
  ];

  const sortHtml = sortButtons
    .map(({ key, label }) => {
      const active = _sort === key ? btnActive : "";
      return (
        `<button data-bb-sort="${key}" style="${btnBase}${active}">${label}</button>`
      );
    })
    .join("");

  const filterActive = _hideInsufficient ? btnActive : "";
  const filterHtml =
    `<button data-bb-filter="insufficient" style="${btnBase}${filterActive}">` +
    `Hide insufficient</button>`;

  return (
    `<div id="bb-controls" style="display:flex;flex-wrap:wrap;gap:4px;` +
    `margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(0,0,0,0.07);">` +
    `<span style="font-size:10px;color:#888;align-self:center;margin-right:2px;">Sort:</span>` +
    sortHtml +
    `<span style="margin-left:auto;">` +
    filterHtml +
    `</span>` +
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
    `<summary style="cursor:pointer;list-style:none;display:flex;flex-direction:column;` +
    `gap:2px;padding-left:${indentPx}px;">` +
    `<div style="display:flex;align-items:center;gap:8px;">` +
    `<strong style="font-size:12px;">${escapeHtml(group.label)}</strong>` +
    `<span style="font-size:11px;color:#575b6e;">${group.stats.count} items</span>` +
    `<span style="font-size:10px;color:${confColor};margin-left:auto;">${confLabel}</span>` +
    `</div>` +
    renderBoxPlot(group.stats, currency) +
    `</summary>` +
    bodyHtml +
    `</details>`
  );
}

// ── Groups list HTML (respects current sort/filter) ──────────

function renderGroupsListHtml(rootGroups: PricingGroup[], currency: string): string {
  const groups = sortedFilteredGroups(rootGroups);
  if (groups.length === 0) {
    return `<div style="font-size:11px;color:#888;padding:8px 0;">No groups to show.</div>`;
  }
  return groups.map((g) => renderGroupCard(g, currency, 0)).join("");
}

// ── Event listener wiring ───────────────────────────────────

function attachGroupToggleListeners(container: HTMLElement): void {
  container
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

function attachScrollListeners(panel: HTMLElement): void {
  panel.querySelectorAll<HTMLElement>("[data-bb-link]").forEach((el) => {
    el.addEventListener("click", () => {
      const link = el.dataset.bbLink ?? "";
      const title = el.dataset.bbTitle ?? "";
      const card = findCardByListing(link, title);
      if (card) scrollToAndHighlight([card]);
    });
  });

  const groupsList = panel.querySelector<HTMLElement>("#bb-groups-list");
  if (groupsList) attachGroupToggleListeners(groupsList);
}

function attachControlListeners(panel: HTMLElement): void {
  panel.querySelectorAll<HTMLButtonElement>("[data-bb-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      _sort = (btn.dataset.bbSort ?? "confidence") as SortKey;
      rebuildGroupsSection(panel);
    });
  });

  const filterBtn = panel.querySelector<HTMLButtonElement>("[data-bb-filter='insufficient']");
  if (filterBtn) {
    filterBtn.addEventListener("click", () => {
      _hideInsufficient = !_hideInsufficient;
      rebuildGroupsSection(panel);
    });
  }
}

function rebuildGroupsSection(panel: HTMLElement): void {
  if (!_lastResult) return;

  // Update controls HTML (reflects new active state)
  const controlsEl = panel.querySelector<HTMLElement>("#bb-controls");
  if (controlsEl) {
    const tmp = document.createElement("div");
    tmp.innerHTML = renderControls();
    const newControls = tmp.firstElementChild as HTMLElement | null;
    if (newControls) {
      controlsEl.replaceWith(newControls);
      attachControlListeners(panel);
    }
  }

  // Update groups list
  const listEl = panel.querySelector<HTMLElement>("#bb-groups-list");
  if (listEl) {
    listEl.innerHTML = renderGroupsListHtml(_lastResult.rootGroups, _currentCurrency);
    attachGroupToggleListeners(listEl);
  }
}

// ── Main entry point ────────────────────────────────────────

export function renderDashboard(
  result: PricingResult,
  root: HTMLElement,
): void {
  const currency = detectCurrency(window.location.host);

  // Stash for controls re-render
  _lastResult = result;
  _currentCurrency = currency;

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

  const rangeStr =
    summary.overallPriceRange.max > 0
      ? `${fmtPrice(summary.overallPriceRange.min, currency)}&ndash;${fmtPrice(summary.overallPriceRange.max, currency)}`
      : "n/a";

  const topDealsHtml = isPageViewingSold()
    ? ""
    : renderTopDeals(assessments, currency);

  const groupsListHtml = renderGroupsListHtml(rootGroups, currency);

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
    renderControls() +
    `<div id="bb-groups-list">` +
    groupsListHtml +
    `</div>` +
    `</div>` +
    `</details>`;

  attachScrollListeners(panel);
  attachControlListeners(panel);

  if (needsAppend) {
    document.body.appendChild(panel);
  }

  void root;
}
