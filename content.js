/**
 * eBay UK Filter Pro — Content Script
 *
 * Hides collection-only listings on eBay UK search results.
 * Runs after the DOM is ready. Uses a MutationObserver to
 * catch lazy-loaded listings as the user scrolls.
 *
 * A listing is considered "collection-only" if its delivery/
 * shipping text contains "collection" but does NOT mention
 * any postage/delivery price (e.g. "+£5.00 postage" or "Free postage").
 *
 * Items offering BOTH postage and collection remain visible.
 */

(function () {
  'use strict';

  const HIDDEN_ATTR = 'data-ebay-filter-hidden';

  // ── Keywords ─────────────────────────────────────────────
  // Collection indicators
  const COLLECTION_PATTERNS = [
    /collection\s*(only|in\s*person)?/i,
    /collect\s*in\s*person/i,
    /local\s*pick\s*up/i,
    /pickup\s*only/i
  ];

  // Postage/delivery indicators — if ANY of these are present,
  // the item offers posting so we keep it visible
  const POSTAGE_PATTERNS = [
    /\+\s*£[\d.]+\s*(postage|delivery|p&p)/i,
    /free\s*(postage|delivery|p&p|shipping)/i,
    /£[\d.]+\s*delivery/i,
    /fast\s*&?\s*free/i,
    /estimated\s*delivery/i,
    /royal\s*mail/i,
    /hermes/i,
    /evri/i,
    /dpd/i,
    /yodel/i,
    /parcelforce/i
  ];

  /**
   * Get all listing card elements on the page.
   * eBay uses various class names — we try multiple selectors.
   */
  function getListingCards() {
    // Try modern eBay selectors first, then legacy
    const selectors = [
      'li.s-item',
      '.srp-results .s-item',
      'ul.srp-results > li',
      '.s-card',
      '[data-viewport]'
    ];

    for (const sel of selectors) {
      const cards = document.querySelectorAll(sel);
      if (cards.length > 0) return cards;
    }

    return [];
  }

  /**
   * Extract all delivery/shipping related text from a listing card.
   * We look at multiple possible containers.
   */
  function getDeliveryText(card) {
    // Try specific delivery selectors first
    const deliverySelectors = [
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

    // If no specific selectors matched, fall back to scanning
    // all spans and small text elements in the lower part of the card
    if (deliveryText.trim().length === 0) {
      const allSpans = card.querySelectorAll('span, .s-item__detail');
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

  /**
   * Check if a listing is collection-only (no postage option).
   */
  function isCollectionOnly(card) {
    const text = getDeliveryText(card);
    if (!text.trim()) return false;

    const hasCollection = COLLECTION_PATTERNS.some(p => p.test(text));
    if (!hasCollection) return false;

    const hasPostage = POSTAGE_PATTERNS.some(p => p.test(text));
    return !hasPostage;
  }

  /**
   * Process a single listing card — hide if collection-only.
   */
  function processCard(card) {
    // Skip already-processed cards
    if (card.hasAttribute(HIDDEN_ATTR)) return;

    // Skip the first "fake" s-item that eBay uses as a template
    if (card.classList && card.classList.contains('s-item__pl-on-bottom')) return;
    const itemId = card.getAttribute('data-view');
    if (!itemId && card.querySelector('.s-item__link')?.href?.includes('ebay.co.uk/sch/') === false) {
      // Looks like a real listing
    }

    if (isCollectionOnly(card)) {
      card.style.display = 'none';
      card.setAttribute(HIDDEN_ATTR, 'true');
    }
  }

  /**
   * Process all current listings on the page.
   */
  function processAllCards() {
    const cards = getListingCards();
    cards.forEach(processCard);
  }



  // ── Main ─────────────────────────────────────────────────
  function init() {
    chrome.storage.sync.get({ hideCollectionOnly: true }, function (settings) {
      if (!settings.hideCollectionOnly) return;

      processAllCards();

      // Watch for new listings loaded dynamically (infinite scroll)
      const resultsContainer =
        document.querySelector('.srp-results') ||
        document.querySelector('#srp-river-results') ||
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
    });
  }

  // Wait for DOM if needed
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
