import { ReviewItem, ReviewReport } from "./types";

const BANNED_WORDS = [
  "무조건",
  "100%",
  "최저가 보장",
  "수익 보장",
  "원금 보장",
  "클릭만",
  "작업대출",
  "불법",
  "도박",
  "성인",
  "카톡 문의",
  "코인 리딩",
];

const AI_LIKE_PHRASES = [
  "이 글에서는",
  "지금까지",
  "결론적으로",
  "요약하면",
  "도움이 되었길 바랍니다",
  "도움이 되었기를 바랍니다",
  "유익한 시간이었길",
  "다음에도 유용한 정보로",
];

interface ReviewInput {
  keyword: string;
  title: string;
  sections: {
    heading?: string;
    body: string;
    tip?: string;
  }[];
  tags: string[];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countMatches(text: string, term: string): number {
  if (!text || !term) return 0;
  const pattern = new RegExp(escapeRegex(term), "gi");
  return text.match(pattern)?.length ?? 0;
}

function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function makeItem(label: string, passed: boolean, detail: string): ReviewItem {
  return {
    label,
    status: passed ? "pass" : "warn",
    detail,
  };
}

export function reviewGeneratedContent(input: ReviewInput): ReviewReport {
  const sectionsText = input.sections
    .map((section) => [section.heading, section.body, section.tip].filter(Boolean).join("\n"))
    .join("\n\n");

  const fullText = `${input.title}\n${sectionsText}`.trim();
  const introText = input.sections[0]?.body?.slice(0, 350) ?? "";

  const keywordCount = countMatches(fullText, input.keyword);
  const totalWords = Math.max(wordCount(fullText), 1);
  const keywordDensity = Number(((keywordCount / totalWords) * 100).toFixed(2));

  const containsKeywordInTitle = countMatches(input.title, input.keyword) > 0;
  const containsKeywordInIntro = countMatches(introText, input.keyword) > 0;
  const headingKeywordCount = input.sections.filter((s) =>
    s.heading ? countMatches(s.heading, input.keyword) > 0 : false
  ).length;

  const contentLength = fullText.length;
  const exclamationCount = countMatches(fullText, "!");
  const repeatedPunctuation = /([!?.~])\1{3,}/.test(fullText);

  const foundBannedWords = BANNED_WORDS.filter((word) =>
    new RegExp(escapeRegex(word), "i").test(fullText)
  );

  const aiPhraseHits = AI_LIKE_PHRASES.filter((phrase) =>
    new RegExp(escapeRegex(phrase), "i").test(fullText)
  );
  const sentences = sectionsText
    .split(/[.!?]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const sentenceStarts = sentences
    .map((s) => s.slice(0, 6))
    .filter((s) => s.length >= 3);
  const startCount = new Map<string, number>();
  for (const start of sentenceStarts) {
    startCount.set(start, (startCount.get(start) ?? 0) + 1);
  }
  const maxRepeatedSentenceStart = Math.max(...Array.from(startCount.values()), 0);
  const repeatedSentenceStartRatio =
    sentenceStarts.length > 0 ? maxRepeatedSentenceStart / sentenceStarts.length : 0;
  const aiStylePassed =
    aiPhraseHits.length <= 1 && repeatedSentenceStartRatio <= 0.35;
  const aiStyleSignals: string[] = [];
  if (aiPhraseHits.length > 1) {
    aiStyleSignals.push(`정형 문구 ${aiPhraseHits.length}개 감지`);
  }
  if (repeatedSentenceStartRatio > 0.35) {
    aiStyleSignals.push("유사한 문장 시작 패턴 반복");
  }

  const items: ReviewItem[] = [
    makeItem(
      "SEO: 제목 키워드 포함",
      containsKeywordInTitle,
      containsKeywordInTitle
        ? "제목에 메인 키워드가 포함되어 있습니다."
        : "제목에 메인 키워드가 없습니다."
    ),
    makeItem(
      "SEO: 첫 문단 키워드 포함",
      containsKeywordInIntro,
      containsKeywordInIntro
        ? "첫 문단에서 키워드가 확인됩니다."
        : "첫 문단에 키워드가 부족합니다."
    ),
    makeItem(
      "SEO: 소제목 키워드 반영",
      headingKeywordCount >= 1,
      headingKeywordCount >= 1
        ? `${headingKeywordCount}개 소제목에 키워드가 반영되었습니다.`
        : "소제목에 키워드 또는 관련 표현을 더 넣는 것이 좋습니다."
    ),
    makeItem(
      "키워드 밀도",
      keywordDensity >= 0.8 && keywordDensity <= 3.5,
      `키워드 ${keywordCount}회, 밀도 ${keywordDensity}%`
    ),
    makeItem(
      "본문 길이",
      contentLength >= 1600 && contentLength <= 3800,
      `글자 수 ${contentLength}자`
    ),
    makeItem(
      "저품질 위험 패턴",
      !repeatedPunctuation && exclamationCount <= 12,
      repeatedPunctuation || exclamationCount > 12
        ? "과도한 반복 문장부호/감탄부호가 감지되었습니다."
        : "과도한 반복 문장부호 패턴이 없습니다."
    ),
    makeItem(
      "AI 티 문체 점검",
      aiStylePassed,
      aiStylePassed
        ? "기계적인 정형 문구/문장 패턴 반복이 낮습니다."
        : aiStyleSignals.join(", ")
    ),
    makeItem(
      "금칙어 점검",
      foundBannedWords.length === 0,
      foundBannedWords.length === 0
        ? "금칙어가 감지되지 않았습니다."
        : `감지됨: ${foundBannedWords.join(", ")}`
    ),
    makeItem(
      "태그 개수",
      input.tags.length >= 5 && input.tags.length <= 8,
      `태그 ${input.tags.length}개`
    ),
  ];

  const warnCount = items.filter((item) => item.status === "warn").length;
  const score = Math.max(0, Math.round(((items.length - warnCount) / items.length) * 100));

  let overallStatus: ReviewReport["overallStatus"] = "safe";
  if (foundBannedWords.length > 0 || !containsKeywordInTitle) {
    overallStatus = "risk";
  } else if (warnCount >= 3) {
    overallStatus = "caution";
  }

  return {
    overallStatus,
    score,
    keywordCount,
    keywordDensity,
    flaggedWords: foundBannedWords,
    items,
  };
}
