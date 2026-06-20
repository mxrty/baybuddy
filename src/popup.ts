import { Settings } from "./utils";

(function () {
  "use strict";

  interface SettingDef {
    id: string;
    key: keyof Settings;
    default: Settings[keyof Settings];
  }

  const SETTINGS: SettingDef[] = [
    { id: "hideCollectionOnly", key: "hideCollectionOnly", default: true },
    { id: "localItemsOnly", key: "localItemsOnly", default: true },
  ];

  const statusBar = document.getElementById("statusBar")!;
  const statusText = document.getElementById("statusText")!;
  const applyBtn = document.getElementById("applyNow");

  const defaults: Partial<Settings> = {};
  SETTINGS.forEach((s) => {
    (defaults as Record<string, unknown>)[s.key] = s.default;
  });

  // ── Load saved settings ─────────────────────────────────
  chrome.storage.sync.get(defaults, function (settings: Settings) {
    SETTINGS.forEach((s) => {
      const el = document.getElementById(s.id) as HTMLInputElement | null;
      if (el) {
        if (el.type === "checkbox") el.checked = settings[s.key] as boolean;
        else if (el.type === "range") el.value = String(settings[s.key]);
      }
    });

    updateStatus(settings);
  });

  // ── Attach change listeners ─────────────────────────────
  SETTINGS.forEach((s) => {
    const el = document.getElementById(s.id) as HTMLInputElement | null;
    if (!el) return;

    const eventType = "change";

    el.addEventListener(eventType, function () {
      const update: Partial<Settings> = {};
      (update as Record<string, unknown>)[s.key] = el.checked;

      chrome.storage.sync.set(update, function () {
        chrome.storage.sync.get(defaults, function (allSettings: Settings) {
          updateStatus(allSettings);
          flashSaved();
        });
      });
    });
  });

  // ── Status bar ──────────────────────────────────────────
  function updateStatus(settings: Settings) {
    const activeCount = SETTINGS.filter((s) => settings[s.key]).length;
    const total = SETTINGS.length;

    if (activeCount > 0) {
      statusBar.classList.remove("inactive");
      statusText.textContent = activeCount + " of " + total + " filters active";
    } else {
      statusBar.classList.add("inactive");
      statusText.textContent = "All filters disabled";
    }
  }

  // ── Flash confirmation ──────────────────────────────────
  function flashSaved() {
    const origText = statusText.textContent;
    statusText.textContent = "✓ Saved";
    setTimeout(function () {
      statusText.textContent = origText;
    }, 800);
  }

  // ── Refresh current tab ─────────────────────────────────
  if (applyBtn) {
    applyBtn.addEventListener("click", function () {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs[0] && tabs[0].id) {
          chrome.tabs.reload(tabs[0].id);
          window.close();
        }
      });
    });
  }
})();
