import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { buildBlogPrompt, buildRefinePrompt } from "@/lib/prompts";
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
const MIN_SCORE = 90;
const MAX_GENERATION_ATTEMPTS = 5;
const REQUIRED_PASS_LABELS = [
  "SEO: 제목 키워드 포함",
  "SEO: 첫 문단 키워드 포함",
  "SEO: 소제목 키워드 반영",
  "키워드 밀도",
  "본문 길이",
  "AI 티 문체 점검",
  "금칙어 점검",
];

interface ParsedBlog {
  title: string;
  sections: { heading?: string; body: string; tip?: string | null }[];
  tags: string[];
  imageKeywords: string[];
}

interface Candidate {
  parsed: ParsedBlog;
  sections: { heading?: string; body: string; tip?: string }[];
  review: ReviewReport;
}

function getWarnLabels(review: ReviewReport): string[] {
  return review.items
    .filter((item) => item.status === "warn")
    .map((item) => item.label);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function safeParsedBlog(raw: ParsedBlog, keyword: string): ParsedBlog {
  return {
    title: raw.title?.trim() || `${keyword} 완전 정리`,
    sections: Array.isArray(raw.sections)
      ? raw.sections.filter((s) => s?.body?.trim()).slice(0, 6)
      : [],
    tags: Array.isArray(raw.tags) ? raw.tags.filter(Boolean).slice(0, 10) : [],
    imageKeywords: Array.isArray(raw.imageKeywords)
      ? raw.imageKeywords.filter(Boolean).slice(0, 5)
      : [keyword],
  };
}

function applyRuleBasedFixes(parsed: ParsedBlog, keyword: string): ParsedBlog {
  const fixed = {
    ...parsed,
    sections: [...parsed.sections],
    tags: [...parsed.tags],
  };

  if (!fixed.title.includes(keyword)) {
    fixed.title = `${keyword} | ${fixed.title}`.trim();
  }

  if (fixed.sections.length > 0 && !fixed.sections[0].body.includes(keyword)) {
    fixed.sections[0] = {
      ...fixed.sections[0],
      body: `${keyword}를 실제 사용 맥락에서 먼저 정리해보겠습니다.\n${fixed.sections[0].body}`,
    };
  }

  let headingHit = fixed.sections.filter((s) => s.heading?.includes(keyword)).length;
  for (let i = 0; i < fixed.sections.length && headingHit < 2; i++) {
    const section = fixed.sections[i];
    if (!section.heading) continue;
    if (!section.heading.includes(keyword)) {
      fixed.sections[i] = {
        ...section,
        heading: `${keyword} ${section.heading}`.trim(),
      };
      headingHit++;
    }
  }

  const mergedText = `${fixed.title}\n${fixed.sections.map((s) => s.body).join("\n")}`;
  if (mergedText.length < 1800 && fixed.sections.length > 0) {
    const pad = `${keyword}를 고를 때는 사용 목적, 예산, 실제 사용 환경을 함께 비교해야 만족도가 올라갑니다. 직접 써본 기준으로 장단점을 나눠보면 선택이 훨씬 쉬워집니다.`;
    fixed.sections[fixed.sections.length - 1] = {
      ...fixed.sections[fixed.sections.length - 1],
      body: `${fixed.sections[fixed.sections.length - 1].body}\n${pad}`,
    };
  }

  if (!fixed.tags.includes(keyword)) {
    fixed.tags.unshift(keyword);
  }
  fixed.tags = uniqueStrings(fixed.tags).slice(0, 8);
  while (fixed.tags.length < 5) {
    fixed.tags.push(`${keyword}정보${fixed.tags.length + 1}`);
  }

  return fixed;
}

function makeCandidate(parsed: ParsedBlog, keyword: string): Candidate {
  const sections = parsed.sections.map((s) => ({
    heading: s.heading,
    body: s.body,
    tip: s.tip || undefined,
  }));
  const review = reviewGeneratedContent({
    keyword,
    title: parsed.title,
    sections,
    tags: parsed.tags || [],
  });
  return { parsed, sections, review };
}

function passedRequiredLabels(review: ReviewReport): boolean {
  const itemMap = new Map(review.items.map((item) => [item.label, item.status]));
  return REQUIRED_PASS_LABELS.every((label) => itemMap.get(label) === "pass");
}

function gatePassed(review: ReviewReport): boolean {
  return review.score >= MIN_SCORE && passedRequiredLabels(review);
}

function betterCandidate(a: Candidate | null, b: Candidate): Candidate {
  if (!a) return b;
  const requiredFailCount = (review: ReviewReport) =>
    REQUIRED_PASS_LABELS.filter(
      (label) => review.items.find((item) => item.label === label)?.status !== "pass"
    ).length;
  const aRequiredFail = requiredFailCount(a.review);
  const bRequiredFail = requiredFailCount(b.review);
  if (bRequiredFail < aRequiredFail) return b;
  if (bRequiredFail > aRequiredFail) return a;
  if (b.review.score > a.review.score) return b;
  if (b.review.score < a.review.score) return a;
  return getWarnLabels(b.review).length < getWarnLabels(a.review).length ? b : a;
}

function pickRefineHints(review: ReviewReport, currentHints: string[]): string[] {
  const warnLabels = getWarnLabels(review);
  const requiredWarns = warnLabels.filter((label) =>
    REQUIRED_PASS_LABELS.includes(label)
  );
  return uniqueStrings([...currentHints, ...requiredWarns, ...warnLabels]).slice(0, 10);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { keyword, tone, fixHints } = body as GenerateRequest;

    if (!keyword?.trim()) {
      return NextResponse.json(
        { error: "키워드를 입력해주세요." },
        { status: 400 }
      );
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY가 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    // 1. Search for latest info (non-blocking if no key)
    let searchContext = "";
    try {
      const origin = req.nextUrl.origin;
      const searchRes = await fetch(
        `${origin}/api/search?keyword=${encodeURIComponent(keyword)}`
      );
      const searchData = await searchRes.json();
      if (searchData.results?.length > 0) {
        searchContext = searchData.results
          .map(
            (r: SearchResult) => `- ${r.title}: ${r.description}`
          )
          .join("\n");
      }
    } catch {
      // Search is optional
    }

    // 2. Multi-stage generation pipeline
    const openai = new OpenAI({ apiKey: openaiKey });
    const selectedTone = tone ?? ("informative" as ToneType);
    const hasFixHints = Array.isArray(fixHints) && fixHints.length > 0;
    const maxAttempts = hasFixHints ? MAX_GENERATION_ATTEMPTS : 4;

    const parseJsonFromModel = (rawContent: string): ParsedBlog => {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("AI 응답을 파싱할 수 없습니다. 다시 시도해주세요.");
      }
      return JSON.parse(jsonMatch[0]) as ParsedBlog;
    };

    const generateDraft = async (attemptFixHints: string[]): Promise<ParsedBlog> => {
      const prompt = buildBlogPrompt({
        keyword,
        tone: selectedTone,
        searchContext,
        fixHints: attemptFixHints,
      });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.55,
        max_tokens: 4000,
      });

      return parseJsonFromModel(completion.choices[0]?.message?.content ?? "");
    };

    const refineDraft = async (
      previous: ParsedBlog,
      attemptFixHints: string[]
    ): Promise<ParsedBlog> => {
      const prompt = buildRefinePrompt({
        keyword,
        tone: selectedTone,
        searchContext,
        fixHints: attemptFixHints,
        previousJson: JSON.stringify(previous),
      });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        max_tokens: 4000,
      });

      return parseJsonFromModel(completion.choices[0]?.message?.content ?? "");
    };

    let dynamicFixHints = uniqueStrings(fixHints || []);
    let bestCandidate: Candidate | null = null;
    let latestParsed: ParsedBlog | null = null;

    for (let i = 0; i < maxAttempts; i++) {
      const rawParsed =
        i === 0 || !latestParsed
          ? await generateDraft(dynamicFixHints)
          : await refineDraft(latestParsed, dynamicFixHints);
      const normalizedParsed = applyRuleBasedFixes(
        safeParsedBlog(rawParsed, keyword),
        keyword
      );
      latestParsed = normalizedParsed;

      const candidate = makeCandidate(normalizedParsed, keyword);
      bestCandidate = betterCandidate(bestCandidate, candidate);
      if (gatePassed(candidate.review)) {
        bestCandidate = candidate;
        break;
      }

      dynamicFixHints = pickRefineHints(candidate.review, dynamicFixHints);
    }

    if (!bestCandidate) {
      return NextResponse.json(
        { error: "AI 응답을 파싱할 수 없습니다. 다시 시도해주세요." },
        { status: 500 }
      );
    }

    const parsed = bestCandidate.parsed;
    const review = bestCandidate.review;
    const sections = bestCandidate.sections;

    // 3. Fetch images from Unsplash
    const imageKeywords = parsed.imageKeywords || [keyword];
    const allImages: UnsplashImage[] = [];

    try {
      const origin = req.nextUrl.origin;
      const imagePromises = imageKeywords.slice(0, 3).map((kw: string) =>
        fetch(
          `${origin}/api/images?query=${encodeURIComponent(kw)}`
        ).then((r) => r.json())
      );
      const imageResults = await Promise.all(imagePromises);
      const seen = new Set<string>();
      for (const result of imageResults) {
        for (const img of result.images || []) {
          if (!seen.has(img.id)) {
            seen.add(img.id);
            allImages.push(img);
          }
        }
      }
    } catch {
      // Images are optional
    }

    // Select 2-3 images for the blog
    const selectedImages = allImages.slice(0, 3);
    const thumbnail = allImages[0] || null;

    // 4. Build Naver HTML
    const html = buildNaverHtml({
      title: parsed.title,
      sections,
      images: selectedImages,
      keyword,
    });

    return NextResponse.json({
      title: parsed.title,
      html,
      tags: parsed.tags || [],
      thumbnail,
      images: allImages,
      review,
      qualityGate: {
        passed: gatePassed(review),
        minimumScore: MIN_SCORE,
        message:
          gatePassed(review)
            ? "품질 기준을 충족했습니다."
            : `품질 기준 미달: ${review.score}점 (목표 ${MIN_SCORE}점). 자동 보정 후에도 일부 항목이 남아 추가 수정이 필요합니다.`,
      },
    });
  } catch (error) {
    console.error("Generate error:", error);
    const message =
      error instanceof Error ? error.message : "알 수 없는 에러가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
