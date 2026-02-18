export type ToneType = "informative" | "experience" | "review" | "guide";

export interface UnsplashImage {
  id: string;
  url: string;
  thumbUrl: string;
  downloadUrl: string;
  alt: string;
  photographer: string;
  photographerUrl: string;
}

export interface GenerateRequest {
  keyword: string;
  tone: ToneType;
  fixHints?: string[];
}

export interface GenerateResponse {
  title: string;
  html: string;
  tags: string[];
  thumbnail: UnsplashImage | null;
  images: UnsplashImage[];
  review?: ReviewReport;
}

export type ReviewItemStatus = "pass" | "warn";

export interface ReviewItem {
  label: string;
  status: ReviewItemStatus;
  detail: string;
}

export interface ReviewReport {
  overallStatus: "safe" | "caution" | "risk";
  score: number;
  keywordCount: number;
  keywordDensity: number;
  flaggedWords: string[];
  items: ReviewItem[];
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
