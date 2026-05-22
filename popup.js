"use strict";
(() => {
  // src/popup.ts
  (function() {
    "use strict";
    const SETTINGS = [
      { id: "hideCollectionOnly", key: "hideCollectionOnly", default: true },
      { id: "localItemsOnly", key: "localItemsOnly", default: true },
      { id: "priceBadges", key: "priceBadges", default: true },
      { id: "stickyFilters", key: "stickyFilters", default: false },
      { id: "debugMode", key: "debugMode", default: false }
    ];
    const statusBar = document.getElementById("statusBar");
    const statusText = document.getElementById("statusText");
    const applyBtn = document.getElementById("applyNow");
    const defaults = {};
    SETTINGS.forEach((s) => {
      defaults[s.key] = s.default;
    });
    chrome.storage.sync.get(defaults, function(settings) {
      SETTINGS.forEach((s) => {
        const el = document.getElementById(s.id);
        if (el) {
          if (el.type === "checkbox") el.checked = settings[s.key];
          else if (el.type === "range") el.value = String(settings[s.key]);
        }
      });
      updateStatus(settings);
    });
    SETTINGS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (!el) return;
      const eventType = "change";
      el.addEventListener(eventType, function() {
        const update = {};
        update[s.key] = el.checked;
        chrome.storage.sync.set(update, function() {
          chrome.storage.sync.get(defaults, function(allSettings) {
            updateStatus(allSettings);
            flashSaved();
          });
        });
      });
    });
    function updateStatus(settings) {
      const activeCount = SETTINGS.filter(
        (s) => s.key !== "debugMode" && settings[s.key]
      ).length;
      const total = SETTINGS.length - 1;
      if (activeCount > 0) {
        statusBar.classList.remove("inactive");
        statusText.textContent = activeCount + " of " + total + " filters active";
      } else {
        statusBar.classList.add("inactive");
        statusText.textContent = "All filters disabled";
      }
    }
    function flashSaved() {
      const origText = statusText.textContent;
      statusText.textContent = "\u2713 Saved";
      setTimeout(function() {
        statusText.textContent = origText;
      }, 800);
    }
    if (applyBtn) {
      applyBtn.addEventListener("click", function() {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
          if (tabs[0] && tabs[0].id) {
            chrome.tabs.reload(tabs[0].id);
            window.close();
          }
        });
      });
    }
  })();
})();
