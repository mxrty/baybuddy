import { detectCurrency } from '../utils';
import type { PricingResult, PricingGroup } from '../pricing/types';

function fmtPrice(amount: number, currency: string): string {
  return `${currency}${amount.toFixed(2)}`;
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high:        '● High confidence',
  medium:      '● Med confidence',
  low:         '● Low confidence',
  insufficient:'● Insufficient data',
};

const CONFIDENCE_COLOR: Record<string, string> = {
  high:        '#5cb85c',
  medium:      '#f0ad4e',
  low:         '#f0ad4e',
  insufficient:'#aaa',
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderGroupCard(group: PricingGroup, currency: string, depth: number): string {
  const isInsufficient = group.confidence === 'insufficient';
  const opacity = isInsufficient ? '0.55' : '1';
  const indentPx = depth * 12;
  const confColor = CONFIDENCE_COLOR[group.confidence] ?? '#aaa';
  const confLabel = CONFIDENCE_LABEL[group.confidence] ?? '';

  const medianStr = fmtPrice(group.stats.median, currency);
  const minStr = fmtPrice(group.stats.min, currency);
  const maxStr = fmtPrice(group.stats.max, currency);

  let bodyHtml: string;

  if (group.children.length > 0) {
    bodyHtml =
      `<div style="padding-left:${indentPx + 8}px;margin-top:6px;">` +
      group.children.map(c => renderGroupCard(c, currency, depth + 1)).join('') +
      '</div>';
  } else {
    const items = group.items.map(item => {
      const href = escapeHtml(item.link || '#');
      const title = escapeHtml(item.title.substring(0, 60)) + (item.title.length > 60 ? '&hellip;' : '');
      const price = fmtPrice(item.totalPrice, currency);
      return (
        `<li style="margin:2px 0;">` +
        `<a href="${href}" target="_blank" rel="noopener" ` +
        `style="color:#3665f3;text-decoration:none;font-size:11px;">` +
        `${title} &mdash; ${price}` +
        `</a></li>`
      );
    });
    bodyHtml =
      `<ul style="margin:6px 0 0;padding-left:${indentPx + 16}px;color:#575b6e;">` +
      items.join('') +
      '</ul>';
  }

  return (
    `<details style="margin-top:8px;padding:8px;background:rgba(0,0,0,0.02);` +
    `border-radius:4px;opacity:${opacity};">` +
    `<summary style="cursor:pointer;list-style:none;display:flex;align-items:center;` +
    `gap:8px;padding-left:${indentPx}px;">` +
    `<strong style="font-size:12px;">${escapeHtml(group.label)}</strong>` +
    `<span style="font-size:11px;color:#575b6e;">` +
    `${group.stats.count} items &middot; median ${medianStr} &middot; ${minStr}&ndash;${maxStr}` +
    `</span>` +
    `<span style="font-size:10px;color:${confColor};margin-left:auto;">${confLabel}</span>` +
    `</summary>` +
    bodyHtml +
    `</details>`
  );
}

export function renderDashboard(result: PricingResult, root: HTMLElement): void {
  const currency = detectCurrency(window.location.host);
  const { rootGroups, summary } = result;

  let panel = document.getElementById('bb-overview-panel');
  let needsAppend = false;

  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'bb-overview-panel';
    needsAppend = true;
  }

  if (rootGroups.length === 0) {
    panel.remove();
    return;
  }

  // rootGroups are already sorted by relevanceScore desc, count desc (done in analysePricing)
  const groupsHtml = rootGroups.map(g => renderGroupCard(g, currency, 0)).join('');

  const rangeStr = summary.overallPriceRange.max > 0
    ? `${fmtPrice(summary.overallPriceRange.min, currency)}&ndash;${fmtPrice(summary.overallPriceRange.max, currency)}`
    : 'n/a';

  panel.innerHTML =
    `<details style="margin:16px auto;background:rgba(54,101,243,0.05);` +
    `border:1px solid rgba(54,101,243,0.2);border-radius:8px;` +
    `font-family:'Inter',-apple-system,sans-serif;color:#161822;">` +
    `<summary style="padding:12px 16px;display:flex;align-items:center;` +
    `justify-content:space-between;cursor:pointer;list-style:none;">` +
    `<div style="display:flex;align-items:center;gap:8px;">` +
    `<span style="font-size:16px;">&#x1F4CA;</span>` +
    `<span style="font-size:13px;font-weight:600;">Price Intelligence</span>` +
    `<span style="font-size:12px;color:#575b6e;">` +
    `${summary.totalListingsAnalysed} items &middot; ${summary.totalGroups} groups` +
    `</span></div>` +
    `<div style="display:flex;gap:16px;font-size:13px;align-items:center;">` +
    `<span style="color:#575b6e;">Range: <strong style="color:#3665f3;">${rangeStr}</strong></span>` +
    `<span style="color:#3665f3;font-size:10px;">&#x25BC;</span>` +
    `</div></summary>` +
    `<div style="padding:0 16px 16px;font-size:12px;">${groupsHtml}</div>` +
    `</details>`;

  if (needsAppend) {
    const resultsContainer =
      root.querySelector('.srp-results') ||
      root.querySelector('#srp-river-results') ||
      root.querySelector('[id*="ResultSet"]') ||
      root.querySelector('.srp-river-main');

    if (resultsContainer && resultsContainer.parentNode) {
      resultsContainer.parentNode.insertBefore(panel, resultsContainer);
    } else {
      const main = root.querySelector('#mainContent') || root.querySelector('#srp-river') || root;
      main.insertBefore(panel, main.firstChild);
    }
  }
}
