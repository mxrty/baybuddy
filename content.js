/**
 * BayBuddy — Content Script
 *
 * Features:
 *   1. Hide collection-only listings (DOM filtering)
 *   2. Local Items Only (URL param injection)
 *   3. Search Sold Listings (on-page overlay button)
 *   4. Sold Price Stats (price analytics panel)
 *   5. Sticky Filters (re-inject saved URL params)
 *
 * Runs on eBay search pages after the DOM is ready.
 * Uses a MutationObserver for lazy-loaded listings.
 */

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

  function processCard(card) {
    if (card.hasAttribute(HIDDEN_ATTR)) return;
    // Skip template/placeholder items
    if (card.classList && (card.classList.contains('s-item__pl-on-bottom') || card.classList.contains('s-card__pl-on-bottom'))) return;

    if (isCollectionOnly(card)) {
      card.style.display = 'none';
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
  // FEATURE 4: Sold Price Stats
  // ══════════════════════════════════════════════════════════

  function detectCurrency() {
    const priceEl = document.querySelector('.s-card__price, .s-item__price');
    if (!priceEl) return '£';
    const text = priceEl.textContent.trim();
    if (text.includes('AU $'))  return 'AU $';
    if (text.includes('C $'))   return 'C $';
    if (text.includes('US $'))  return 'US $';
    if (text.startsWith('$'))   return '$';
    if (text.startsWith('€'))   return '€';
    if (text.startsWith('£'))   return '£';
    // Try to find currency symbol anywhere
    const match = text.match(/[£$€]/);
    return match ? match[0] : '£';
  }

  function parsePriceText(text) {
    // Remove currency symbols and whitespace
    let cleaned = text.replace(/[£$€,]/g, '').replace(/AU\s*/i, '').replace(/US\s*/i, '').replace(/C\s*/i, '').trim();

    // Handle ranges like "30.00 to 45.00"
    if (cleaned.includes(' to ')) {
      const parts = cleaned.split(' to ');
      const low  = parseFloat(parts[0].trim());
      const high = parseFloat(parts[1].trim());
      if (!isNaN(low) && !isNaN(high)) return (low + high) / 2;
    }

    const val = parseFloat(cleaned);
    return isNaN(val) ? null : val;
  }

  function collectPrices() {
    // Support both new and legacy price selectors
    const priceEls = document.querySelectorAll('.s-card__price, .s-item__price');
    const prices = [];

    priceEls.forEach(el => {
      // Skip template/placeholder items
      const card = el.closest('.s-card, .s-item');
      if (card && (card.classList.contains('s-item__pl-on-bottom') || card.classList.contains('s-card__pl-on-bottom'))) return;

      const price = parsePriceText(el.textContent);
      if (price !== null && price > 0) {
        prices.push(price);
      }
    });

    return prices;
  }

  function calculateStats(prices) {
    if (prices.length === 0) return null;

    const sorted = [...prices].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const avg = sum / sorted.length;
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;

    return {
      count:  sorted.length,
      avg:    avg,
      median: median,
      min:    sorted[0],
      max:    sorted[sorted.length - 1],
      sorted: sorted
    };
  }

  function buildHistogram(sorted, bucketCount) {
    if (sorted.length === 0) return [];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const range = max - min || 1;
    const bucketSize = range / bucketCount;

    const buckets = new Array(bucketCount).fill(0);
    sorted.forEach(p => {
      let idx = Math.floor((p - min) / bucketSize);
      if (idx >= bucketCount) idx = bucketCount - 1;
      buckets[idx]++;
    });

    return buckets;
  }

  function formatPrice(value, currency) {
    return currency + value.toFixed(2);
  }

  function createStatsPanel(stats, currency) {
    // Remove existing panel if present
    const existing = document.getElementById('bb-stats-panel');
    if (existing) existing.remove();

    const histogram = buildHistogram(stats.sorted, 12);
    const maxBucket = Math.max(...histogram);

    // Build histogram bars
    const bars = histogram.map(count => {
      const height = maxBucket > 0 ? Math.max(4, (count / maxBucket) * 40) : 4;
      return '<div style="' +
        'flex:1;' +
        'height:' + height + 'px;' +
        'background:linear-gradient(to top, #3665f3, #5b7ff7);' +
        'border-radius:2px 2px 0 0;' +
        'min-width:6px;' +
        'transition:height 300ms ease;' +
      '"></div>';
    }).join('');

    const panel = document.createElement('div');
    panel.id = 'bb-stats-panel';
    panel.innerHTML = `
      <div style="
        margin: 16px auto;
        max-width: 960px;
        padding: 20px 24px;
        background: linear-gradient(135deg, #0f1117, #161822);
        border: 1px solid rgba(54, 101, 243, 0.2);
        border-radius: 12px;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        color: #e8eaf0;
        box-shadow: 0 4px 24px rgba(0,0,0,0.3);
      ">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:16px;">📊</span>
            <span style="font-size:14px; font-weight:700; letter-spacing:-0.3px;">BayBuddy Price Stats</span>
            <span style="font-size:12px; color:#8b8fa3; margin-left:4px;">${stats.count} sold items</span>
          </div>
          <button id="bb-stats-close" style="
            background:none; border:none; color:#8b8fa3; cursor:pointer;
            font-size:18px; padding:4px 8px; border-radius:6px;
            transition: all 150ms ease;
          " onmouseover="this.style.background='rgba(255,255,255,0.1)';this.style.color='#e8eaf0'"
             onmouseout="this.style.background='none';this.style.color='#8b8fa3'">✕</button>
        </div>

        <div style="display:flex; gap:16px; margin-bottom:16px; flex-wrap:wrap;">
          <div style="flex:1; min-width:100px; padding:12px 16px; background:rgba(54,101,243,0.08); border-radius:8px; border:1px solid rgba(54,101,243,0.15);">
            <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:#8b8fa3; margin-bottom:4px;">Average</div>
            <div style="font-size:18px; font-weight:700; color:#5b7ff7;">${formatPrice(stats.avg, currency)}</div>
          </div>
          <div style="flex:1; min-width:100px; padding:12px 16px; background:rgba(92,184,92,0.08); border-radius:8px; border:1px solid rgba(92,184,92,0.15);">
            <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:#8b8fa3; margin-bottom:4px;">Median</div>
            <div style="font-size:18px; font-weight:700; color:#5cb85c;">${formatPrice(stats.median, currency)}</div>
          </div>
          <div style="flex:1; min-width:100px; padding:12px 16px; background:rgba(255,255,255,0.04); border-radius:8px; border:1px solid rgba(255,255,255,0.06);">
            <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:#8b8fa3; margin-bottom:4px;">Low</div>
            <div style="font-size:18px; font-weight:700;">${formatPrice(stats.min, currency)}</div>
          </div>
          <div style="flex:1; min-width:100px; padding:12px 16px; background:rgba(255,255,255,0.04); border-radius:8px; border:1px solid rgba(255,255,255,0.06);">
            <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:#8b8fa3; margin-bottom:4px;">High</div>
            <div style="font-size:18px; font-weight:700;">${formatPrice(stats.max, currency)}</div>
          </div>
        </div>

        <div style="
          display:flex; align-items:flex-end; gap:3px; height:44px;
          padding:8px 4px 0; background:rgba(255,255,255,0.02);
          border-radius:8px; border:1px solid rgba(255,255,255,0.04);
        ">
          ${bars}
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:4px; padding:0 4px;">
          <span style="font-size:10px; color:#575b6e;">${formatPrice(stats.min, currency)}</span>
          <span style="font-size:10px; color:#575b6e;">Price distribution</span>
          <span style="font-size:10px; color:#575b6e;">${formatPrice(stats.max, currency)}</span>
        </div>
      </div>
    `;

    // Insert at top of results
    const resultsContainer =
      document.querySelector('.srp-results') ||
      document.querySelector('#srp-river-results') ||
      document.querySelector('[id*="ResultSet"]') ||
      document.querySelector('.srp-river-main');

    if (resultsContainer) {
      resultsContainer.parentNode.insertBefore(panel, resultsContainer);
    } else {
      // Fallback: insert at top of main content
      const main = document.querySelector('#mainContent') || document.querySelector('#srp-river') || document.body;
      main.insertBefore(panel, main.firstChild);
    }

    // Close button handler
    document.getElementById('bb-stats-close').addEventListener('click', () => {
      panel.remove();
    });
  }

  function showPriceStats(retryCount) {
    retryCount = retryCount || 0;

    const prices = collectPrices();
    const stats = calculateStats(prices);

    // Items may not have loaded yet — retry up to 5 times
    if (!stats && retryCount < 5) {
      setTimeout(function () {
        showSoldStats(retryCount + 1);
      }, 500 * (retryCount + 1));
      return;
    }

    if (!stats) return;

    const currency = detectCurrency();
    createStatsPanel(stats, currency);
  }

  // ══════════════════════════════════════════════════════════
  // FEATURE 5: Sticky Filters
  // ══════════════════════════════════════════════════════════

  const STICKY_STORAGE_KEY = 'bb_stickyParams';

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
      soldPriceStats: true,
      stickyFilters: false
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

      // Feature 1: Hide Collection Only
      if (settings.hideCollectionOnly) {
        processAllCards();

        const resultsContainer =
          document.querySelector('.srp-results') ||
          document.querySelector('#srp-river-results') ||
          document.querySelector('.srp-river-main') ||
          document.querySelector('[id*="ResultSet"]') ||
          document.body;

        const observer = new MutationObserver(mutations => {
          let hasNewNodes = false;
          for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
              hasNewNodes = true;
              break;
            }
          }
          if (hasNewNodes) {
            processAllCards();
          }
        });

        observer.observe(resultsContainer, {
          childList: true,
          subtree: true
        });
      }

      // Feature 3: Sold Listings overlay button (always visible on search pages)
      createSoldButton();

      // Feature 4: Price Stats (active and sold listings)
      if (settings.soldPriceStats) {
        showPriceStats();
      }


    });
  }

  // Wait for DOM if needed
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
