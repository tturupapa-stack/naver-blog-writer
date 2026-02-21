import { NextRequest, NextResponse } from "next/server";
import { UnsplashImage } from "@/lib/types";

interface BraveImageResult {
  title?: string;
  url?: string;
  source?: string;
  thumbnail?: {
    src?: string;
    width?: number;
    height?: number;
  };
  properties?: {
    url?: string;
    width?: number;
    height?: number;
  };
}

interface BraveImageResponse {
  results?: BraveImageResult[];
  extra?: {
    might_be_offensive?: boolean;
  };
}

interface UnsplashPhotoResponse {
  id: string;
  urls?: { regular?: string; small?: string };
  links?: { download?: string };
  alt_description?: string | null;
  description?: string | null;
  user?: { name?: string; links?: { html?: string } };
}

interface UnsplashSearchResponse {
  results?: UnsplashPhotoResponse[];
}

const TOKEN_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "article",
  "photo",
  "image",
  "blog",
  "post",
  "guide",
  "review",
  "official",
  "news",
  "사진",
  "이미지",
  "기사",
  "리뷰",
  "공식",
  "추천",
  "가이드",
  "정리",
  "정보",
  "방법",
  "사용",
  "팁",
]);

const ARTICLE_HINTS = [
  "news",
  "article",
  "press",
  "review",
  "report",
  "herald",
  "times",
  "verge",
  "cnet",
  "zdnet",
  "techradar",
  "joongang",
  "chosun",
  "hankyung",
  "mk.co.kr",
  "yna.co.kr",
  "기사",
  "뉴스",
  "리뷰",
];

const BRAND_HINTS = [
  "logo",
  "official",
  "brand",
  "product",
  "model",
  "series",
  "공식",
  "브랜드",
  "제품",
  "모델",
];

const BLOCKED_SOURCE_HOSTS = [
  "pinterest.",
  "instagram.com",
  "facebook.com",
  "tiktok.com",
  "reddit.com",
];

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizeSpaces(value)).filter(Boolean)));
}

function splitQueries(mainQuery: string, rawQueries: string | null): string[] {
  const extras = rawQueries
    ? rawQueries
        .split("||")
        .map((item) => normalizeSpaces(item))
        .filter(Boolean)
    : [];
  return uniqueStrings([mainQuery, ...extras]).slice(0, 6);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9가-힣]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !TOKEN_STOPWORDS.has(token));
}

function createStableId(seed: string): string {
  let hash = 0;
  for (let idx = 0; idx < seed.length; idx++) {
    hash = (hash << 5) - hash + seed.charCodeAt(idx);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function safeUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function getHostname(value: string | undefined): string {
  if (!value) return "";
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^www\./, "").toLowerCase();
}

function parsePreferredDomains(rawValue: string | null): Set<string> {
  if (!rawValue) return new Set<string>();
  const domains = rawValue
    .split("||")
    .map((value) => normalizeHostname(value.trim()))
    .filter(Boolean);
  return new Set(domains);
}

function matchesPreferredDomain(hostname: string, preferredDomains: Set<string>): boolean {
  if (!hostname || preferredDomains.size === 0) return false;
  const normalizedHost = normalizeHostname(hostname);
  for (const preferredDomain of preferredDomains) {
    if (
      normalizedHost === preferredDomain ||
      normalizedHost.endsWith(`.${preferredDomain}`)
    ) {
      return true;
    }
  }
  return false;
}

function isBlockedSourceHost(hostname: string): boolean {
  if (!hostname) return false;
  const normalizedHost = normalizeHostname(hostname);
  return BLOCKED_SOURCE_HOSTS.some(
    (blocked) =>
      normalizedHost === blocked || normalizedHost.endsWith(`.${blocked}`) || normalizedHost.includes(blocked)
  );
}

function normalizeByProvider(image: UnsplashImage): string {
  if (image.provider === "brave") {
    return image.url.split("?")[0];
  }
  return image.id;
}

function hasHint(image: UnsplashImage, hints: string[]): boolean {
  const haystack = [
    image.alt,
    image.sourceName || "",
    image.sourceUrl || "",
    image.photographer,
    image.matchedQuery || "",
  ]
    .join(" ")
    .toLowerCase();
  return hints.some((hint) => haystack.includes(hint));
}

function tokenSetFromImage(image: UnsplashImage): Set<string> {
  return new Set(
    tokenize(
      [
        image.alt,
        image.sourceName || "",
        image.sourceUrl || "",
        image.photographer,
        image.matchedQuery || "",
      ].join(" ")
    )
  );
}

function countOverlap(left: Set<string>, right: Set<string>): number {
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap;
}

interface RelevanceSignals {
  queryOverlap: number;
  contextOverlap: number;
  exactQueryMatch: boolean;
  preferredDomainMatch: boolean;
  hasBrandHint: boolean;
  hasArticleHint: boolean;
  sourceHost: string;
}

function getRelevanceSignals(
  image: UnsplashImage,
  contextTokens: Set<string>,
  preferredDomains: Set<string>
): RelevanceSignals {
  const haystackTokens = tokenSetFromImage(image);
  const queryTokenSet = new Set(tokenize(image.matchedQuery || ""));
  const queryOverlap = countOverlap(queryTokenSet, haystackTokens);
  const contextOverlap = countOverlap(contextTokens, haystackTokens);
  const normalizedQuery = normalizeSpaces((image.matchedQuery || "").toLowerCase());
  const normalizedText = normalizeSpaces(
    [image.alt, image.sourceName || "", image.sourceUrl || "", image.photographer].join(" ")
      .toLowerCase()
  );
  const exactQueryMatch = normalizedQuery.length >= 3 && normalizedText.includes(normalizedQuery);
  const sourceHost = normalizeHostname(getHostname(image.sourceUrl || image.photographerUrl));
  const preferredDomainMatch = matchesPreferredDomain(sourceHost, preferredDomains);

  return {
    queryOverlap,
    contextOverlap,
    exactQueryMatch,
    preferredDomainMatch,
    hasBrandHint: hasHint(image, BRAND_HINTS),
    hasArticleHint: hasHint(image, ARTICLE_HINTS),
    sourceHost,
  };
}

function scoreImage(
  image: UnsplashImage,
  queryPriority: Map<string, number>,
  signals: RelevanceSignals
): number {
  const normalizedMatchedQuery = normalizeSpaces((image.matchedQuery || "").toLowerCase());
  const queryPriorityScore = queryPriority.get(normalizedMatchedQuery) ?? 16;
  const providerScore = image.provider === "brave" ? 8 : 6;
  const queryOverlapScore = signals.queryOverlap * 24;
  const exactQueryScore = signals.exactQueryMatch ? 20 : 0;
  const contextScore = Math.min(3, signals.contextOverlap) * 5;
  const preferredDomainScore = signals.preferredDomainMatch ? 18 : 0;
  const articleScore = signals.hasArticleHint ? 6 : 0;
  const brandScore = signals.hasBrandHint ? 5 : 0;

  return (
    queryPriorityScore +
    providerScore +
    queryOverlapScore +
    exactQueryScore +
    contextScore +
    preferredDomainScore +
    articleScore +
    brandScore
  );
}

function isStronglyRelevant(image: UnsplashImage, signals: RelevanceSignals): boolean {
  if (isBlockedSourceHost(signals.sourceHost)) return false;
  if (signals.queryOverlap >= 1 || signals.exactQueryMatch) return true;
  if (signals.preferredDomainMatch && signals.contextOverlap >= 1) return true;
  if (image.provider === "unsplash" && signals.contextOverlap >= 2) return true;
  return false;
}

function mapBraveImage(query: string, item: BraveImageResult): UnsplashImage | null {
  const imageUrl = safeUrl(item.properties?.url) || safeUrl(item.thumbnail?.src);
  if (!imageUrl) return null;

  const sourceUrl = safeUrl(item.url) || imageUrl;
  const sourceName = normalizeSpaces(item.source || getHostname(sourceUrl) || "web");
  const title = normalizeSpaces(item.title || query);

  return {
    id: `brave-${createStableId(`${imageUrl}|${sourceUrl}|${query}`)}`,
    url: imageUrl,
    thumbUrl: safeUrl(item.thumbnail?.src) || imageUrl,
    downloadUrl: imageUrl,
    alt: title || query,
    photographer: sourceName,
    photographerUrl: sourceUrl,
    provider: "brave",
    sourceName,
    sourceUrl,
    matchedQuery: query,
  };
}

async function searchBraveImages(query: string, apiKey: string): Promise<UnsplashImage[]> {
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=8&search_lang=ko&safesearch=strict`,
      {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
      }
    );

    if (!res.ok) return [];

    const data = (await res.json()) as BraveImageResponse;
    if (data.extra?.might_be_offensive) return [];
    const results = Array.isArray(data.results) ? data.results : [];

    return results
      .map((item) => mapBraveImage(query, item))
      .filter((image): image is UnsplashImage => image !== null);
  } catch {
    return [];
  }
}

async function searchUnsplashImages(
  query: string,
  accessKey: string
): Promise<UnsplashImage[]> {
  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=8&orientation=landscape`,
      {
        headers: {
          Authorization: `Client-ID ${accessKey}`,
        },
      }
    );

    if (!res.ok) return [];

    const data = (await res.json()) as UnsplashSearchResponse;
    const results = Array.isArray(data.results) ? data.results : [];
    const mapped: UnsplashImage[] = [];

    for (const photo of results) {
      const imageUrl = safeUrl(photo.urls?.regular);
      if (!imageUrl) continue;

      const thumbUrl = safeUrl(photo.urls?.small) || imageUrl;
      const downloadUrl = safeUrl(photo.links?.download) || imageUrl;
      const photographer = normalizeSpaces(photo.user?.name || "Unsplash");
      const photographerUrl = safeUrl(photo.user?.links?.html) || "https://unsplash.com";

      mapped.push({
        id: photo.id,
        url: imageUrl,
        thumbUrl,
        downloadUrl,
        alt: normalizeSpaces(photo.alt_description || photo.description || query),
        photographer,
        photographerUrl,
        provider: "unsplash",
        sourceName: "Unsplash",
        sourceUrl: "https://unsplash.com",
        matchedQuery: query,
      });
    }

    return mapped;
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const query = normalizeSpaces(req.nextUrl.searchParams.get("query") || "");
  if (!query) {
    return NextResponse.json(
      { error: "query is required" },
      { status: 400 }
    );
  }

  const queries = splitQueries(query, req.nextUrl.searchParams.get("queries"));
  const context = normalizeSpaces(req.nextUrl.searchParams.get("context") || "");
  const preferredDomains = parsePreferredDomains(
    req.nextUrl.searchParams.get("preferredDomains")
  );

  const accessKey =
    process.env.UNSPLASH_ACCESS_KEY ||
    process.env.NEXT_PUBLIC_UNSPLASH_ACCESS_KEY;
  const braveApiKey = process.env.BRAVE_API_KEY;

  if (!accessKey && !braveApiKey) {
    return NextResponse.json(
      { error: "No image provider key configured" },
      { status: 500 }
    );
  }

  try {
    const braveSearches = braveApiKey
      ? queries.map((item) => searchBraveImages(item, braveApiKey))
      : [];
    const unsplashSearches =
      accessKey && accessKey.trim().length > 0
        ? queries.slice(0, 2).map((item) => searchUnsplashImages(item, accessKey))
        : [];

    const [braveResultSets, unsplashResultSets] = await Promise.all([
      Promise.all(braveSearches),
      Promise.all(unsplashSearches),
    ]);

    const merged = [...braveResultSets.flat(), ...unsplashResultSets.flat()];
    const deduped: UnsplashImage[] = [];
    const seen = new Set<string>();

    for (const image of merged) {
      const key = normalizeByProvider(image);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(image);
    }

    const contextTokens = new Set(tokenize([query, ...queries, context].join(" ")));
    const queryPriority = new Map<string, number>();
    queries.forEach((item, index) => {
      const key = normalizeSpaces(item.toLowerCase());
      queryPriority.set(key, Math.max(20, 92 - index * 12));
    });

    const scoredImages = deduped.map((image) => {
      const normalizedMatchedQuery = normalizeSpaces(
        (image.matchedQuery || "").toLowerCase()
      );
      const normalizedImage: UnsplashImage = {
        ...image,
        matchedQuery: normalizedMatchedQuery || image.matchedQuery,
      };
      const signals = getRelevanceSignals(
        normalizedImage,
        contextTokens,
        preferredDomains
      );

      return {
        ...normalizedImage,
        relevanceScore: scoreImage(normalizedImage, queryPriority, signals),
        _signals: signals,
      };
    });

    const strictCandidates = scoredImages.filter((item) =>
      isStronglyRelevant(item, item._signals)
    );
    const relaxedCandidates = scoredImages.filter(
      (item) =>
        item._signals.queryOverlap >= 1 ||
        item._signals.contextOverlap >= 1 ||
        item._signals.preferredDomainMatch
    );
    const baselineCandidates = scoredImages.filter(
      (item) => !isBlockedSourceHost(item._signals.sourceHost)
    );

    const selectedPool =
      strictCandidates.length >= 3
        ? strictCandidates
        : relaxedCandidates.length >= 3
          ? relaxedCandidates
          : baselineCandidates.length > 0
            ? baselineCandidates
            : scoredImages;

    const rankedImages = selectedPool
      .sort((a, b) => {
        const scoreGap = (b.relevanceScore || 0) - (a.relevanceScore || 0);
        if (scoreGap !== 0) return scoreGap;
        if (a.provider !== b.provider) {
          return a.provider === "brave" ? -1 : 1;
        }
        return 0;
      })
      .slice(0, 12)
      .map(({ _signals, ...image }) => image);

    return NextResponse.json({ images: rankedImages });
  } catch (error) {
    console.error("Image search error:", error);
    return NextResponse.json({ images: [] });
  }
}
