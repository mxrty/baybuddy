/**
 * BayBuddy — Popup Script
 *
 * Manages settings toggles for all features.
 * Persisted to chrome.storage.sync.
 */

(function () {
  'use strict';

  // ── Setting definitions ─────────────────────────────────
  // Each entry: { id, storageKey, default }
  const SETTINGS = [
    { id: 'hideCollectionOnly', key: 'hideCollectionOnly', default: true },
    { id: 'localItemsOnly',    key: 'localItemsOnly',    default: true },
    { id: 'priceBadges',       key: 'priceBadges',       default: true },
    { id: 'excludeBroken',     key: 'excludeBroken',     default: true },
    { id: 'stickyFilters',     key: 'stickyFilters',     default: false },
    { id: 'confidenceThreshold', key: 'confidenceThreshold', default: 70 }
  ];

  const statusBar  = document.getElementById('statusBar');
  const statusText = document.getElementById('statusText');
  const applyBtn   = document.getElementById('applyNow');
  const expandPriceBadgesBtn = document.getElementById('expandPriceBadges');
  const priceBadgesGroup = document.getElementById('priceBadgesGroup');

  // Build defaults object for chrome.storage.sync.get
  const defaults: any = {};
  SETTINGS.forEach(s => { defaults[s.key] = s.default; });

  // ── Load saved settings ─────────────────────────────────
  chrome.storage.sync.get(defaults, function (settings) {
    SETTINGS.forEach(s => {
      const el = document.getElementById(s.id) as HTMLInputElement;
      if (el) {
        if (el.type === 'checkbox') el.checked = settings[s.key];
        else if (el.type === 'range') el.value = settings[s.key];
      }
    });
    
    const confVal = document.getElementById('confidenceVal');
    if (confVal) confVal.textContent = settings.confidenceThreshold + '% Threshold';

    updateStatus(settings);
  });

  // ── Attach change listeners ─────────────────────────────
  SETTINGS.forEach(s => {
    const el = document.getElementById(s.id) as HTMLInputElement;
    if (!el) return;

    const eventType = el.type === 'range' ? 'input' : 'change';

    el.addEventListener(eventType, function () {
      const update: any = {};
      update[s.key] = el.type === 'checkbox' ? el.checked : parseInt(el.value, 10);
      
      if (s.key === 'confidenceThreshold') {
        const confVal = document.getElementById('confidenceVal');
        if (confVal) confVal.textContent = el.value + '% Threshold';
      }

      // Avoid spamming storage on range input
      if (el.type === 'range') {
        clearTimeout(el.dataset.timeoutId);
        el.dataset.timeoutId = setTimeout(() => {
          chrome.storage.sync.set(update, function () {
            chrome.storage.sync.get(defaults, function (allSettings) {
              updateStatus(allSettings);
              flashSaved();
            });
          });
        }, 300);
      } else {
        chrome.storage.sync.set(update, function () {
          chrome.storage.sync.get(defaults, function (allSettings) {
            updateStatus(allSettings);
            flashSaved();
          });
        });
      }
    });
  });

  // ── Status bar ──────────────────────────────────────────
  function updateStatus(settings) {
    const activeCount = SETTINGS.filter(s => s.id !== 'confidenceThreshold' && settings[s.key]).length;
    const total = SETTINGS.length - 1; // exclude slider

    if (activeCount > 0) {
      statusBar.classList.remove('inactive');
      statusText.textContent = activeCount + ' of ' + total + ' filters active';
    } else {
      statusBar.classList.add('inactive');
      statusText.textContent = 'All filters disabled';
    }
  }

  // ── Flash confirmation ──────────────────────────────────
  function flashSaved() {
    const origText = statusText.textContent;
    statusText.textContent = '✓ Saved';
    setTimeout(function () {
      statusText.textContent = origText;
    }, 800);
  }

  // ── Expand/Collapse Sub-settings ────────────────────────
  if (expandPriceBadgesBtn && priceBadgesGroup) {
    expandPriceBadgesBtn.addEventListener('click', function() {
      const isExpanded = priceBadgesGroup.getAttribute('data-expanded') === 'true';
      priceBadgesGroup.setAttribute('data-expanded', String(!isExpanded));
      expandPriceBadgesBtn.setAttribute('aria-expanded', String(!isExpanded));
      
      // Optionally save expanded state to local storage so it persists
      chrome.storage.local.set({ priceBadgesExpanded: !isExpanded });
    });
    
    // Restore expanded state
    chrome.storage.local.get(['priceBadgesExpanded'], function(res) {
      if (res.priceBadgesExpanded) {
        priceBadgesGroup.setAttribute('data-expanded', 'true');
        expandPriceBadgesBtn.setAttribute('aria-expanded', 'true');
      }
    });
  }

  // ── Refresh current tab ─────────────────────────────────
  if (applyBtn) {
    applyBtn.addEventListener('click', function () {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs[0] && tabs[0].id) {
          chrome.tabs.reload(tabs[0].id);
          window.close();
        }
      });
    });
  }
})();
