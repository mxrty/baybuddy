/**
 * eBay UK Filter Pro — Popup Script
 *
 * Single toggle: hideCollectionOnly (default: true)
 * Persisted to chrome.storage.sync.
 */

(function () {
  'use strict';

  const toggle = document.getElementById('hideCollectionOnly');
  const applyBtn = document.getElementById('applyNow');
  const statusBar = document.getElementById('statusBar');
  const statusText = document.getElementById('statusText');

  // ── Load saved setting ──────────────────────────────────
  chrome.storage.sync.get({ hideCollectionOnly: true }, function (settings) {
    toggle.checked = settings.hideCollectionOnly;
    updateStatus(settings.hideCollectionOnly);
  });

  // ── Save on change ──────────────────────────────────────
  toggle.addEventListener('change', function () {
    const value = toggle.checked;
    chrome.storage.sync.set({ hideCollectionOnly: value }, function () {
      updateStatus(value);
      flashSaved();
    });
  });

  // ── Status bar ──────────────────────────────────────────
  function updateStatus(active) {
    if (active) {
      statusBar.classList.remove('inactive');
      statusText.textContent = 'Filter active';
    } else {
      statusBar.classList.add('inactive');
      statusText.textContent = 'Filter disabled';
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
