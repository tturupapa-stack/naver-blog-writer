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

function normalizeByProvider(image: UnsplashImage): string {
  if (image.provider === "brave") {
    return (image.sourceUrl || image.url).split("?")[0];
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

function scoreImage(
  image: UnsplashImage,
  contextTokens: Set<string>,
  queryPriority: Map<string, number>
): number {
  const haystackTokens = new Set(
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

  let overlap = 0;
  for (const token of contextTokens) {
    if (haystackTokens.has(token)) overlap += 1;
  }

  const normalizedMatchedQuery = normalizeSpaces((image.matchedQuery || "").toLowerCase());
  const queryScore = queryPriority.get(normalizedMatchedQuery) ?? 18;
  const providerScore = image.provider === "brave" ? 35 : 12;
  const articleScore = hasHint(image, ARTICLE_HINTS) ? 14 : 0;
  const brandScore = hasHint(image, BRAND_HINTS) ? 10 : 0;

  return queryScore + providerScore + overlap * 6 + articleScore + brandScore;
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
      `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=10&search_lang=ko`,
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

    const rankedImages = deduped
      .map((image) => {
        const normalizedMatchedQuery = normalizeSpaces(
          (image.matchedQuery || "").toLowerCase()
        );
        return {
          ...image,
          relevanceScore: scoreImage(image, contextTokens, queryPriority),
          matchedQuery: normalizedMatchedQuery || image.matchedQuery,
        };
      })
      .sort((a, b) => {
        const scoreGap = (b.relevanceScore || 0) - (a.relevanceScore || 0);
        if (scoreGap !== 0) return scoreGap;
        if (a.provider !== b.provider) {
          return a.provider === "brave" ? -1 : 1;
        }
        return 0;
      })
      .slice(0, 15);

    return NextResponse.json({ images: rankedImages });
  } catch (error) {
    console.error("Image search error:", error);
    return NextResponse.json({ images: [] });
  }
}
