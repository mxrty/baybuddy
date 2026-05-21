(function() {
  const items = [];
  
  // eBay uses both .s-item (legacy) and .s-card (new) for search results
  document.querySelectorAll('.s-item, .s-card').forEach(c => {
    // Skip placeholder bottom items
    if (c.classList.contains('s-item__pl-on-bottom') || c.classList.contains('s-card__pl-on-bottom')) return;
    
    const t = c.querySelector('.s-item__title, .s-card__title');
    const p = c.querySelector('.s-item__price, .s-card__price');
    const cond = c.querySelector('.s-item__subtitle, .s-item__secondary-info, .SECONDARY_INFO, .s-card__subtitle, .s-item__condition');
    const link = c.querySelector('a.s-item__link, a.s-card__link');
    
    if (!t || !p) return;
    
    // Extract delivery text
    const ds = [
      '.s-card__shipping', '.s-card__delivery', '.s-item__shipping', 
      '.s-item__localDelivery', '.s-item__delivery', '.s-item__freeXDays', 
      '.s-item__dynamic', '[class*="shipping"]', '[class*="delivery"]'
    ];
    let dt = '';
    ds.forEach(sel => c.querySelectorAll(sel).forEach(el => dt += ' ' + el.textContent));
    
    // Fallback delivery text extraction
    if (!dt.trim()) {
      c.querySelectorAll('span, .s-item__detail, .s-card__detail').forEach(el => {
        const txt = el.textContent.trim().toLowerCase();
        if (txt.includes('collect') || txt.includes('delivery') || txt.includes('postage') || txt.includes('shipping') || txt.includes('p&p')) {
          dt += ' ' + el.textContent;
        }
      });
    }
    
    // Clean up title (remove "New Listing" hidden text if present)
    let title = t.textContent || '';
    const hiddenTitle = t.querySelector('.LIGHT_HIGHLIGHT');
    if (hiddenTitle) {
      title = title.replace(hiddenTitle.textContent, '').trim();
    }
    
    items.push({
      title: title.trim(),
      priceText: (p.textContent || '').trim(),
      condition: cond ? cond.textContent.trim() : '',
      link: link ? (link.getAttribute('href') || link.href) : '',
      deliveryText: dt.replace(/\s+/g, ' ').trim()
    });
  });

  const filename = window.filename || `dataset-${Date.now()}.json`;
  const searchTerm = window.searchTerm || 'Unknown';
  const isSold = !!window.isSold;
  const isUsed = !!window.isUsed;

  // Post to local server
  fetch('http://localhost:3000/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename,
      searchTerm,
      isSold,
      isUsed,
      items
    })
  })
  .then(() => {
    console.log(`✅ Successfully extracted ${items.length} items and saved to ${filename}`);
  })
  .catch(e => {
    console.error('❌ Failed to post data to local server. Is it running on port 3000?', e);
  });
})();
