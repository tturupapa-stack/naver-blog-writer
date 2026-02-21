import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { buildCompliancePrompt, buildDraftPrompt } from "@/lib/prompts";
import { buildNaverHtml } from "@/lib/naver-html";
import { reviewGeneratedContent } from "@/lib/content-review";
import {
  GenerateRequest,
  ReviewReport,
  ToneType,
  UnsplashImage,
  SearchResult,
} from "@/lib/types";

export const maxDuration = 60;
const PIPELINE_VERSION = "v3-depth-boost";
const DRAFT_CANDIDATE_COUNT = 3;
const MAX_COMPLIANCE_PASSES = 3;
const MIN_NATURALNESS_TARGET = 72;
const SOFT_FOCUS_LIMIT = 4;
const DEFAULT_TEXT_MODEL = "gpt-4o";
const MIN_SECTION_TARGET = 5;
const MIN_BODY_CHAR_TARGET = 2200;
const DEPTH_FIX_HINTS = [
  "본문 길이",
  "구체성/맥락 표현",
  "소제목 개수",
  "SEO: 소제목 키워드 반영",
] as const;
const STYLE_FIX_HINTS = [
  "번역투 표현 점검",
  "AI 티 문체 점검",
  "문장 리듬 다양성",
  "구체성/맥락 표현",
] as const;

interface RawParsedBlog {
  title?: string;
  sections?: { heading?: string; body?: string; tip?: string | null }[];
  tags?: string[];
  imageKeywords?: string[];
  voiceAnchor?: string[];
}

interface ParsedBlog {
  title: string;
  sections: { heading?: string; body: string; tip?: string | null }[];
  tags: string[];
  imageKeywords: string[];
  voiceAnchor: string[];
}

interface Candidate {
  parsed: ParsedBlog;
  sections: { heading?: string; body: string; tip?: string }[];
  review: ReviewReport;
  contentText: string;
  changeRatio: number;
  sectionCount: number;
  bodyCharCount: number;
  depthSatisfied: boolean;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean).map((v) => v.trim()).filter(Boolean)));
}

function sanitizeModelId(value: string | null | undefined): string {
  const normalized = (value || "").trim();
  if (!normalized) return "";
  return normalized.replace(/\s+/g, "");
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

function isModelSelectionError(error: unknown): boolean {
  const errorLike =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : null;
  const status = typeof errorLike?.status === "number" ? errorLike.status : null;
  const code =
    typeof errorLike?.code === "string"
      ? errorLike.code
      : typeof (errorLike?.error as Record<string, unknown> | undefined)?.code === "string"
        ? ((errorLike?.error as Record<string, unknown>).code as string)
        : "";
  const message = extractErrorMessage(error).toLowerCase();
  const normalizedCode = code.toLowerCase();

  return (
    status === 404 ||
    normalizedCode.includes("model") ||
    message.includes("model") ||
    message.includes("does not exist") ||
    message.includes("not found") ||
    message.includes("unsupported")
  );
}

type ChatCreateParams = Omit<
  OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  "model"
>;

async function createChatCompletionWithFallback(params: {
  openai: OpenAI;
  request: ChatCreateParams;
  preferredModel: string;
}): Promise<{ completion: OpenAI.Chat.Completions.ChatCompletion; usedModel: string }> {
  const { openai, request, preferredModel } = params;
  const normalizedPreferredModel =
    sanitizeModelId(preferredModel) || DEFAULT_TEXT_MODEL;
  const candidateModels =
    normalizedPreferredModel === DEFAULT_TEXT_MODEL
      ? [normalizedPreferredModel]
      : [normalizedPreferredModel, DEFAULT_TEXT_MODEL];

  let lastError: unknown = null;

  for (const candidateModel of candidateModels) {
    try {
      const completion = await openai.chat.completions.create({
        model: candidateModel,
        ...request,
      });
      return { completion, usedModel: candidateModel };
    } catch (error) {
      lastError = error;
      const allowFallback =
        candidateModel !== DEFAULT_TEXT_MODEL && isModelSelectionError(error);
      if (!allowFallback) {
        throw error;
      }
      console.warn("[generate.model.fallback]", {
        requestedModel: normalizedPreferredModel,
        fallbackModel: DEFAULT_TEXT_MODEL,
        reason: extractErrorMessage(error),
      });
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("모델 호출에 실패했습니다. 잠시 후 다시 시도해주세요.");
}

function buildFallbackTags(keyword: string): string[] {
  const key = keyword.replace(/\s+/g, " ").trim();
  return [key, `${key}추천`, `${key}팁`, `${key}정리`, `${key}가이드`];
}

function safeParsedBlog(raw: RawParsedBlog, keyword: string): ParsedBlog {
  const fallbackTitle = `${keyword} 실제 사용 기준 정리`;
  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];

  const sections = rawSections
    .map((section) => ({
      heading: section?.heading?.trim() || undefined,
      body: section?.body?.trim() || "",
      tip: section?.tip?.trim() || null,
    }))
    .filter((section) => section.body.length > 0)
    .slice(0, 6);

  const voiceAnchor = uniqueStrings(Array.isArray(raw.voiceAnchor) ? raw.voiceAnchor : []).slice(
    0,
    3
  );

  const fallbackTags = buildFallbackTags(keyword);
  let tags = uniqueStrings([
    ...(Array.isArray(raw.tags) ? raw.tags : []),
    ...fallbackTags,
  ]).slice(0, 8);
  while (tags.length < 5) {
    tags.push(`${keyword}핵심${tags.length + 1}`);
  }

  const imageKeywords = uniqueStrings(
    Array.isArray(raw.imageKeywords) ? raw.imageKeywords : []
  ).slice(0, 5);

  return {
    title: raw.title?.trim() || fallbackTitle,
    sections,
    tags,
    imageKeywords: imageKeywords.length > 0 ? imageKeywords : [keyword],
    voiceAnchor:
      voiceAnchor.length > 0
        ? voiceAnchor
        : [`${keyword}를 고를 때 실제 사용 맥락을 기준으로 비교해보면 판단이 쉬워집니다.`],
  };
}

function applyMinimalHardFixes(parsed: ParsedBlog, keyword: string): ParsedBlog {
  const fixed: ParsedBlog = {
    ...parsed,
    sections: [...parsed.sections],
    tags: [...parsed.tags],
    voiceAnchor: [...parsed.voiceAnchor],
  };

  if (!fixed.title.includes(keyword)) {
    fixed.title = `${keyword} ${fixed.title}`.trim();
  }

  if (fixed.sections.length > 0 && !fixed.sections[0].body.includes(keyword)) {
    fixed.sections[0] = {
      ...fixed.sections[0],
      body: `${keyword}를 찾는 분들이 가장 많이 묻는 기준부터 짚어볼게요.\n${fixed.sections[0].body}`,
    };
  }

  const fallbackTags = buildFallbackTags(keyword);
  fixed.tags = uniqueStrings([...fixed.tags, ...fallbackTags]).slice(0, 8);
  while (fixed.tags.length < 5) {
    fixed.tags.push(`${keyword}팁${fixed.tags.length + 1}`);
  }

  return fixed;
}

function parseJsonFromModel(rawContent: string): RawParsedBlog {
  const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("AI 응답을 파싱할 수 없습니다. 다시 시도해주세요.");
  }
  return JSON.parse(jsonMatch[0]) as RawParsedBlog;
}

function serializeBlog(parsed: ParsedBlog): string {
  const sectionText = parsed.sections
    .map((section) =>
      [section.heading || "", section.body, section.tip || ""].filter(Boolean).join("\n")
    )
    .join("\n\n");

  return [
    parsed.title,
    sectionText,
    parsed.tags.join(" "),
    parsed.voiceAnchor.join(" "),
  ]
    .filter(Boolean)
    .join("\n");
}

function tokenBag(text: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const token of text
    .toLowerCase()
    .split(/[\s,.;:!?()\[\]{}"'`~]+/)
    .map((part) => part.trim())
    .filter(Boolean)) {
    map.set(token, (map.get(token) ?? 0) + 1);
  }
  return map;
}

function textChangeRatio(before: string, after: string): number {
  if (!before || !after) return 1;
  if (before === after) return 0;

  const beforeBag = tokenBag(before);
  const afterBag = tokenBag(after);

  let beforeCount = 0;
  let afterCount = 0;
  let overlap = 0;

  for (const count of beforeBag.values()) beforeCount += count;
  for (const count of afterBag.values()) afterCount += count;

  for (const [token, beforeTokenCount] of beforeBag.entries()) {
    const afterTokenCount = afterBag.get(token) ?? 0;
    overlap += Math.min(beforeTokenCount, afterTokenCount);
  }

  const denominator = Math.max(beforeCount, afterCount, 1);
  return 1 - overlap / denominator;
}

function summarizeDepth(parsed: ParsedBlog): {
  sectionCount: number;
  bodyCharCount: number;
  depthSatisfied: boolean;
} {
  const sectionCount = parsed.sections.length;
  const bodyCharCount = parsed.sections.reduce(
    (sum, section) => sum + section.body.replace(/\s+/g, " ").trim().length,
    0
  );

  return {
    sectionCount,
    bodyCharCount,
    depthSatisfied:
      sectionCount >= MIN_SECTION_TARGET && bodyCharCount >= MIN_BODY_CHAR_TARGET,
  };
}

function makeCandidate(
  parsed: ParsedBlog,
  keyword: string,
  tone: ToneType,
  previousContent = ""
): Candidate {
  const sections = parsed.sections.map((section) => ({
    heading: section.heading,
    body: section.body,
    tip: section.tip || undefined,
  }));

  const review = reviewGeneratedContent({
    keyword,
    title: parsed.title,
    sections,
    tags: parsed.tags,
    tone,
  });

  const contentText = serializeBlog(parsed);
  const depth = summarizeDepth(parsed);

  return {
    parsed,
    sections,
    review,
    contentText,
    changeRatio: previousContent ? textChangeRatio(previousContent, contentText) : 0,
    sectionCount: depth.sectionCount,
    bodyCharCount: depth.bodyCharCount,
    depthSatisfied: depth.depthSatisfied,
  };
}

function betterCandidate(current: Candidate | null, candidate: Candidate): Candidate {
  if (!current) return candidate;

  if (current.review.hardPass !== candidate.review.hardPass) {
    return candidate.review.hardPass ? candidate : current;
  }

  if (!current.review.hardPass && !candidate.review.hardPass) {
    if (candidate.review.hardFailLabels.length !== current.review.hardFailLabels.length) {
      return candidate.review.hardFailLabels.length < current.review.hardFailLabels.length
        ? candidate
        : current;
    }
  }

  if (current.depthSatisfied !== candidate.depthSatisfied) {
    return candidate.depthSatisfied ? candidate : current;
  }

  if (!current.depthSatisfied && !candidate.depthSatisfied) {
    if (candidate.sectionCount !== current.sectionCount) {
      return candidate.sectionCount > current.sectionCount ? candidate : current;
    }
    if (candidate.bodyCharCount !== current.bodyCharCount) {
      return candidate.bodyCharCount > current.bodyCharCount ? candidate : current;
    }
  }

  if (candidate.review.selectionScore !== current.review.selectionScore) {
    return candidate.review.selectionScore > current.review.selectionScore
      ? candidate
      : current;
  }

  if (current.review.hardPass && candidate.review.hardPass) {
    if (candidate.changeRatio !== current.changeRatio) {
      return candidate.changeRatio < current.changeRatio ? candidate : current;
    }
  }

  if (candidate.review.naturalnessScore !== current.review.naturalnessScore) {
    return candidate.review.naturalnessScore > current.review.naturalnessScore
      ? candidate
      : current;
  }

  return current;
}

function buildAutoDepthFixHints(candidate: Candidate): string[] {
  if (candidate.depthSatisfied) return [];

  const hints: string[] = [];
  if (candidate.sectionCount < MIN_SECTION_TARGET) {
    hints.push("소제목 개수");
    hints.push("SEO: 소제목 키워드 반영");
  }
  if (candidate.bodyCharCount < MIN_BODY_CHAR_TARGET) {
    hints.push("본문 길이");
    hints.push("구체성/맥락 표현");
  }

  const lengthWarn = candidate.review.items.some(
    (item) => item.label === "본문 길이" && item.status === "warn"
  );
  if (lengthWarn) {
    hints.push("본문 길이");
  }

  return uniqueStrings([...DEPTH_FIX_HINTS, ...hints]);
}

function buildAutoStyleFixHints(review: ReviewReport): string[] {
  const warnLabels = review.items
    .filter(
      (item) =>
        item.status === "warn" &&
        STYLE_FIX_HINTS.some((label) => label === item.label)
    )
    .map((item) => item.label);

  if (review.naturalnessScore < MIN_NATURALNESS_TARGET) {
    return uniqueStrings([...warnLabels, ...STYLE_FIX_HINTS]);
  }

  return uniqueStrings(warnLabels);
}

function pickSoftFocusLabels(review: ReviewReport): string[] {
  const naturalnessWarns = review.items
    .filter(
      (item) =>
        item.status === "warn" &&
        !item.isHard &&
        (item.bucket === "naturalness" || item.bucket === "complianceSoft")
    )
    .map((item) => item.label);

  const seoWarns = review.items
    .filter((item) => item.status === "warn" && !item.isHard && item.bucket === "seo")
    .map((item) => item.label);

  return uniqueStrings([...naturalnessWarns, ...seoWarns]).slice(0, SOFT_FOCUS_LIMIT);
}

function requestedHintsSatisfied(review: ReviewReport, requestedFixHints: string[]): boolean {
  if (requestedFixHints.length === 0) return true;

  const statusMap = new Map(review.items.map((item) => [item.label, item.status]));
  return requestedFixHints.every((hint) => statusMap.get(hint) !== "warn");
}

const IMAGE_QUERY_STOPWORDS = new Set([
  "image",
  "photo",
  "article",
  "official",
  "review",
  "news",
  "사진",
  "이미지",
  "기사",
  "공식",
  "리뷰",
  "뉴스",
  "가이드",
  "추천",
  "정리",
]);

const ARTICLE_IMAGE_BLOCKED_HOSTS = [
  "youtube.com",
  "youtu.be",
  "instagram.com",
  "facebook.com",
  "tiktok.com",
  "pinterest.com",
  "reddit.com",
];
const ARTICLE_FETCH_TIMEOUT_MS = 4500;
const ARTICLE_HTML_MAX_LENGTH = 200_000;

interface ImagesApiResponse {
  images?: UnsplashImage[];
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeImageQuery(value: string): string {
  const cleaned = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\([^)]*\)/g, " ");

  const withoutPipe = cleaned.split(/[|｜]/)[0] || cleaned;
  const withoutDashTail = withoutPipe.split(/\s[-–—]\s/)[0] || withoutPipe;
  return normalizeText(withoutDashTail).slice(0, 64).trim();
}

function createStableId(seed: string): string {
  let hash = 0;
  for (let idx = 0; idx < seed.length; idx++) {
    hash = (hash << 5) - hash + seed.charCodeAt(idx);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function isMeaningfulImageQuery(query: string): boolean {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9가-힣]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !IMAGE_QUERY_STOPWORDS.has(token));
  return tokens.length > 0;
}

function isBlockedArticleHost(hostname: string): boolean {
  if (!hostname) return true;
  return ARTICLE_IMAGE_BLOCKED_HOSTS.some(
    (blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`)
  );
}

function decodeHtmlEntity(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractMetaContent(html: string, keys: string[]): string {
  const normalizedKeys = new Set(keys.map((key) => key.toLowerCase()));
  const tags = html.match(/<meta\s+[^>]*>/gi) || [];

  for (const tag of tags) {
    const attrs = Array.from(
      tag.matchAll(/([a-zA-Z_:.-]+)\s*=\s*["']([^"']*)["']/g)
    );
    let metaKey = "";
    let content = "";

    for (const attr of attrs) {
      const attrName = attr[1].toLowerCase();
      const attrValue = decodeHtmlEntity(attr[2].trim());
      if ((attrName === "property" || attrName === "name" || attrName === "itemprop") && attrValue) {
        metaKey = attrValue.toLowerCase();
      }
      if (attrName === "content" && attrValue) {
        content = attrValue;
      }
    }

    if (metaKey && content && normalizedKeys.has(metaKey)) {
      return content;
    }
  }

  return "";
}

function resolveUrl(urlLike: string, baseUrl: string): string {
  if (!urlLike) return "";
  try {
    const resolved = new URL(urlLike, baseUrl).toString();
    if (!/^https?:\/\//i.test(resolved)) return "";
    return resolved;
  } catch {
    return "";
  }
}

function looksLikeBrandOrProduct(query: string): boolean {
  const normalized = query.toLowerCase();
  if (/[a-z]{3,}/.test(normalized)) return true;
  if (/[0-9]/.test(normalized) && /[a-z가-힣]/.test(normalized)) return true;
  if (/(아이폰|갤럭시|맥북|애플|삼성|소니|테슬라|스타벅스|나이키|아디다스)/.test(normalized)) {
    return true;
  }
  return false;
}

function buildImageQueries(params: {
  keyword: string;
  parsed: ParsedBlog;
}): string[] {
  const { keyword, parsed } = params;
  const normalizedKeyword = sanitizeImageQuery(keyword);

  const modelQueries = uniqueStrings(
    parsed.imageKeywords.map((imageKeyword) => sanitizeImageQuery(imageKeyword))
  )
    .filter((query) => isMeaningfulImageQuery(query))
    .slice(0, 3);

  const baseQueries = uniqueStrings([
    ...modelQueries,
    normalizedKeyword,
  ]).slice(0, 3);

  const queryAnchor = baseQueries[0] || normalizedKeyword;
  const preferBrandStyle =
    looksLikeBrandOrProduct(normalizedKeyword) ||
    modelQueries.some((query) => looksLikeBrandOrProduct(query));

  const extraQueries = preferBrandStyle
    ? [`${queryAnchor} 공식 이미지`, `${queryAnchor} 리뷰 기사 사진`]
    : [`${normalizedKeyword} 기사 사진`, `${normalizedKeyword} 실제 장면 사진`];

  return uniqueStrings([...baseQueries, ...extraQueries])
    .filter((query) => isMeaningfulImageQuery(query))
    .slice(0, 4);
}

function buildImageContext(params: {
  keyword: string;
  parsed: ParsedBlog;
  searchResults: SearchResult[];
}): string {
  const sectionSnippets = params.parsed.sections
    .slice(0, 3)
    .map((section) => sanitizeImageQuery(`${section.heading || ""} ${section.body}`))
    .filter(Boolean);

  const searchSnippets = params.searchResults
    .slice(0, 3)
    .map((result) => sanitizeImageQuery(result.title))
    .filter(Boolean);

  return normalizeText(
    [params.keyword, params.parsed.title, ...sectionSnippets, ...searchSnippets].join(" | ")
  ).slice(0, 900);
}

function hostnameFromUrl(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

async function fetchArticleImageFromSearchResult(
  result: SearchResult,
  keyword: string
): Promise<UnsplashImage | null> {
  const sourceUrl = result.url?.trim();
  if (!sourceUrl) return null;

  const sourceHost = hostnameFromUrl(sourceUrl);
  if (!sourceHost || isBlockedArticleHost(sourceHost)) return null;

  try {
    const response = await fetch(sourceUrl, {
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(ARTICLE_FETCH_TIMEOUT_MS),
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "accept-language": "ko,en;q=0.8",
      },
    });

    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("text/html")) return null;

    const html = (await response.text()).slice(0, ARTICLE_HTML_MAX_LENGTH);
    const rawImage =
      extractMetaContent(html, ["og:image", "og:image:url"]) ||
      extractMetaContent(html, ["twitter:image", "twitter:image:src"]) ||
      extractMetaContent(html, ["image"]);
    const imageUrl = resolveUrl(rawImage, response.url || sourceUrl);
    if (!imageUrl || imageUrl.toLowerCase().endsWith(".svg")) return null;

    const metaTitle =
      extractMetaContent(html, ["og:title", "twitter:title"]) || result.title || keyword;
    const alt = sanitizeImageQuery(metaTitle) || sanitizeImageQuery(result.title) || keyword;
    const stableSeed = `${sourceUrl}|${imageUrl}`;

    return {
      id: `article-${createStableId(stableSeed)}`,
      url: imageUrl,
      thumbUrl: imageUrl,
      downloadUrl: imageUrl,
      alt,
      photographer: sourceHost,
      photographerUrl: sourceUrl,
      provider: "brave",
      sourceName: sourceHost,
      sourceUrl,
      matchedQuery: sanitizeImageQuery(keyword),
      relevanceScore: 320,
    };
  } catch {
    return null;
  }
}

async function fetchArticleImagesFromSearchResults(
  searchResults: SearchResult[],
  keyword: string
): Promise<UnsplashImage[]> {
  const targets = searchResults.slice(0, 4);
  const results = await Promise.all(
    targets.map((item) => fetchArticleImageFromSearchResult(item, keyword))
  );
  return results.filter((item): item is UnsplashImage => item !== null);
}

function pickTopRelevantImages(
  images: UnsplashImage[],
  limit: number,
  preferredDomains: string[]
): UnsplashImage[] {
  if (images.length === 0 || limit <= 0) return [];

  const preferredDomainSet = new Set(preferredDomains);
  const sorted = [...images].sort((a, b) => {
    const aHost = hostnameFromUrl(a.sourceUrl || a.photographerUrl);
    const bHost = hostnameFromUrl(b.sourceUrl || b.photographerUrl);
    const aPreferred = preferredDomainSet.has(aHost) ? 1 : 0;
    const bPreferred = preferredDomainSet.has(bHost) ? 1 : 0;
    if (aPreferred !== bPreferred) return bPreferred - aPreferred;
    return (b.relevanceScore || 0) - (a.relevanceScore || 0);
  });

  const selected: UnsplashImage[] = [];
  const usedImageUrls = new Set<string>();

  for (const image of sorted) {
    if (selected.length >= limit) break;
    const imageUrlKey = (image.url || image.id).split("?")[0];
    if (!imageUrlKey || usedImageUrls.has(imageUrlKey)) continue;
    const host = hostnameFromUrl(image.sourceUrl || image.photographerUrl);
    const minimumScore = preferredDomainSet.has(host) ? 90 : 130;
    if ((image.relevanceScore || 0) < minimumScore) continue;
    selected.push(image);
    usedImageUrls.add(imageUrlKey);
  }

  return selected;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { keyword, tone, fixHints, model } = body as GenerateRequest;

    if (!keyword?.trim()) {
      return NextResponse.json({ error: "키워드를 입력해주세요." }, { status: 400 });
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY가 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    let searchContext = "";
    let searchResults: SearchResult[] = [];
    try {
      const origin = req.nextUrl.origin;
      const searchRes = await fetch(
        `${origin}/api/search?keyword=${encodeURIComponent(keyword)}`
      );
      const searchData = (await searchRes.json()) as { results?: SearchResult[] };
      if (Array.isArray(searchData.results) && searchData.results.length > 0) {
        searchResults = searchData.results.slice(0, 5);
        searchContext = searchResults
          .map((result: SearchResult) => `- ${result.title}: ${result.description}`)
          .join("\n");
      }
    } catch {
      // Search is optional
    }

    const openai = new OpenAI({ apiKey: openaiKey });
    const selectedTone = tone ?? ("experience" as ToneType);
    const requestedFixHints = uniqueStrings(fixHints || []);
    const selectedModel =
      sanitizeModelId(model) ||
      sanitizeModelId(process.env.OPENAI_TEXT_MODEL) ||
      DEFAULT_TEXT_MODEL;
    let usedModel = selectedModel;

    const draftPrompt = buildDraftPrompt({
      keyword,
      tone: selectedTone,
      searchContext,
    });

    const draftResult = await createChatCompletionWithFallback({
      openai,
      preferredModel: usedModel,
      request: {
        messages: [{ role: "user", content: draftPrompt }],
        n: DRAFT_CANDIDATE_COUNT,
        temperature: 0.72,
        top_p: 0.95,
        frequency_penalty: 0.3,
        presence_penalty: 0.2,
        max_tokens: 4000,
      },
    });
    const draftCompletion = draftResult.completion;
    usedModel = draftResult.usedModel;

    let bestCandidate: Candidate | null = null;

    for (const choice of draftCompletion.choices) {
      const rawContent = choice.message?.content;
      if (!rawContent || typeof rawContent !== "string") continue;

      try {
        const parsed = applyMinimalHardFixes(
          safeParsedBlog(parseJsonFromModel(rawContent), keyword),
          keyword
        );
        const candidate = makeCandidate(parsed, keyword, selectedTone);
        bestCandidate = betterCandidate(bestCandidate, candidate);
      } catch {
        // Skip unparsable candidate and keep other candidates
      }
    }

    if (!bestCandidate) {
      return NextResponse.json(
        { error: "AI 응답을 파싱할 수 없습니다. 다시 시도해주세요." },
        { status: 500 }
      );
    }

    let compliancePasses = 0;

    for (let pass = 0; pass < MAX_COMPLIANCE_PASSES; pass++) {
      const autoDepthFixHints = buildAutoDepthFixHints(bestCandidate);
      const autoStyleFixHints = buildAutoStyleFixHints(bestCandidate.review);
      const effectiveFixHints = uniqueStrings([
        ...requestedFixHints,
        ...autoDepthFixHints,
        ...autoStyleFixHints,
      ]);

      const shouldFixHard = !bestCandidate.review.hardPass;
      const shouldFixRequested = !requestedHintsSatisfied(
        bestCandidate.review,
        effectiveFixHints
      );
      const shouldBoostNaturalness =
        bestCandidate.review.naturalnessScore < MIN_NATURALNESS_TARGET ||
        autoStyleFixHints.length > 0;
      const shouldBoostDepth = autoDepthFixHints.length > 0;

      if (
        !shouldFixHard &&
        !shouldFixRequested &&
        !shouldBoostNaturalness &&
        !shouldBoostDepth
      ) {
        break;
      }

      compliancePasses += 1;

      const compliancePrompt = buildCompliancePrompt({
        keyword,
        tone: selectedTone,
        searchContext,
        previousJson: JSON.stringify(bestCandidate.parsed),
        hardFailLabels: bestCandidate.review.hardFailLabels,
        softFocusLabels: pickSoftFocusLabels(bestCandidate.review),
        requestedFixHints: effectiveFixHints,
        allowExpansion: shouldBoostDepth,
      });

      try {
        const refinedResult = await createChatCompletionWithFallback({
          openai,
          preferredModel: usedModel,
          request: {
            messages: [{ role: "user", content: compliancePrompt }],
            temperature: 0.25,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
            max_tokens: 4000,
          },
        });
        const refinedCompletion = refinedResult.completion;
        usedModel = refinedResult.usedModel;

        const refinedContent = refinedCompletion.choices[0]?.message?.content;
        if (!refinedContent || typeof refinedContent !== "string") {
          continue;
        }

        const refinedParsed = applyMinimalHardFixes(
          safeParsedBlog(parseJsonFromModel(refinedContent), keyword),
          keyword
        );

        const refinedCandidate = makeCandidate(
          refinedParsed,
          keyword,
          selectedTone,
          bestCandidate.contentText
        );

        bestCandidate = betterCandidate(bestCandidate, refinedCandidate);
      } catch {
        // Keep the best existing candidate if compliance pass fails
      }
    }

    const parsed = bestCandidate.parsed;
    const review = bestCandidate.review;
    const sections = bestCandidate.sections;

    const imageQueries = buildImageQueries({ keyword, parsed });
    const imageContext = buildImageContext({ keyword, parsed, searchResults });
    const preferredDomains = uniqueStrings(
      searchResults
        .map((result) => hostnameFromUrl(result.url))
        .filter(Boolean)
    ).slice(0, 5);
    const allImages: UnsplashImage[] = [];
    const seenImageKeys = new Set<string>();

    const pushUniqueImages = (images: UnsplashImage[]) => {
      for (const image of images) {
        const imageKey = `${image.provider || "unsplash"}:${(image.url || image.id).split("?")[0]}`;
        if (!imageKey || seenImageKeys.has(imageKey)) continue;
        seenImageKeys.add(imageKey);
        allImages.push(image);
      }
    };

    const articleImages = await fetchArticleImagesFromSearchResults(
      searchResults,
      keyword
    );
    pushUniqueImages(articleImages);

    try {
      const origin = req.nextUrl.origin;
      const params = new URLSearchParams({
        query: imageQueries[0] || keyword,
        queries: imageQueries.join("||"),
        context: imageContext,
      });
      if (preferredDomains.length > 0) {
        params.set("preferredDomains", preferredDomains.join("||"));
      }
      const imageRes = await fetch(`${origin}/api/images?${params.toString()}`);
      const imageData = (await imageRes.json()) as ImagesApiResponse;
      pushUniqueImages(imageData.images || []);

    } catch {
      // Images are optional
    }

    allImages.sort(
      (a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0)
    );

    const selectedImages = pickTopRelevantImages(allImages, 3, preferredDomains);
    const thumbnail = selectedImages[0] || allImages[0] || null;

    const html = buildNaverHtml({
      title: parsed.title,
      sections,
      images: selectedImages,
      keyword,
    });

    const qualityPassed = review.hardPass && bestCandidate.depthSatisfied;
    const qualityMessage = !review.hardPass
      ? `핵심 안전 규칙 미통과: ${review.hardFailLabels.join(", ")}`
      : !bestCandidate.depthSatisfied
        ? `안전 규칙은 통과했지만 본문 깊이가 부족합니다. (본문 ${bestCandidate.bodyCharCount}자 / 소제목 ${bestCandidate.sectionCount}개)`
        : review.naturalnessScore >= MIN_NATURALNESS_TARGET
          ? "핵심 안전 규칙과 본문 깊이 기준을 통과했고 자연스러움도 충족했습니다."
          : `핵심 안전 규칙과 본문 깊이는 통과했지만 자연스러움 점수(${review.naturalnessScore})가 권장 기준(${MIN_NATURALNESS_TARGET})보다 낮습니다.`;

    console.info("[generate.pipeline]", {
      pipelineVersion: PIPELINE_VERSION,
      draftCandidates: draftCompletion.choices.length,
      compliancePasses,
      hardPass: review.hardPass,
      depthSatisfied: bestCandidate.depthSatisfied,
      sectionCount: bestCandidate.sectionCount,
      bodyCharCount: bestCandidate.bodyCharCount,
      naturalnessScore: review.naturalnessScore,
      selectionScore: review.selectionScore,
      requestedFixHints,
      requestedModel: selectedModel,
      usedModel,
      imageQueries,
      preferredDomains,
    });

    return NextResponse.json({
      title: parsed.title,
      html,
      tags: parsed.tags,
      usedModel,
      thumbnail,
      images: allImages,
      review,
      qualityGate: {
        passed: qualityPassed,
        hardPass: review.hardPass,
        naturalnessTarget: MIN_NATURALNESS_TARGET,
        pipelineVersion: PIPELINE_VERSION,
        message: qualityMessage,
      },
    });
  } catch (error) {
    console.error("Generate error:", error);
    const message =
      error instanceof Error ? error.message : "알 수 없는 에러가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
