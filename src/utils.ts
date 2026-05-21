export interface Settings {
  hideCollectionOnly: boolean;
  localItemsOnly: boolean;
  priceBadges: boolean;
  excludeBroken: boolean;
  stickyFilters: boolean;
  confidenceThreshold: number;
}

export function detectCurrency(host: string): string {
  if (host.includes("ebay.co.uk")) return "£";
  if (host.includes("ebay.com.au")) return "AU $";
  if (host.includes("ebay.ca")) return "C $";
  if (
    host.includes("ebay.de") ||
    host.includes("ebay.fr") ||
    host.includes("ebay.it") ||
    host.includes("ebay.es") ||
    host.includes("ebay.ie") ||
    host.includes("ebay.nl") ||
    host.includes("ebay.at")
  )
    return "€";
  return "$";
}
