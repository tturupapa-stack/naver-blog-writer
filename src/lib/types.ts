export type ToneType = "informative" | "experience" | "review" | "guide";

export interface UnsplashImage {
  id: string;
  url: string;
  thumbUrl: string;
  downloadUrl: string;
  alt: string;
  photographer: string;
  photographerUrl: string;
  provider?: "unsplash" | "brave";
  sourceName?: string;
  sourceUrl?: string;
  matchedQuery?: string;
  relevanceScore?: number;
}

export interface GenerateRequest {
  keyword: string;
  tone: ToneType;
  model?: string;
  fixHints?: string[];
}

export interface GenerateResponse {
  title: string;
  html: string;
  tags: string[];
  usedModel?: string;
  thumbnail: UnsplashImage | null;
  images: UnsplashImage[];
  review?: ReviewReport;
  qualityGate?: {
    passed: boolean;
    hardPass: boolean;
    naturalnessTarget: number;
    pipelineVersion: string;
    message: string;
  };
}

export type ReviewItemStatus = "pass" | "warn";
export type ReviewItemBucket = "hard" | "naturalness" | "seo" | "complianceSoft";

export interface ReviewItem {
  label: string;
  status: ReviewItemStatus;
  detail: string;
  bucket: ReviewItemBucket;
  isHard: boolean;
}

export interface ReviewReport {
  overallStatus: "safe" | "caution" | "risk";
  score: number;
  keywordCount: number;
  keywordDensity: number;
  flaggedWords: string[];
  items: ReviewItem[];
  hardPass: boolean;
  hardFailLabels: string[];
  hardChecks: {
    passed: number;
    total: number;
  };
  naturalnessScore: number;
  complianceSoftScore: number;
  seoScore: number;
  selectionScore: number;
  pipelineVersion: string;
}

export interface ImageSearchResponse {
  images: UnsplashImage[];
}

export interface SearchResult {
  title: string;
  description: string;
  url: string;
}

export interface SearchResponse {
  results: SearchResult[];
}
