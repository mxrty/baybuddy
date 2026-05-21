# BayBuddy Test Data Scraper

Because eBay implements strict anti-bot measures (CAPTCHAs, IP blocking) that often block automated tools like `curl`, `fetch`, or headless `Puppeteer`, the most reliable way to gather realistic test data sets is by using a manual browser injection method.

This folder contains a lightweight local server setup to easily scrape listing items directly from your browser's DevTools console and save them straight to your filesystem.

## How to Extract More Data

1. **Start the local server:**
   Open a terminal, navigate to this folder, and run the server. It uses standard Node.js without any extra dependencies.
   ```bash
   cd test-data
   node server.js
   ```
   *The server will start listening on `http://localhost:3000`.*

2. **Navigate to eBay:**
   Open your regular browser (Chrome, Firefox, Safari, etc.) and perform any search on eBay. Ensure you apply the filters you want (e.g., Sold items, Used condition). Let the page load completely. Solve any CAPTCHAs if eBay prompts you.

3. **Inject the scraper:**
   Open the browser's Developer Tools (`F12` or `Right Click -> Inspect`), go to the **Console** tab, and run the following snippet. Make sure to update the configuration variables for your specific search!

   ```javascript
   window.filename = 'my-new-dataset.json';
   window.searchTerm = 'Nintendo Switch';
   window.isSold = true;
   window.isUsed = false;
   
   fetch('http://localhost:3000/extract.js').then(r=>r.text()).then(eval);
   ```

4. **Done!**
   The browser will extract all items from the page, send them to the local node server, and you'll immediately see `my-new-dataset.json` appear in the `test-data` folder.

## Files
- `server.js`: The node server that receives the scraped data and writes the JSON files.
- `extract.js`: The DOM parsing logic that runs in the browser.
- `schema.json`: The schema describing the layout of the generated JSON files.
