"use strict";
(() => {
  // src/popup.ts
  (function() {
    "use strict";
    const SETTINGS = [
      { id: "hideCollectionOnly", key: "hideCollectionOnly", default: true },
      { id: "localItemsOnly", key: "localItemsOnly", default: true },
      { id: "priceBadges", key: "priceBadges", default: true },
      { id: "excludeBroken", key: "excludeBroken", default: true },
      { id: "stickyFilters", key: "stickyFilters", default: false },
      { id: "confidenceThreshold", key: "confidenceThreshold", default: 70 }
    ];
    const statusBar = document.getElementById("statusBar");
    const statusText = document.getElementById("statusText");
    const applyBtn = document.getElementById("applyNow");
    const expandPriceBadgesBtn = document.getElementById("expandPriceBadges");
    const priceBadgesGroup = document.getElementById("priceBadgesGroup");
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
      const confVal = document.getElementById("confidenceVal");
      if (confVal)
        confVal.textContent = settings.confidenceThreshold + "% Threshold";
      updateStatus(settings);
    });
    const rangeTimers = /* @__PURE__ */ new Map();
    SETTINGS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (!el) return;
      const eventType = el.type === "range" ? "input" : "change";
      el.addEventListener(eventType, function() {
        const update = {};
        update[s.key] = el.type === "checkbox" ? el.checked : parseInt(el.value, 10);
        if (s.key === "confidenceThreshold") {
          const confVal = document.getElementById("confidenceVal");
          if (confVal) confVal.textContent = el.value + "% Threshold";
        }
        if (el.type === "range") {
          const prev = rangeTimers.get(s.key);
          if (prev !== void 0) clearTimeout(prev);
          const timer = setTimeout(() => {
            chrome.storage.sync.set(update, function() {
              chrome.storage.sync.get(defaults, function(allSettings) {
                updateStatus(allSettings);
                flashSaved();
              });
            });
          }, 300);
          rangeTimers.set(s.key, timer);
        } else {
          chrome.storage.sync.set(update, function() {
            chrome.storage.sync.get(defaults, function(allSettings) {
              updateStatus(allSettings);
              flashSaved();
            });
          });
        }
      });
    });
    function updateStatus(settings) {
      const activeCount = SETTINGS.filter(
        (s) => s.key !== "confidenceThreshold" && settings[s.key]
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
    if (expandPriceBadgesBtn && priceBadgesGroup) {
      expandPriceBadgesBtn.addEventListener("click", function() {
        const isExpanded = priceBadgesGroup.getAttribute("data-expanded") === "true";
        priceBadgesGroup.setAttribute("data-expanded", String(!isExpanded));
        expandPriceBadgesBtn.setAttribute("aria-expanded", String(!isExpanded));
        chrome.storage.local.set({ priceBadgesExpanded: !isExpanded });
      });
      chrome.storage.local.get(["priceBadgesExpanded"], function(res) {
        if (res["priceBadgesExpanded"]) {
          priceBadgesGroup.setAttribute("data-expanded", "true");
          expandPriceBadgesBtn.setAttribute("aria-expanded", "true");
        }
      });
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
