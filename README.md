# 🐟 BayBuddy

**Your smart eBay companion** — a Chrome extension that makes eBay search smarter with powerful filters, sold price analytics, and sticky search preferences.

![BayBuddy Icon](icons/icon128.png)

## Features

### 🚫 Hide Collection Only
Automatically hides listings that only offer collection/pickup, so you only see items that can be delivered. Works by scanning delivery text on each listing card.

### 🌍 Local Items Only
Automatically filters search results to show only items located in your country. Works on all eBay regional sites.

### 🔍 Search Sold Listings
Floating on-page button to instantly switch between active and sold/completed listings with one click. Great for price research and market analysis.

### 📊 Sold Price Stats
When viewing sold listings, displays a price analytics panel showing:
- Average, median, min, and max sold prices
- Visual price distribution histogram
- Automatic currency detection

### 📌 Sticky Filters
Remembers your active filters (condition, price range, buying format, etc.) and re-applies them when you change your search query. No more losing your "Used" + "Buy It Now" filters every time you search for something new.

## Installation

### From Chrome Web Store
*Coming soon*

### Manual Installation (Developer Mode)
1. Clone this repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/baybuddy.git
   ```
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked** and select the `baybuddy` folder
5. The BayBuddy icon will appear in your toolbar

## Supported eBay Sites

| Site | Domain |
|------|--------|
| 🇬🇧 UK | ebay.co.uk |
| 🇺🇸 US | ebay.com |
| 🇦🇺 Australia | ebay.com.au |
| 🇨🇦 Canada | ebay.ca |
| 🇩🇪 Germany | ebay.de |
| 🇫🇷 France | ebay.fr |
| 🇮🇹 Italy | ebay.it |
| 🇪🇸 Spain | ebay.es |
| 🇮🇪 Ireland | ebay.ie |
| 🇳🇱 Netherlands | ebay.nl |
| 🇦🇹 Austria | ebay.at |
| 🇨🇭 Switzerland | ebay.ch |
| 🇵🇱 Poland | ebay.pl |

> **Note:** The "Hide Collection Only" feature uses English-language patterns and works best on English-language eBay sites (UK, US, Australia, Canada, Ireland).

## Privacy

BayBuddy runs entirely on your device. No data is collected, transmitted, or shared. See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for details.

## License

[MIT](LICENSE)
