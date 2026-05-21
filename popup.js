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
    { id: 'soldPriceStats',    key: 'soldPriceStats',    default: true },
    { id: 'stickyFilters',     key: 'stickyFilters',     default: false }
  ];

  const statusBar  = document.getElementById('statusBar');
  const statusText = document.getElementById('statusText');
  const applyBtn   = document.getElementById('applyNow');

  // Build defaults object for chrome.storage.sync.get
  const defaults = {};
  SETTINGS.forEach(s => { defaults[s.key] = s.default; });

  // ── Load saved settings ─────────────────────────────────
  chrome.storage.sync.get(defaults, function (settings) {
    SETTINGS.forEach(s => {
      const toggle = document.getElementById(s.id);
      if (toggle) toggle.checked = settings[s.key];
    });
    updateStatus(settings);
  });

  // ── Attach change listeners ─────────────────────────────
  SETTINGS.forEach(s => {
    const toggle = document.getElementById(s.id);
    if (!toggle) return;

    toggle.addEventListener('change', function () {
      const update = {};
      update[s.key] = toggle.checked;
      chrome.storage.sync.set(update, function () {
        // Re-read all settings to update status bar
        chrome.storage.sync.get(defaults, function (allSettings) {
          updateStatus(allSettings);
          flashSaved();
        });
      });
    });
  });

  // ── Status bar ──────────────────────────────────────────
  function updateStatus(settings) {
    const activeCount = SETTINGS.filter(s => settings[s.key]).length;
    const total = SETTINGS.length;

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

  // ── Refresh current tab ─────────────────────────────────
  applyBtn.addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        chrome.tabs.reload(tabs[0].id);
        window.close();
      }
    });
  });
})();
