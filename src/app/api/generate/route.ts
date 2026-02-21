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
const PIPELINE_VERSION = "v2-two-pass";
const DRAFT_CANDIDATE_COUNT = 3;
const MAX_COMPLIANCE_PASSES = 2;
const MIN_NATURALNESS_TARGET = 68;
const SOFT_FOCUS_LIMIT = 3;

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
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean).map((v) => v.trim()).filter(Boolean)));
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

  return {
    parsed,
    sections,
    review,
    contentText,
    changeRatio: previousContent ? textChangeRatio(previousContent, contentText) : 0,
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

function isMeaningfulImageQuery(query: string): boolean {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9가-힣]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !IMAGE_QUERY_STOPWORDS.has(token));
  return tokens.length > 0;
}

function extractBrandPhrases(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const matches =
    normalized.match(
      /[A-Za-z][A-Za-z0-9+\-]{1,}(?:\s+[A-Za-z0-9+\-]{1,}){0,2}|[가-힣A-Za-z]{1,}[0-9]{1,}[A-Za-z가-힣0-9+\-]*/g
    ) || [];

  return uniqueStrings(matches.map((match) => sanitizeImageQuery(match)))
    .filter((query) => isMeaningfulImageQuery(query))
    .slice(0, 6);
}

function buildImageQueries(params: {
  keyword: string;
  parsed: ParsedBlog;
  searchResults: SearchResult[];
}): string[] {
  const { keyword, parsed, searchResults } = params;
  const normalizedKeyword = sanitizeImageQuery(keyword);

  const headingQueries = parsed.sections
    .map((section) => sanitizeImageQuery(section.heading || ""))
    .filter((query) => isMeaningfulImageQuery(query))
    .slice(0, 2);

  const searchTitleQueries = searchResults
    .map((result) => sanitizeImageQuery(result.title))
    .filter((query) => isMeaningfulImageQuery(query))
    .slice(0, 3);

  const brandQueries = uniqueStrings([
    ...extractBrandPhrases(parsed.title),
    ...parsed.imageKeywords.flatMap((keywordItem) => extractBrandPhrases(keywordItem)),
    ...searchResults.flatMap((result) => extractBrandPhrases(result.title)),
    ...headingQueries.flatMap((heading) => extractBrandPhrases(heading)),
  ]).slice(0, 4);

  return uniqueStrings([
    ...parsed.imageKeywords.map((imageKeyword) => sanitizeImageQuery(imageKeyword)),
    ...brandQueries,
    ...searchTitleQueries,
    ...headingQueries,
    normalizedKeyword,
    `${normalizedKeyword} 공식 이미지`,
    `${normalizedKeyword} 리뷰 기사`,
    `${normalizedKeyword} 실제 사용 사진`,
  ])
    .filter((query) => isMeaningfulImageQuery(query))
    .slice(0, 6);
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { keyword, tone, fixHints } = body as GenerateRequest;

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

    const draftPrompt = buildDraftPrompt({
      keyword,
      tone: selectedTone,
      searchContext,
    });

    const draftCompletion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: draftPrompt }],
      n: DRAFT_CANDIDATE_COUNT,
      temperature: 0.85,
      top_p: 0.9,
      frequency_penalty: 0.3,
      presence_penalty: 0.2,
      max_tokens: 4000,
    });

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
      const shouldFixHard = !bestCandidate.review.hardPass;
      const shouldFixRequested = !requestedHintsSatisfied(
        bestCandidate.review,
        requestedFixHints
      );
      const shouldBoostNaturalness =
        bestCandidate.review.naturalnessScore < MIN_NATURALNESS_TARGET;

      if (!shouldFixHard && !shouldFixRequested && !shouldBoostNaturalness) {
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
        requestedFixHints,
      });

      try {
        const refinedCompletion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{ role: "user", content: compliancePrompt }],
          temperature: 0.25,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0,
          max_tokens: 4000,
        });

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

    const imageQueries = buildImageQueries({ keyword, parsed, searchResults });
    const imageContext = buildImageContext({ keyword, parsed, searchResults });
    const allImages: UnsplashImage[] = [];

    try {
      const origin = req.nextUrl.origin;
      const params = new URLSearchParams({
        query: imageQueries[0] || keyword,
        queries: imageQueries.join("||"),
        context: imageContext,
      });
      const imageRes = await fetch(`${origin}/api/images?${params.toString()}`);
      const imageData = (await imageRes.json()) as ImagesApiResponse;

      const seen = new Set<string>();
      for (const image of imageData.images || []) {
        const dedupeKey = `${image.provider || "unsplash"}:${image.sourceUrl || image.url || image.id}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        allImages.push(image);
      }

      allImages.sort(
        (a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0)
      );
    } catch {
      // Images are optional
    }

    const selectedImages = allImages.slice(0, 3);
    const thumbnail = allImages[0] || null;

    const html = buildNaverHtml({
      title: parsed.title,
      sections,
      images: selectedImages,
      keyword,
    });

    const qualityPassed = review.hardPass;
    const qualityMessage = qualityPassed
      ? review.naturalnessScore >= MIN_NATURALNESS_TARGET
        ? "핵심 안전 규칙을 통과했고 자연스러움 기준도 충족했습니다."
        : `핵심 안전 규칙은 통과했지만 자연스러움 점수(${review.naturalnessScore})가 권장 기준(${MIN_NATURALNESS_TARGET})보다 낮습니다.`
      : `핵심 안전 규칙 미통과: ${review.hardFailLabels.join(", ")}`;

    console.info("[generate.pipeline]", {
      pipelineVersion: PIPELINE_VERSION,
      draftCandidates: draftCompletion.choices.length,
      compliancePasses,
      hardPass: review.hardPass,
      naturalnessScore: review.naturalnessScore,
      selectionScore: review.selectionScore,
      requestedFixHints,
      imageQueries,
    });

    return NextResponse.json({
      title: parsed.title,
      html,
      tags: parsed.tags,
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
