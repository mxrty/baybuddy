export interface RawListing {
  title: string;
  priceText: string;
  condition: string;
  link: string;
  deliveryText: string;
}

export interface ParsedListing {
  title: string;
  itemPrice: number;
  postage: number;
  postageKnown: boolean;
  totalPrice: number;
  condition: string;
  link: string;
  tokens: WeightedTokens;
  isJunk: boolean;
  isExcluded: boolean;
}

export interface WeightedTokens {
  model: string[];
  variant: string[];
  identity: string[];
  descriptors: string[];
  noise: Set<string>;
  raw: Set<string>;
}

export interface PricingGroup {
  id: string;
  label: string;
  items: ParsedListing[];
  children: PricingGroup[];
  parent: string | null;
  depth: number;
  stats: GroupStatistics;
  confidence: "high" | "medium" | "low" | "insufficient";
  relevanceScore: number;
}

export interface GroupStatistics {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p25: number;
  p75: number;
  stdDev: number;
  iqr: number;
}

export type PriceRating = "good" | "fair" | "high" | "no-data";

export interface ListingAssessment {
  listing: ParsedListing;
  rating: PriceRating;
  matchedGroup: PricingGroup | null;
  percentile: number | null;
  showBadge: boolean;
}

export interface PricingResult {
  rootGroups: PricingGroup[];
  assessments: ListingAssessment[];
  summary: {
    totalListingsAnalysed: number;
    totalGroups: number;
    filteredOut: number;
    overallPriceRange: { min: number; max: number };
  };
  searchTerm: string;
}

export interface PricingSettings {
  enabled: boolean;
  similarityThreshold?: number;
}

export interface ClusterOptions {
  similarityThreshold?: number;
}
