/**
 * BayBuddy — Content Script
 */

import { Settings } from "./utils";

(function () {
  "use strict";

  // ── Constants ───────────────────────────────────────────
  const HIDDEN_ATTR = "data-bb-hidden";
  const BB_APPLIED = "data-bb-applied"; // sessionStorage key for redirect guard

  // ── Collection-only detection patterns ──────────────────
  const COLLECTION_PATTERNS = [
    /collection\s*(only|in\s*person)?/i,
    /collect\s*in\s*person/i,
    /local\s*pick\s*up/i,
    /pickup\s*only/i,
  ];

  const POSTAGE_PATTERNS = [
    /\+\s*[£$€]\s*[\d.]+\s*(postage|delivery|p&p)/i,
    /free\s*(postage|delivery|p&p|shipping)/i,
    /[£$€]\s*[\d.]+\s*delivery/i,
    /fast\s*&?\s*free/i,
    /estimated\s*delivery/i,
    /royal\s*mail/i,
    /hermes/i,
    /evri/i,
    /dpd/i,
    /yodel/i,
    /parcelforce/i,
    /usps/i,
    /fedex/i,
    /ups\b/i,
    /australia\s*post/i,
    /canada\s*post/i,
  ];

  // ══════════════════════════════════════════════════════════
  // FEATURE 1: Hide Collection Only
  // ══════════════════════════════════════════════════════════

  function getListingCards() {
    // eBay uses .s-card (new) or .s-item (legacy) for listing cards
    const selectors = [
      "li.s-card",
      ".s-card",
      "li.s-item",
      ".srp-results .s-item",
      "ul.srp-results > li",
      "[data-viewport]",
    ];

    for (const sel of selectors) {
      const cards = document.querySelectorAll(sel);
      if (cards.length > 0) return cards;
    }

    return [];
  }

  function getDeliveryText(card: Element) {
    // Try both new (.s-card__) and legacy (.s-item__) selectors
    const deliverySelectors = [
      ".s-card__shipping",
      ".s-card__delivery",
      ".s-item__shipping",
      ".s-item__localDelivery",
      ".s-item__delivery",
      ".s-item__freeXDays",
      ".s-item__dynamic",
      '[class*="shipping"]',
      '[class*="delivery"]',
      '[class*="logistic"]',
      '[class*="Delivery"]',
      '[class*="Shipping"]',
    ];

    let deliveryText = "";

    for (const sel of deliverySelectors) {
      const els = card.querySelectorAll(sel);
      els.forEach((el) => {
        deliveryText += " " + el.textContent;
      });
    }

    // Fallback: scan all spans for delivery-related keywords
    if (deliveryText.trim().length === 0) {
      const allSpans = card.querySelectorAll(
        "span, .s-item__detail, .s-card__detail",
      );
      allSpans.forEach((el) => {
        const text = el.textContent.trim().toLowerCase();
        if (
          text.includes("collect") ||
          text.includes("delivery") ||
          text.includes("postage") ||
          text.includes("shipping") ||
          text.includes("p&p")
        ) {
          deliveryText += " " + el.textContent;
        }
      });
    }

    return deliveryText;
  }

  function isCollectionOnly(card: Element) {
    const text = getDeliveryText(card);
    if (!text.trim()) return false;

    const hasCollection = COLLECTION_PATTERNS.some((p) => p.test(text));
    if (!hasCollection) return false;

    const hasPostage = POSTAGE_PATTERNS.some((p) => p.test(text));
    return !hasPostage;
  }

  function processCard(card: Element) {
    if (card.hasAttribute(HIDDEN_ATTR)) return;
    if (
      card.classList &&
      (card.classList.contains("s-item__pl-on-bottom") ||
        card.classList.contains("s-card__pl-on-bottom"))
    )
      return;

    if (isCollectionOnly(card)) {
      (card as HTMLElement).style.display = "none";
      card.setAttribute(HIDDEN_ATTR, "true");
    }
  }

  function renderCollectionHiddenPill(hiddenCount: number, totalCount: number) {
    const PILL_ID = "bb-collection-hidden-pill";
    let pill = document.getElementById(PILL_ID);

    if (hiddenCount === 0) {
      pill?.remove();
      return;
    }

    const allHidden = hiddenCount === totalCount && totalCount > 0;
    const text = allHidden
      ? `All ${totalCount} listing${totalCount !== 1 ? "s" : ""} hidden (collection only)`
      : `${hiddenCount} collection-only listing${hiddenCount !== 1 ? "s" : ""} hidden`;

    if (!pill) {
      pill = document.createElement("div");
      pill.id = PILL_ID;
      pill.style.cssText = [
        "display:inline-block",
        "margin:8px 4px",
        "padding:4px 10px",
        "background:#f5f5f5",
        "border:1px solid #ddd",
        "border-radius:12px",
        "font-size:12px",
        "color:#666",
        "font-family:sans-serif",
      ].join(";");

      const container = document.querySelector(
        ".srp-results, #srp-river-results, .srp-river-main",
      );
      if (container) container.insertBefore(pill, container.firstChild);
    }

    pill.textContent = text;
  }

  function processAllCards() {
    const cards = getListingCards();
    cards.forEach(processCard);

    const realCards = Array.from(cards).filter(
      (card) =>
        !card.classList?.contains("s-item__pl-on-bottom") &&
        !card.classList?.contains("s-card__pl-on-bottom"),
    );
    const hiddenCount = realCards.filter((card) =>
      card.hasAttribute(HIDDEN_ATTR),
    ).length;
    renderCollectionHiddenPill(hiddenCount, realCards.length);
  }

  // ══════════════════════════════════════════════════════════
  // FEATURE 2: Hide International
  // ══════════════════════════════════════════════════════════

  function applyLocalItemsOnly() {
    const url = new URL(window.location.href);

    // Already has the param — nothing to do
    if (url.searchParams.get("LH_PrefLoc") === "1") return;

    // Guard: don't redirect if we just applied it
    const guardKey = "bb_localApplied_" + url.searchParams.get("_nkw");
    if (sessionStorage.getItem(guardKey)) {
      sessionStorage.removeItem(guardKey);
      return;
    }

    // Set the param and redirect
    url.searchParams.set("LH_PrefLoc", "1");
    sessionStorage.setItem(guardKey, "1");
    window.location.replace(url.toString());
  }

  // ══════════════════════════════════════════════════════════
  // FEATURE 3: Search Sold Listings (Overlay Button)
  // ══════════════════════════════════════════════════════════

  function isViewingSold() {
    const url = new URL(window.location.href);
    return (
      url.searchParams.get("LH_Sold") === "1" &&
      url.searchParams.get("LH_Complete") === "1"
    );
  }

  function createSoldButton() {
    // Don't create if already exists
    if (document.getElementById("bb-sold-btn")) return;

    const viewing = isViewingSold();

    const btn = document.createElement("button");
    btn.id = "bb-sold-btn";
    btn.innerHTML = viewing
      ? "← Back to Active Listings"
      : "🔍 Search Sold Listings";

    // Styles
    Object.assign(btn.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      zIndex: "99999",
      padding: "12px 20px",
      border: "none",
      borderRadius: "50px",
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      fontSize: "13px",
      fontWeight: "600",
      cursor: "pointer",
      boxShadow: viewing
        ? "0 4px 20px rgba(92, 184, 92, 0.4)"
        : "0 4px 20px rgba(54, 101, 243, 0.4)",
      background: viewing
        ? "linear-gradient(135deg, #5cb85c, #4cae4c)"
        : "linear-gradient(135deg, #3665f3, #4f7af8)",
      color: "white",
      transition: "all 150ms cubic-bezier(0.4, 0, 0.2, 1)",
      letterSpacing: "-0.2px",
    });

    btn.addEventListener("mouseenter", () => {
      btn.style.transform = "translateY(-2px) scale(1.02)";
      btn.style.boxShadow = viewing
        ? "0 6px 28px rgba(92, 184, 92, 0.5)"
        : "0 6px 28px rgba(54, 101, 243, 0.5)";
    });

    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "translateY(0) scale(1)";
      btn.style.boxShadow = viewing
        ? "0 4px 20px rgba(92, 184, 92, 0.4)"
        : "0 4px 20px rgba(54, 101, 243, 0.4)";
    });

    btn.addEventListener("click", () => {
      const url = new URL(window.location.href);
      if (viewing) {
        url.searchParams.delete("LH_Sold");
        url.searchParams.delete("LH_Complete");
      } else {
        url.searchParams.set("LH_Sold", "1");
        url.searchParams.set("LH_Complete", "1");
      }
      window.location.href = url.toString();
    });

    document.body.appendChild(btn);
  }

  // ══════════════════════════════════════════════════════════
  // MAIN — Initialisation
  // ══════════════════════════════════════════════════════════

  function init() {
    const defaultSettings = {
      hideCollectionOnly: true,
      localItemsOnly: true,
    };

    chrome.storage.sync.get(defaultSettings, function (settings: Settings) {
      // Feature 2: Hide International (may redirect — run early)
      if (settings.localItemsOnly) {
        applyLocalItemsOnly();
      }

      // Feature 1: Hide Collection Only (re-run as eBay lazy-loads more cards)
      if (settings.hideCollectionOnly) {
        processAllCards();

        const resultsContainer =
          document.querySelector(".srp-results") ||
          document.querySelector("#srp-river-results") ||
          document.querySelector(".srp-river-main") ||
          document.querySelector('[id*="ResultSet"]') ||
          document.body;

        const observer = new MutationObserver((mutations) => {
          let hasNewNodes = false;
          for (const mutation of mutations) {
            for (const node of Array.from(mutation.addedNodes)) {
              const el =
                node.nodeType === 1
                  ? (node as Element)
                  : (node.parentNode as Element);
              // Ignore our own hidden-count pill to avoid re-trigger loops
              if (el && el.closest && el.closest("#bb-collection-hidden-pill")) {
                continue;
              }
              hasNewNodes = true;
            }
            if (hasNewNodes) break;
          }
          if (hasNewNodes) {
            processAllCards();
          }
        });

        observer.observe(resultsContainer, {
          childList: true,
          subtree: true,
        });
      }

      // Feature 3: Sold Listings overlay button (always visible on search pages)
      createSoldButton();
    });
  }

  // Wait for DOM if needed
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
