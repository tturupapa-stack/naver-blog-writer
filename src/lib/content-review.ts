import { ReviewItem, ReviewReport, ToneType } from "./types";

const PIPELINE_VERSION = "v3-depth-boost";
const MIN_CONTENT_LENGTH = 2200;
const MAX_CONTENT_LENGTH = 4500;

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

const RISKY_CLAIM_PHRASES = [
  "반드시 효과",
  "무조건 성공",
  "절대 실패",
  "즉시 효과",
  "확실히 벌",
  "평생",
  "완전 해결",
  "부작용 없음",
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
  "정리해보겠습니다",
  "한눈에",
  "핵심만",
];

const SPECIFICITY_PATTERNS = [
  /\d+\s?(원|개|분|시간|일|주|개월|년|kg|cm|km|%)/g,
  /(아침|점심|저녁|출근길|퇴근길|주말|평일|매장|온라인|오프라인|실사용|직접 사용|비교해보니|체감)/g,
  /(예산|사용 목적|설치 환경|사용 환경|거리|속도|소음|무게)/g,
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
  tone?: ToneType;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, current) => sum + current, 0) / values.length;
  const variance =
    values.reduce((sum, current) => sum + (current - mean) ** 2, 0) /
    values.length;
  return Math.sqrt(variance);
}

function repeatedNgramRatio(text: string, n: number): number {
  const tokens = text
    .toLowerCase()
    .split(/[\s,.;:!?()\[\]{}"'`~]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length < n) return 0;

  const map = new Map<string, number>();
  for (let i = 0; i <= tokens.length - n; i++) {
    const gram = tokens.slice(i, i + n).join(" ");
    map.set(gram, (map.get(gram) ?? 0) + 1);
  }

  const totalNgrams = tokens.length - n + 1;
  const repeated = Array.from(map.values()).reduce(
    (sum, count) => sum + (count > 1 ? count - 1 : 0),
    0
  );

  return repeated / Math.max(totalNgrams, 1);
}

function makeItem(params: {
  label: string;
  passed: boolean;
  detail: string;
  bucket: ReviewItem["bucket"];
  isHard: boolean;
}): ReviewItem {
  return {
    label: params.label,
    status: params.passed ? "pass" : "warn",
    detail: params.detail,
    bucket: params.bucket,
    isHard: params.isHard,
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
  const keywordDensity = round((keywordCount / totalWords) * 100);

  const containsKeywordInTitle = countMatches(input.title, input.keyword) > 0;
  const containsKeywordInIntro = countMatches(introText, input.keyword) > 0;
  const sectionCount = input.sections.length;
  const headingKeywordCount = input.sections.filter((s) =>
    s.heading ? countMatches(s.heading, input.keyword) > 0 : false
  ).length;

  const contentLength = fullText.length;
  const exclamationCount = countMatches(fullText, "!");
  const repeatedPunctuation = /([!?.~])\1{3,}/.test(fullText);

  const foundBannedWords = BANNED_WORDS.filter((word) =>
    new RegExp(escapeRegex(word), "i").test(fullText)
  );

  const foundRiskyClaims = RISKY_CLAIM_PHRASES.filter((phrase) =>
    new RegExp(escapeRegex(phrase), "i").test(fullText)
  );

  const aiPhraseHits = AI_LIKE_PHRASES.filter((phrase) =>
    new RegExp(escapeRegex(phrase), "i").test(fullText)
  );

  const sentences = sectionsText
    .split(/[.!?]\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const sentenceStarts = sentences
    .map((sentence) => sentence.slice(0, 8))
    .filter((start) => start.length >= 3);

  const startCount = new Map<string, number>();
  for (const start of sentenceStarts) {
    startCount.set(start, (startCount.get(start) ?? 0) + 1);
  }

  const maxRepeatedSentenceStart = Math.max(...Array.from(startCount.values()), 0);
  const repeatedSentenceStartRatio =
    sentenceStarts.length > 0 ? maxRepeatedSentenceStart / sentenceStarts.length : 0;

  const sentenceLengths = sentences.map((sentence) => sentence.length);
  const avgSentenceLength =
    sentenceLengths.length > 0
      ? sentenceLengths.reduce((sum, current) => sum + current, 0) /
        sentenceLengths.length
      : 0;
  const sentenceLengthStd = stdDev(sentenceLengths);

  const ngramRepeatRatio = repeatedNgramRatio(sectionsText, 4);

  const specificityHits = SPECIFICITY_PATTERNS.reduce(
    (sum, pattern) => sum + (fullText.match(pattern)?.length ?? 0),
    0
  );

  const toneHints: Record<ToneType, RegExp[]> = {
    informative: [/핵심/, /기준/, /비교/, /정리/],
    experience: [/제가|저는|직접|써보니|사용해보니|겪어보니/],
    review: [/장점|아쉬운 점|단점|비교|총평/],
    guide: [/단계|순서|먼저|다음|해보세요|체크/],
  };
  const toneHitCount = (toneHints[input.tone || "informative"] || []).reduce(
    (sum, pattern) => sum + (fullText.match(pattern)?.length ?? 0),
    0
  );

  const lowQualityPatternPassed = !repeatedPunctuation && exclamationCount <= 12;
  const bannedWordPassed = foundBannedWords.length === 0;
  const riskyClaimPassed = foundRiskyClaims.length === 0;
  const aiStylePassed =
    aiPhraseHits.length <= 1 &&
    repeatedSentenceStartRatio <= 0.32 &&
    ngramRepeatRatio <= 0.14;
  const sentenceRhythmPassed = sentenceLengthStd >= 10;
  const specificityPassed = specificityHits >= 2;

  let naturalnessScore = 100;
  naturalnessScore -= Math.max(0, aiPhraseHits.length - 1) * 11;
  naturalnessScore -=
    repeatedSentenceStartRatio > 0.28
      ? Math.min(24, (repeatedSentenceStartRatio - 0.28) * 120)
      : 0;
  naturalnessScore -= ngramRepeatRatio > 0.1 ? Math.min(22, (ngramRepeatRatio - 0.1) * 180) : 0;
  naturalnessScore -= sentenceLengthStd < 8 ? 15 : sentenceLengthStd < 10 ? 8 : 0;
  naturalnessScore -= specificityHits < 2 ? 10 : 0;
  naturalnessScore -= avgSentenceLength < 22 || avgSentenceLength > 140 ? 8 : 0;
  naturalnessScore -= toneHitCount === 0 ? 6 : 0;
  naturalnessScore -= lowQualityPatternPassed ? 0 : 10;
  naturalnessScore = round(clamp(naturalnessScore, 0, 100));

  const seoChecks = [
    containsKeywordInTitle,
    containsKeywordInIntro,
    sectionCount >= 5 && sectionCount <= 6,
    headingKeywordCount >= 2,
    keywordDensity >= 0.6 && keywordDensity <= 3.2,
    contentLength >= MIN_CONTENT_LENGTH && contentLength <= MAX_CONTENT_LENGTH,
    input.tags.length >= 5 && input.tags.length <= 8,
  ];
  const seoScore = round((seoChecks.filter(Boolean).length / seoChecks.length) * 100);

  const complianceSoftChecks = [aiStylePassed, sentenceRhythmPassed, specificityPassed];
  const complianceSoftScore = round(
    (complianceSoftChecks.filter(Boolean).length / complianceSoftChecks.length) * 100
  );

  const selectionScore = round(
    0.5 * naturalnessScore + 0.25 * complianceSoftScore + 0.25 * seoScore
  );

  const items: ReviewItem[] = [
    makeItem({
      label: "SEO: 제목 키워드 포함",
      passed: containsKeywordInTitle,
      detail: containsKeywordInTitle
        ? "제목에 메인 키워드가 포함되어 있습니다."
        : "제목에 메인 키워드가 없습니다.",
      bucket: "hard",
      isHard: true,
    }),
    makeItem({
      label: "SEO: 첫 문단 키워드 포함",
      passed: containsKeywordInIntro,
      detail: containsKeywordInIntro
        ? "첫 문단에서 키워드가 확인됩니다."
        : "첫 문단(도입부)에 키워드를 1회 이상 넣어주세요.",
      bucket: "hard",
      isHard: true,
    }),
    makeItem({
      label: "금칙어 점검",
      passed: bannedWordPassed,
      detail: bannedWordPassed
        ? "금칙어가 감지되지 않았습니다."
        : `감지됨: ${foundBannedWords.join(", ")}`,
      bucket: "hard",
      isHard: true,
    }),
    makeItem({
      label: "위험 주장 점검",
      passed: riskyClaimPassed,
      detail: riskyClaimPassed
        ? "과장/절대 표현이 감지되지 않았습니다."
        : `완화 필요: ${foundRiskyClaims.join(", ")}`,
      bucket: "hard",
      isHard: true,
    }),
    makeItem({
      label: "저품질 위험 패턴",
      passed: lowQualityPatternPassed,
      detail: lowQualityPatternPassed
        ? "반복 문장부호/과도 감탄 패턴이 없습니다."
        : "반복 문장부호 또는 과도한 감탄부호가 감지되었습니다.",
      bucket: "hard",
      isHard: true,
    }),
    makeItem({
      label: "소제목 개수",
      passed: sectionCount >= 5 && sectionCount <= 6,
      detail:
        sectionCount >= 5 && sectionCount <= 6
          ? `소제목 ${sectionCount}개`
          : `현재 소제목 ${sectionCount}개 (권장 5~6개)`,
      bucket: "seo",
      isHard: false,
    }),
    makeItem({
      label: "SEO: 소제목 키워드 반영",
      passed: headingKeywordCount >= 2,
      detail:
        headingKeywordCount >= 2
          ? `${headingKeywordCount}개 소제목에 키워드가 반영되었습니다.`
          : "소제목 2개 이상에 키워드/연관 표현을 반영하면 좋습니다.",
      bucket: "seo",
      isHard: false,
    }),
    makeItem({
      label: "키워드 밀도",
      passed: keywordDensity >= 0.6 && keywordDensity <= 3.2,
      detail: `키워드 ${keywordCount}회, 밀도 ${keywordDensity}%`,
      bucket: "seo",
      isHard: false,
    }),
    makeItem({
      label: "본문 길이",
      passed: contentLength >= MIN_CONTENT_LENGTH && contentLength <= MAX_CONTENT_LENGTH,
      detail: `글자 수 ${contentLength}자`,
      bucket: "seo",
      isHard: false,
    }),
    makeItem({
      label: "태그 개수",
      passed: input.tags.length >= 5 && input.tags.length <= 8,
      detail: `태그 ${input.tags.length}개`,
      bucket: "seo",
      isHard: false,
    }),
    makeItem({
      label: "AI 티 문체 점검",
      passed: aiStylePassed,
      detail: aiStylePassed
        ? "정형 문구/반복 패턴이 과도하지 않습니다."
        : `정형 문구 ${aiPhraseHits.length}개, 시작 패턴 반복 비율 ${round(
            repeatedSentenceStartRatio * 100
          )}%, 반복 구문 비율 ${round(ngramRepeatRatio * 100)}%`,
      bucket: "naturalness",
      isHard: false,
    }),
    makeItem({
      label: "문장 리듬 다양성",
      passed: sentenceRhythmPassed,
      detail: `문장 길이 표준편차 ${round(sentenceLengthStd)} (평균 ${round(
        avgSentenceLength
      )})`,
      bucket: "naturalness",
      isHard: false,
    }),
    makeItem({
      label: "구체성/맥락 표현",
      passed: specificityPassed,
      detail: `구체 표현 감지 ${specificityHits}회`,
      bucket: "complianceSoft",
      isHard: false,
    }),
  ];

  const hardItems = items.filter((item) => item.isHard);
  const hardFailLabels = hardItems
    .filter((item) => item.status === "warn")
    .map((item) => item.label);
  const hardPass = hardFailLabels.length === 0;

  const flaggedWords = [
    ...foundBannedWords,
    ...foundRiskyClaims.map((phrase) => `위험표현:${phrase}`),
  ];

  let overallStatus: ReviewReport["overallStatus"] = "safe";
  if (!hardPass) {
    overallStatus = "risk";
  } else if (
    contentLength < MIN_CONTENT_LENGTH ||
    contentLength > MAX_CONTENT_LENGTH ||
    sectionCount < 5 ||
    selectionScore < 70 ||
    naturalnessScore < 65
  ) {
    overallStatus = "caution";
  }

  return {
    overallStatus,
    score: selectionScore,
    keywordCount,
    keywordDensity,
    flaggedWords,
    items,
    hardPass,
    hardFailLabels,
    hardChecks: {
      passed: hardItems.length - hardFailLabels.length,
      total: hardItems.length,
    },
    naturalnessScore,
    complianceSoftScore,
    seoScore,
    selectionScore,
    pipelineVersion: PIPELINE_VERSION,
  };
}
