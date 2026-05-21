# Privacy Policy — BayBuddy

**Last updated:** May 2026

## Summary

BayBuddy is a browser extension that enhances your eBay browsing experience. It operates **entirely on your device** and does not collect, transmit, or store any personal data.

## Data Collection

BayBuddy does **not** collect any data. Specifically:

- ❌ No personal information is collected
- ❌ No browsing history is tracked
- ❌ No data is sent to any external server
- ❌ No analytics or telemetry
- ❌ No cookies are set by the extension

## Data Storage

BayBuddy stores only your **extension preferences** (toggle settings) using Chrome's built-in `chrome.storage.sync` API. This data:

- Is stored locally in your browser profile
- Syncs across your Chrome instances via your Google account (a built-in Chrome feature)
- Contains only boolean toggle values (on/off settings)
- Can be cleared by uninstalling the extension

BayBuddy also uses `sessionStorage` for temporary state (sticky filter params and redirect guards). This data is automatically cleared when you close the browser tab.

## Permissions

| Permission | Why it's needed |
|------------|----------------|
| `storage` | Save your toggle preferences |
| `activeTab` | Refresh the current tab when you click "Refresh" in the popup |
| `host_permissions` (eBay domains) | Run the content script on eBay search pages to apply filters |

## Third Parties

BayBuddy does not share data with any third parties. There are no third-party scripts, SDKs, or services included in the extension.

## Changes

If this privacy policy changes, the updated version will be published in the extension's GitHub repository.

## Contact

If you have questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/YOUR_USERNAME/baybuddy).
