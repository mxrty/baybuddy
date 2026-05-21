/**
 * BayBuddy — Content Script
 */

import {
  detectCurrency,
  parsePriceText,
  tokenizeTitle,
  jaccardSimilarity,
  clusterListings,
  calculateGroupStats,
  ListingItem
} from './utils';

(function () {
  'use strict';

  // ── Constants ───────────────────────────────────────────
  const HIDDEN_ATTR = 'data-bb-hidden';
  const BB_APPLIED  = 'data-bb-applied'; // sessionStorage key for redirect guard

  // ── Collection-only detection patterns ──────────────────
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

  // ── Params that should NOT stick ────────────────────────
  const NON_STICKY_PARAMS = new Set([
    '_nkw', '_pgn', '_skc', '_sop', '_sacat',
    '_dmd', '_ipg', '_fosrp', '_fcid', '_localstpos',
    'LH_Complete', 'LH_Sold', 'LH_PrefLoc',
    '_trksid', 'hash', 'rt', '_from'
  ]);

  // ══════════════════════════════════════════════════════════
  // FEATURE 1: Hide Collection Only
  // ══════════════════════════════════════════════════════════

  function getListingCards() {
    // eBay uses .s-card (new) or .s-item (legacy) for listing cards
    const selectors = [
      'li.s-card',
      '.s-card',
      'li.s-item',
      '.srp-results .s-item',
      'ul.srp-results > li',
      '[data-viewport]'
    ];

    for (const sel of selectors) {
      const cards = document.querySelectorAll(sel);
      if (cards.length > 0) return cards;
    }

    return [];
  }

  function getDeliveryText(card) {
    // Try both new (.s-card__) and legacy (.s-item__) selectors
    const deliverySelectors = [
      '.s-card__shipping',
      '.s-card__delivery',
      '.s-item__shipping',
      '.s-item__localDelivery',
      '.s-item__delivery',
      '.s-item__freeXDays',
      '.s-item__dynamic',
      '[class*="shipping"]',
      '[class*="delivery"]',
      '[class*="logistic"]',
      '[class*="Delivery"]',
      '[class*="Shipping"]'
    ];

    let deliveryText = '';

    for (const sel of deliverySelectors) {
      const els = card.querySelectorAll(sel);
      els.forEach(el => {
        deliveryText += ' ' + el.textContent;
      });
    }

    // Fallback: scan all spans for delivery-related keywords
    if (deliveryText.trim().length === 0) {
      const allSpans = card.querySelectorAll('span, .s-item__detail, .s-card__detail');
      allSpans.forEach(el => {
        const text = el.textContent.trim().toLowerCase();
        if (
          text.includes('collect') ||
          text.includes('delivery') ||
          text.includes('postage') ||
          text.includes('shipping') ||
          text.includes('p&p')
        ) {
          deliveryText += ' ' + el.textContent;
        }
      });
    }

    return deliveryText;
  }

  function isCollectionOnly(card) {
    const text = getDeliveryText(card);
    if (!text.trim()) return false;

    const hasCollection = COLLECTION_PATTERNS.some(p => p.test(text));
    if (!hasCollection) return false;

    const hasPostage = POSTAGE_PATTERNS.some(p => p.test(text));
    return !hasPostage;
  }

  function processCard(card: Element) {
    if (card.hasAttribute(HIDDEN_ATTR)) return;
    if (card.classList && (card.classList.contains('s-item__pl-on-bottom') || card.classList.contains('s-card__pl-on-bottom'))) return;

    if (isCollectionOnly(card)) {
      (card as HTMLElement).style.display = 'none';
      card.setAttribute(HIDDEN_ATTR, 'true');
    }
  }

  function processAllCards() {
    const cards = getListingCards();
    cards.forEach(processCard);
  }

  // ══════════════════════════════════════════════════════════
  // FEATURE 2: Local Items Only
  // ══════════════════════════════════════════════════════════

  function applyLocalItemsOnly() {
    const url = new URL(window.location.href);

    // Already has the param — nothing to do
    if (url.searchParams.get('LH_PrefLoc') === '1') return;

    // Guard: don't redirect if we just applied it
    const guardKey = 'bb_localApplied_' + url.searchParams.get('_nkw');
    if (sessionStorage.getItem(guardKey)) {
      sessionStorage.removeItem(guardKey);
      return;
    }

    // Set the param and redirect
    url.searchParams.set('LH_PrefLoc', '1');
    sessionStorage.setItem(guardKey, '1');
    window.location.replace(url.toString());
  }

  // ══════════════════════════════════════════════════════════
  // FEATURE 3: Search Sold Listings (Overlay Button)
  // ══════════════════════════════════════════════════════════

  function isViewingSold() {
    const url = new URL(window.location.href);
    return url.searchParams.get('LH_Sold') === '1' &&
           url.searchParams.get('LH_Complete') === '1';
  }

  function createSoldButton() {
    // Don't create if already exists
    if (document.getElementById('bb-sold-btn')) return;

    const viewing = isViewingSold();

    const btn = document.createElement('button');
    btn.id = 'bb-sold-btn';
    btn.innerHTML = viewing
      ? '← Back to Active Listings'
      : '🔍 Search Sold Listings';

    // Styles
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: '99999',
      padding: '12px 20px',
      border: 'none',
      borderRadius: '50px',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      boxShadow: viewing
        ? '0 4px 20px rgba(92, 184, 92, 0.4)'
        : '0 4px 20px rgba(54, 101, 243, 0.4)',
      background: viewing
        ? 'linear-gradient(135deg, #5cb85c, #4cae4c)'
        : 'linear-gradient(135deg, #3665f3, #4f7af8)',
      color: 'white',
      transition: 'all 150ms cubic-bezier(0.4, 0, 0.2, 1)',
      letterSpacing: '-0.2px'
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'translateY(-2px) scale(1.02)';
      btn.style.boxShadow = viewing
        ? '0 6px 28px rgba(92, 184, 92, 0.5)'
        : '0 6px 28px rgba(54, 101, 243, 0.5)';
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'translateY(0) scale(1)';
      btn.style.boxShadow = viewing
        ? '0 4px 20px rgba(92, 184, 92, 0.4)'
        : '0 4px 20px rgba(54, 101, 243, 0.4)';
    });

    btn.addEventListener('click', () => {
      const url = new URL(window.location.href);
      if (viewing) {
        url.searchParams.delete('LH_Sold');
        url.searchParams.delete('LH_Complete');
      } else {
        url.searchParams.set('LH_Sold', '1');
        url.searchParams.set('LH_Complete', '1');
      }
      window.location.href = url.toString();
    });

    document.body.appendChild(btn);
  }

  // ══════════════════════════════════════════════════════════
  // FEATURE 4: Price Intelligence Badges
  // ══════════════════════════════════════════════════════════

  function formatPrice(value: number, currency: string): string {
    return currency + value.toFixed(2);
  }

  function createOverviewPanel(stats: any, groupCount: number, currency: string) {
    let panel = document.getElementById('bb-overview-panel');
    let needsAppend = false;

    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'bb-overview-panel';
      needsAppend = true;
    }

    if (!stats) {
      if (panel.parentNode) panel.remove();
      return;
    }

    const html = `
      <div style="
        margin: 16px auto;
        padding: 12px 16px;
        background: rgba(54, 101, 243, 0.05);
        border: 1px solid rgba(54, 101, 243, 0.2);
        border-radius: 8px;
        font-family: 'Inter', -apple-system, sans-serif;
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: #e8eaf0;
      ">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:16px;">📊</span>
          <span style="font-size:13px; font-weight:600; color: #161822;">Price Intelligence</span>
          <span style="font-size:12px; color:#575b6e; margin-left:4px;">${stats.validItems.length} valid items in ${groupCount} groups</span>
        </div>
        <div style="display:flex; gap:16px; font-size:13px;">
          <div><span style="color:#575b6e;">Overall Avg:</span> <strong style="color:#3665f3;">${formatPrice(stats.mean, currency)}</strong></div>
        </div>
      </div>
    `;

    if (panel.innerHTML !== html) {
      panel.innerHTML = html;
    }

    if (needsAppend) {
      const resultsContainer =
        document.querySelector('.srp-results') ||
        document.querySelector('#srp-river-results') ||
        document.querySelector('[id*="ResultSet"]') ||
        document.querySelector('.srp-river-main');

      if (resultsContainer && resultsContainer.parentNode) {
        resultsContainer.parentNode.insertBefore(panel, resultsContainer);
      } else {
        const main = document.querySelector('#mainContent') || document.querySelector('#srp-river') || document.body;
        main.insertBefore(panel, main.firstChild);
      }
    }
  }

  function getListingData(card: Element): ListingItem | null {
    if (card.classList && (card.classList.contains('s-item__pl-on-bottom') || card.classList.contains('s-card__pl-on-bottom'))) return null;

    const titleEl = card.querySelector('.s-item__title, .s-card__title');
    const priceEl = card.querySelector('.s-item__price, .s-card__price');
    const subtitleEl = card.querySelector('.s-item__subtitle, .s-item__secondary-info, .SECONDARY_INFO, .s-card__subtitle, .s-item__condition');

    if (!titleEl || !priceEl) return null;

    const title = titleEl.textContent || '';
    const price = parsePriceText(priceEl.textContent || '');
    const condition = subtitleEl && subtitleEl.textContent ? subtitleEl.textContent.toLowerCase() : '';

    return { card, title, price, condition, tokens: tokenizeTitle(title) };
  }

  function injectBadge(item: ListingItem, badgeData: any, currency: string) {
    if (!item.card) return;
    let badge = item.card.querySelector('.bb-price-badge') as HTMLElement;
    let needsAppend = false;
    
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'bb-price-badge';
      badge.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        font-weight: 500;
        padding: 2px 6px;
        border-radius: 4px;
        margin-left: 8px;
        font-family: 'Inter', -apple-system, sans-serif;
      `;
      needsAppend = true;
    }

    let targetBg, targetColor, targetHtml;

    if (badgeData.type === 'excluded') {
      targetBg = 'rgba(139, 143, 163, 0.1)';
      targetColor = '#8b8fa3';
      targetHtml = `⚪ Excluded (parts)`;
    } else {
      const avgStr = currency + badgeData.mean.toFixed(2);
      if (badgeData.type === 'good') {
        targetBg = 'rgba(92, 184, 92, 0.1)';
        targetColor = '#5cb85c';
        targetHtml = `🟢 Good (avg ${avgStr})`;
      } else if (badgeData.type === 'fair') {
        targetBg = 'rgba(240, 173, 78, 0.1)';
        targetColor = '#f0ad4e';
        targetHtml = `🟡 Fair (avg ${avgStr})`;
      } else if (badgeData.type === 'high') {
        targetBg = 'rgba(217, 83, 79, 0.1)';
        targetColor = '#d9534f';
        targetHtml = `🔴 Above avg (avg ${avgStr})`;
      }
    }

    if (badge.innerHTML !== targetHtml) {
      badge.style.background = targetBg;
      badge.style.color = targetColor;
      badge.innerHTML = targetHtml;
    }

    if (needsAppend) {
      const priceContainer = item.card.querySelector('.s-item__price, .s-card__price');
      if (priceContainer) {
        priceContainer.appendChild(badge);
      }
    }
  }

  function applyPriceIntelligence(settings: any, retryCount = 0) {
    const cards = getListingCards();
    
    if (cards.length === 0 && retryCount < 5) {
      setTimeout(() => applyPriceIntelligence(settings, retryCount + 1), 500);
      return;
    }

    const currency = detectCurrency(window.location.host);
    const listings: ListingItem[] = [];
    cards.forEach(c => {
      const data = getListingData(c);
      if (data) listings.push(data);
    });

    const clusters = clusterListings(listings, settings.confidenceThreshold);
    const overallStats = calculateGroupStats(listings, settings.excludeBroken);
    
    createOverviewPanel(overallStats, clusters.length, currency);

    for (const cluster of clusters) {
      const stats = calculateGroupStats(cluster.items, settings.excludeBroken);
      
      for (const item of cluster.items) {
        if (!item.price) continue;

        let isBroken = false;
        if (settings.excludeBroken) {
          const cond = item.condition;
          if (cond.includes('parts') || cond.includes('repair') || cond.includes('faulty') || cond.includes('broken')) {
            isBroken = true;
          }
        }

        if (isBroken) {
          injectBadge(item, { type: 'excluded' }, currency);
        } else if (stats) {
          const diff = item.price - stats.mean;
          if (diff < -0.5 * stats.stdDev) {
            injectBadge(item, { type: 'good', mean: stats.mean }, currency);
          } else if (diff > 0.5 * stats.stdDev) {
            injectBadge(item, { type: 'high', mean: stats.mean }, currency);
          } else {
            injectBadge(item, { type: 'fair', mean: stats.mean }, currency);
          }
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // FEATURE 5: Sticky Filters
  // ══════════════════════════════════════════════════════════

  const STICKY_STORAGE_KEY = 'bb_stickyParams';

  function getCurrentFilterParams() {
    const url = new URL(window.location.href);
    const params: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      if (!NON_STICKY_PARAMS.has(key)) {
        params[key] = value;
      }
    });
    return params;
  }

  function saveStickyParams(params: Record<string, string>) {
    try {
      sessionStorage.setItem(STICKY_STORAGE_KEY, JSON.stringify(params));
    } catch (e) {
      // sessionStorage not available — silently fail
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
      // Nothing saved yet — just save current params
      saveStickyParams(getCurrentFilterParams());
      return;
    }

    const url = new URL(window.location.href);
    let changed = false;

    // Re-inject saved params that are missing from the current URL
    Object.entries(saved).forEach(([key, value]) => {
      if (!url.searchParams.has(key)) {
        url.searchParams.set(key, value);
        changed = true;
      }
    });

    // Save current params (merged) for next time
    saveStickyParams(getCurrentFilterParams());

    if (changed) {
      // Guard: prevent redirect loop
      const guardKey = 'bb_stickyApplied';
      if (sessionStorage.getItem(guardKey)) {
        sessionStorage.removeItem(guardKey);
        return;
      }
      sessionStorage.setItem(guardKey, '1');
      window.location.replace(url.toString());
    }
  }



  // ══════════════════════════════════════════════════════════
  // MAIN — Initialisation
  // ══════════════════════════════════════════════════════════

  function init() {
    const defaultSettings = {
      hideCollectionOnly: true,
      localItemsOnly: true,
      priceBadges: true,
      excludeBroken: true,
      stickyFilters: false,
      confidenceThreshold: 70
    };

    chrome.storage.sync.get(defaultSettings, function (settings) {

      // Feature 5: Sticky Filters (must run before URL-modifying features)
      if (settings.stickyFilters) {
        applyStickyFilters();
      }

      // Feature 2: Local Items Only (may redirect — run early)
      if (settings.localItemsOnly) {
        applyLocalItemsOnly();
      }

      if (settings.hideCollectionOnly || settings.priceBadges) {
        if (settings.hideCollectionOnly) processAllCards();
        if (settings.priceBadges) applyPriceIntelligence(settings);

        const resultsContainer =
          document.querySelector('.srp-results') ||
          document.querySelector('#srp-river-results') ||
          document.querySelector('.srp-river-main') ||
          document.querySelector('[id*="ResultSet"]') ||
          document.body;

        const observer = new MutationObserver(mutations => {
          let hasNewNodes = false;
          for (const mutation of mutations) {
            for (const node of Array.from(mutation.addedNodes)) {
              const el = node.nodeType === 1 ? (node as Element) : (node.parentNode as Element);
              if (el && el.closest && el.closest('#bb-overview-panel, .bb-price-badge')) {
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

      // Feature 3: Sold Listings overlay button (always visible on search pages)
      createSoldButton();

    });
  }

  // Wait for DOM if needed
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
