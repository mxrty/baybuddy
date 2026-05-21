"use strict";
(() => {
  // src/utils.ts
  function detectCurrency(host) {
    if (host.includes("ebay.co.uk")) return "\xA3";
    if (host.includes("ebay.com.au")) return "AU $";
    if (host.includes("ebay.ca")) return "C $";
    if (host.includes("ebay.de") || host.includes("ebay.fr") || host.includes("ebay.it") || host.includes("ebay.es") || host.includes("ebay.ie") || host.includes("ebay.nl") || host.includes("ebay.at")) return "\u20AC";
    return "$";
  }
  function parsePriceText(text) {
    let cleaned = text.replace(/[£$€,]/g, "").replace(/AU\s*/i, "").replace(/US\s*/i, "").replace(/C\s*/i, "").trim();
    if (cleaned.includes(" to ")) {
      const parts = cleaned.split(" to ");
      const low = parseFloat(parts[0].trim());
      const high = parseFloat(parts[1].trim());
      if (!isNaN(low) && !isNaN(high)) return (low + high) / 2;
    }
    const val = parseFloat(cleaned);
    return isNaN(val) ? null : val;
  }
  function tokenizeTitle(title) {
    let cleaned = title.toLowerCase().replace(/[^a-z0-9\s]/g, "");
    let tokens = cleaned.split(/\s+/);
    const noise = ["free", "postage", "fast", "delivery", "brand", "new", "sealed", "controller", "bundle", "black", "white", "box", "unboxed", "mint", "condition", "excellent", "good", "used", "uk"];
    return new Set(tokens.filter((t) => t.length > 1 && !noise.includes(t)));
  }
  function jaccardSimilarity(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 1;
    let intersection = 0;
    for (let item of setA) {
      if (setB.has(item)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return intersection / union;
  }
  function clusterListings(listings, confidenceThreshold) {
    const threshold = confidenceThreshold / 100;
    const clusters = [];
    for (const item of listings) {
      let bestCluster = null;
      let bestScore = -1;
      for (const cluster of clusters) {
        const score = jaccardSimilarity(item.tokens, cluster.items[0].tokens);
        if (score > bestScore) {
          bestScore = score;
          bestCluster = cluster;
        }
      }
      if (bestScore >= threshold && bestCluster) {
        bestCluster.items.push(item);
      } else {
        clusters.push({ items: [item] });
      }
    }
    return clusters;
  }
  function calculateGroupStats(items, excludeBroken) {
    const validItems = items.filter((item) => {
      if (item.price === null || isNaN(item.price)) return false;
      if (excludeBroken) {
        const cond = item.condition;
        if (cond.includes("parts") || cond.includes("repair") || cond.includes("faulty") || cond.includes("broken")) {
          return false;
        }
      }
      return true;
    });
    if (validItems.length < 2) return null;
    const prices = validItems.map((i) => i.price);
    const sum = prices.reduce((a, b) => a + b, 0);
    const mean = sum / prices.length;
    const sqDiffs = prices.map((p) => Math.pow(p - mean, 2));
    const avgSqDiff = sqDiffs.reduce((a, b) => a + b, 0) / prices.length;
    const stdDev = Math.sqrt(avgSqDiff);
    return { mean, stdDev, validItems };
  }

  // src/content.ts
  (function() {
    "use strict";
    const HIDDEN_ATTR = "data-bb-hidden";
    const BB_APPLIED = "data-bb-applied";
    const COLLECTION_PATTERNS = [
      /collection\s*(only|in\s*person)?/i,
      /collect\s*in\s*person/i,
      /local\s*pick\s*up/i,
      /pickup\s*only/i
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
      /canada\s*post/i
    ];
    const NON_STICKY_PARAMS = /* @__PURE__ */ new Set([
      "_nkw",
      "_pgn",
      "_skc",
      "_sop",
      "_sacat",
      "_dmd",
      "_ipg",
      "_fosrp",
      "_fcid",
      "_localstpos",
      "LH_Complete",
      "LH_Sold",
      "LH_PrefLoc",
      "_trksid",
      "hash",
      "rt",
      "_from"
    ]);
    function getListingCards() {
      const selectors = [
        "li.s-card",
        ".s-card",
        "li.s-item",
        ".srp-results .s-item",
        "ul.srp-results > li",
        "[data-viewport]"
      ];
      for (const sel of selectors) {
        const cards = document.querySelectorAll(sel);
        if (cards.length > 0) return cards;
      }
      return [];
    }
    function getDeliveryText(card) {
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
        '[class*="Shipping"]'
      ];
      let deliveryText = "";
      for (const sel of deliverySelectors) {
        const els = card.querySelectorAll(sel);
        els.forEach((el) => {
          deliveryText += " " + el.textContent;
        });
      }
      if (deliveryText.trim().length === 0) {
        const allSpans = card.querySelectorAll("span, .s-item__detail, .s-card__detail");
        allSpans.forEach((el) => {
          const text = el.textContent.trim().toLowerCase();
          if (text.includes("collect") || text.includes("delivery") || text.includes("postage") || text.includes("shipping") || text.includes("p&p")) {
            deliveryText += " " + el.textContent;
          }
        });
      }
      return deliveryText;
    }
    function isCollectionOnly(card) {
      const text = getDeliveryText(card);
      if (!text.trim()) return false;
      const hasCollection = COLLECTION_PATTERNS.some((p) => p.test(text));
      if (!hasCollection) return false;
      const hasPostage = POSTAGE_PATTERNS.some((p) => p.test(text));
      return !hasPostage;
    }
    function processCard(card) {
      if (card.hasAttribute(HIDDEN_ATTR)) return;
      if (card.classList && (card.classList.contains("s-item__pl-on-bottom") || card.classList.contains("s-card__pl-on-bottom"))) return;
      if (isCollectionOnly(card)) {
        card.style.display = "none";
        card.setAttribute(HIDDEN_ATTR, "true");
      }
    }
    function processAllCards() {
      const cards = getListingCards();
      cards.forEach(processCard);
    }
    function applyLocalItemsOnly() {
      const url = new URL(window.location.href);
      if (url.searchParams.get("LH_PrefLoc") === "1") return;
      const guardKey = "bb_localApplied_" + url.searchParams.get("_nkw");
      if (sessionStorage.getItem(guardKey)) {
        sessionStorage.removeItem(guardKey);
        return;
      }
      url.searchParams.set("LH_PrefLoc", "1");
      sessionStorage.setItem(guardKey, "1");
      window.location.replace(url.toString());
    }
    function isViewingSold() {
      const url = new URL(window.location.href);
      return url.searchParams.get("LH_Sold") === "1" && url.searchParams.get("LH_Complete") === "1";
    }
    function createSoldButton() {
      if (document.getElementById("bb-sold-btn")) return;
      const viewing = isViewingSold();
      const btn = document.createElement("button");
      btn.id = "bb-sold-btn";
      btn.innerHTML = viewing ? "\u2190 Back to Active Listings" : "\u{1F50D} Search Sold Listings";
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
        boxShadow: viewing ? "0 4px 20px rgba(92, 184, 92, 0.4)" : "0 4px 20px rgba(54, 101, 243, 0.4)",
        background: viewing ? "linear-gradient(135deg, #5cb85c, #4cae4c)" : "linear-gradient(135deg, #3665f3, #4f7af8)",
        color: "white",
        transition: "all 150ms cubic-bezier(0.4, 0, 0.2, 1)",
        letterSpacing: "-0.2px"
      });
      btn.addEventListener("mouseenter", () => {
        btn.style.transform = "translateY(-2px) scale(1.02)";
        btn.style.boxShadow = viewing ? "0 6px 28px rgba(92, 184, 92, 0.5)" : "0 6px 28px rgba(54, 101, 243, 0.5)";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.transform = "translateY(0) scale(1)";
        btn.style.boxShadow = viewing ? "0 4px 20px rgba(92, 184, 92, 0.4)" : "0 4px 20px rgba(54, 101, 243, 0.4)";
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
    function formatPrice(value, currency) {
      return currency + value.toFixed(2);
    }
    function createOverviewPanel(stats, clusters, currency, settings) {
      let panel = document.getElementById("bb-overview-panel");
      let needsAppend = false;
      if (!panel) {
        panel = document.createElement("div");
        panel.id = "bb-overview-panel";
        needsAppend = true;
      }
      if (!stats) {
        if (panel.parentNode) panel.remove();
        return;
      }
      let groupingsHtml = "";
      clusters.forEach((c, i) => {
        const cStats = calculateGroupStats(c.items, settings.excludeBroken);
        if (cStats) {
          groupingsHtml += `
          <div style="margin-top: 8px; padding: 8px; background: rgba(0,0,0,0.03); border-radius: 4px;">
            <strong>Group ${i + 1}</strong> (${cStats.validItems.length} items) - Avg: ${formatPrice(cStats.mean, currency)}
            <ul style="margin: 4px 0 0; padding-left: 20px; color: #575b6e;">
              ${cStats.validItems.map((item) => {
            const linkEl = item.card.querySelector("a.s-item__link, a.s-card__link");
            let href = "#";
            if (linkEl) {
              href = linkEl.getAttribute("href") || linkEl.href || "#";
              if (href !== "#" && !href.startsWith("http")) {
                href = window.location.origin + (href.startsWith("/") ? "" : "/") + href;
              }
            }
            return `<li><a href="${href}" target="_blank" style="color:inherit; text-decoration:none;">${item.title.substring(0, 50)}... (${formatPrice(item.price, currency)})</a></li>`;
          }).join("")}
            </ul>
          </div>
        `;
        }
      });
      const html = `
      <details style="
        margin: 16px auto;
        background: rgba(54, 101, 243, 0.05);
        border: 1px solid rgba(54, 101, 243, 0.2);
        border-radius: 8px;
        font-family: 'Inter', -apple-system, sans-serif;
        color: #e8eaf0;
      ">
        <summary style="padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:16px;">\u{1F4CA}</span>
            <span style="font-size:13px; font-weight:600; color: #161822;">Price Intelligence</span>
            <span style="font-size:12px; color:#575b6e; margin-left:4px;">${stats.validItems.length} valid items in ${clusters.length} groups</span>
          </div>
          <div style="display:flex; gap:16px; font-size:13px; align-items: center;">
            <div><span style="color:#575b6e;">Overall Avg:</span> <strong style="color:#3665f3;">${formatPrice(stats.mean, currency)}</strong></div>
            <span style="color: #3665f3; font-size: 10px;">\u25BC</span>
          </div>
        </summary>
        <div style="padding: 0 16px 16px; color: #161822; font-size: 12px;">
          ${groupingsHtml}
        </div>
      </details>
    `;
      if (panel.innerHTML !== html) {
        panel.innerHTML = html;
      }
      if (needsAppend) {
        const resultsContainer = document.querySelector(".srp-results") || document.querySelector("#srp-river-results") || document.querySelector('[id*="ResultSet"]') || document.querySelector(".srp-river-main");
        if (resultsContainer && resultsContainer.parentNode) {
          resultsContainer.parentNode.insertBefore(panel, resultsContainer);
        } else {
          const main = document.querySelector("#mainContent") || document.querySelector("#srp-river") || document.body;
          main.insertBefore(panel, main.firstChild);
        }
      }
    }
    function getListingData(card) {
      if (card.classList && (card.classList.contains("s-item__pl-on-bottom") || card.classList.contains("s-card__pl-on-bottom"))) return null;
      const titleEl = card.querySelector(".s-item__title, .s-card__title");
      const priceEl = card.querySelector(".s-item__price, .s-card__price");
      const subtitleEl = card.querySelector(".s-item__subtitle, .s-item__secondary-info, .SECONDARY_INFO, .s-card__subtitle, .s-item__condition");
      if (!titleEl || !priceEl) return null;
      const title = titleEl.textContent || "";
      const price = parsePriceText(priceEl.textContent || "");
      const condition = subtitleEl && subtitleEl.textContent ? subtitleEl.textContent.toLowerCase() : "";
      return { card, title, price, condition, tokens: tokenizeTitle(title) };
    }
    function injectBadge(item, badgeData, currency, clusterStats) {
      if (!item.card) return;
      let badgeContainer = item.card.querySelector(".bb-badge-container");
      let needsAppend = false;
      if (!badgeContainer) {
        badgeContainer = document.createElement("details");
        badgeContainer.className = "bb-badge-container";
        badgeContainer.style.cssText = `
        display: inline-block;
        position: relative;
        margin-left: 8px;
      `;
        const summary = document.createElement("summary");
        summary.className = "bb-price-badge";
        summary.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        font-weight: 500;
        padding: 2px 6px;
        border-radius: 4px;
        font-family: 'Inter', -apple-system, sans-serif;
        cursor: pointer;
        list-style: none;
      `;
        const dropdown2 = document.createElement("div");
        dropdown2.className = "bb-badge-dropdown";
        dropdown2.style.cssText = `
        display: block;
        margin-top: 8px;
        font-size: 11px;
        color: #575b6e;
        background: #fff;
        border: 1px solid #ccc;
        padding: 8px;
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        width: max-content;
        max-width: 300px;
        white-space: normal;
      `;
        badgeContainer.appendChild(summary);
        badgeContainer.appendChild(dropdown2);
        needsAppend = true;
      }
      const badge = badgeContainer.querySelector(".bb-price-badge");
      const dropdown = badgeContainer.querySelector(".bb-badge-dropdown");
      let targetBg, targetColor, targetHtml;
      if (badgeData.type === "excluded") {
        targetBg = "rgba(139, 143, 163, 0.1)";
        targetColor = "#8b8fa3";
        targetHtml = `\u26AA Excluded (parts)`;
      } else {
        const avgStr = currency + badgeData.mean.toFixed(2);
        if (badgeData.type === "good") {
          targetBg = "rgba(92, 184, 92, 0.1)";
          targetColor = "#5cb85c";
          targetHtml = `\u{1F7E2} Good (avg ${avgStr})`;
        } else if (badgeData.type === "fair") {
          targetBg = "rgba(240, 173, 78, 0.1)";
          targetColor = "#f0ad4e";
          targetHtml = `\u{1F7E1} Fair (avg ${avgStr})`;
        } else if (badgeData.type === "high") {
          targetBg = "rgba(217, 83, 79, 0.1)";
          targetColor = "#d9534f";
          targetHtml = `\u{1F534} Above avg (avg ${avgStr})`;
        }
      }
      if (badge.innerHTML !== targetHtml) {
        badge.style.background = targetBg;
        badge.style.color = targetColor;
        badge.innerHTML = targetHtml;
      }
      if (clusterStats) {
        const otherItems = clusterStats.validItems.filter((i) => i.card !== item.card);
        dropdown.innerHTML = `
        <strong>Comparable items:</strong>
        <ul style="margin: 4px 0 0; padding-left: 16px;">
          ${otherItems.map((i) => {
          const linkEl = i.card.querySelector("a.s-item__link, a.s-card__link");
          let href = "#";
          if (linkEl) {
            href = linkEl.getAttribute("href") || linkEl.href || "#";
            if (href !== "#" && !href.startsWith("http")) {
              href = window.location.origin + (href.startsWith("/") ? "" : "/") + href;
            }
          }
          return `<li><a href="${href}" target="_blank" style="color:inherit; text-decoration:none;">${i.title.substring(0, 40)}... (${formatPrice(i.price, currency)})</a></li>`;
        }).join("")}
        </ul>
      `;
        if (otherItems.length === 0) {
          dropdown.innerHTML = `<em>No other comparable items</em>`;
        }
      } else {
        dropdown.style.display = "none";
        badge.style.cursor = "default";
      }
      if (needsAppend) {
        const priceContainer = item.card.querySelector(".s-item__price, .s-card__price");
        if (priceContainer) {
          priceContainer.appendChild(badgeContainer);
        }
      }
    }
    let fetchSoldPromise = null;
    let isApplyingPriceIntelligence = false;
    async function applyPriceIntelligence(settings, retryCount = 0) {
      if (isApplyingPriceIntelligence) return;
      isApplyingPriceIntelligence = true;
      try {
        const cards = getListingCards();
        if (cards.length === 0 && retryCount < 5) {
          isApplyingPriceIntelligence = false;
          setTimeout(() => applyPriceIntelligence(settings, retryCount + 1), 500);
          return;
        }
        const currency = detectCurrency(window.location.host);
        const activeListings = [];
        cards.forEach((c) => {
          const data = getListingData(c);
          if (data) activeListings.push(data);
        });
        let referenceListings = [];
        if (isViewingSold()) {
          referenceListings = activeListings;
        } else {
          if (!fetchSoldPromise) {
            fetchSoldPromise = (async () => {
              try {
                const url = new URL(window.location.href);
                url.searchParams.set("LH_Sold", "1");
                url.searchParams.set("LH_Complete", "1");
                const response = await fetch(url.toString());
                const text = await response.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(text, "text/html");
                const selectors = [
                  "li.s-card",
                  ".s-card",
                  "li.s-item",
                  ".srp-results .s-item",
                  "ul.srp-results > li",
                  "[data-viewport]"
                ];
                let soldCards = [];
                for (const sel of selectors) {
                  const found = doc.querySelectorAll(sel);
                  if (found.length > 0) {
                    soldCards = Array.from(found);
                    break;
                  }
                }
                const items = [];
                soldCards.forEach((c) => {
                  const data = getListingData(c);
                  if (data) items.push(data);
                });
                return items;
              } catch (e) {
                console.error("BayBuddy: Failed to fetch sold listings", e);
                return activeListings;
              }
            })();
          }
          referenceListings = await fetchSoldPromise;
          if (referenceListings.length === 0) {
            referenceListings = activeListings;
          }
        }
        const clusters = clusterListings(referenceListings, settings.confidenceThreshold);
        const overallStats = calculateGroupStats(referenceListings, settings.excludeBroken);
        createOverviewPanel(overallStats, clusters, currency, settings);
        for (const cluster of clusters) {
        }
        for (const item of activeListings) {
          if (!item.price) continue;
          let isBroken = false;
          if (settings.excludeBroken) {
            const cond = item.condition;
            if (cond.includes("parts") || cond.includes("repair") || cond.includes("faulty") || cond.includes("broken")) {
              isBroken = true;
            }
          }
          if (isBroken) {
            injectBadge(item, { type: "excluded" }, currency);
            continue;
          }
          let bestCluster = null;
          let bestScore = -1;
          const threshold = settings.confidenceThreshold / 100;
          for (const cluster of clusters) {
            const score = jaccardSimilarity(item.tokens, cluster.items[0].tokens);
            if (score > bestScore) {
              bestScore = score;
              bestCluster = cluster;
            }
          }
          if (bestScore >= threshold && bestCluster) {
            const stats = calculateGroupStats(bestCluster.items, settings.excludeBroken);
            if (stats) {
              const diff = item.price - stats.mean;
              if (diff < -0.5 * stats.stdDev) {
                injectBadge(item, { type: "good", mean: stats.mean }, currency, stats);
              } else if (diff > 0.5 * stats.stdDev) {
                injectBadge(item, { type: "high", mean: stats.mean }, currency, stats);
              } else {
              }
            }
          }
        }
      } finally {
        isApplyingPriceIntelligence = false;
      }
    }
    const STICKY_STORAGE_KEY = "bb_stickyParams";
    function getCurrentFilterParams() {
      const url = new URL(window.location.href);
      const params = {};
      url.searchParams.forEach((value, key) => {
        if (!NON_STICKY_PARAMS.has(key)) {
          params[key] = value;
        }
      });
      return params;
    }
    function saveStickyParams(params) {
      try {
        sessionStorage.setItem(STICKY_STORAGE_KEY, JSON.stringify(params));
      } catch (e) {
      }
    }
    function loadStickyParams() {
      try {
        const raw = sessionStorage.getItem(STICKY_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    }
    function applyStickyFilters() {
      const saved = loadStickyParams();
      if (!saved || Object.keys(saved).length === 0) {
        saveStickyParams(getCurrentFilterParams());
        return;
      }
      const url = new URL(window.location.href);
      let changed = false;
      Object.entries(saved).forEach(([key, value]) => {
        if (!url.searchParams.has(key)) {
          url.searchParams.set(key, value);
          changed = true;
        }
      });
      saveStickyParams(getCurrentFilterParams());
      if (changed) {
        const guardKey = "bb_stickyApplied";
        if (sessionStorage.getItem(guardKey)) {
          sessionStorage.removeItem(guardKey);
          return;
        }
        sessionStorage.setItem(guardKey, "1");
        window.location.replace(url.toString());
      }
    }
    function init() {
      const defaultSettings = {
        hideCollectionOnly: true,
        localItemsOnly: true,
        priceBadges: true,
        excludeBroken: true,
        stickyFilters: false,
        confidenceThreshold: 70
      };
      chrome.storage.sync.get(defaultSettings, function(settings) {
        if (settings.stickyFilters) {
          applyStickyFilters();
        }
        if (settings.localItemsOnly) {
          applyLocalItemsOnly();
        }
        if (settings.hideCollectionOnly || settings.priceBadges) {
          if (settings.hideCollectionOnly) processAllCards();
          if (settings.priceBadges) applyPriceIntelligence(settings);
          const resultsContainer = document.querySelector(".srp-results") || document.querySelector("#srp-river-results") || document.querySelector(".srp-river-main") || document.querySelector('[id*="ResultSet"]') || document.body;
          const observer = new MutationObserver((mutations) => {
            let hasNewNodes = false;
            for (const mutation of mutations) {
              for (const node of Array.from(mutation.addedNodes)) {
                const el = node.nodeType === 1 ? node : node.parentNode;
                if (el && el.closest && el.closest("#bb-overview-panel, .bb-badge-container, .bb-price-badge")) {
                  continue;
                }
                hasNewNodes = true;
              }
              if (hasNewNodes) break;
            }
            if (hasNewNodes) {
              if (settings.hideCollectionOnly) processAllCards();
              if (settings.priceBadges) applyPriceIntelligence(settings);
            }
          });
          observer.observe(resultsContainer, {
            childList: true,
            subtree: true
          });
        }
        createSoldButton();
      });
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  })();
})();
