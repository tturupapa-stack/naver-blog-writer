import { ToneType } from "./types";

const TONE_DESCRIPTIONS: Record<ToneType, string> = {
  informative:
    "정보성 글: 신뢰감 있게 설명하되, 말투가 딱딱해지지 않게 실제 사용 맥락 예시를 넣습니다.",
  experience:
    "경험담 글: 1인칭 경험을 자연스럽게 녹이고, 과장 없이 솔직한 체감 포인트를 전달합니다.",
  review:
    "리뷰 글: 장점/아쉬운 점을 균형 있게 보여주고, 구매 전 판단에 도움이 되는 비교 관점을 유지합니다.",
  guide:
    "가이드 글: 따라하기 쉬운 순서로 설명하되, 실제로 막히는 지점을 짚어주는 코칭 톤을 사용합니다.",
};

const FIX_HINT_GUIDE: Record<string, string> = {
  "SEO: 제목 키워드 포함":
    "제목에 메인 키워드를 정확한 형태로 포함하세요.",
  "SEO: 첫 문단 키워드 포함":
    "도입부 2~3문장 안에 메인 키워드를 자연스럽게 1회 이상 포함하세요.",
  "저품질 위험 패턴":
    "반복 문장부호, 과도한 감탄사, 문장 패턴 반복을 줄이세요.",
  "금칙어 점검":
    "보장/불법/자극성 단어를 제거하고 중립적 표현으로 바꾸세요.",
  "위험 주장 점검":
    "절대적 표현(무조건, 반드시 효과 등)을 피하고 조건/개인차를 명시하세요.",
  "SEO: 소제목 키워드 반영":
    "소제목 최소 2개에 키워드 또는 밀접 연관 표현을 반영하세요.",
  "소제목 개수": "소제목을 5~6개로 맞춰 구조 깊이를 확보하세요.",
  "키워드 밀도": "키워드 밀도는 0.6~3.2% 범위를 목표로 맞추세요.",
  "본문 길이": "본문 길이를 2200~4500자 권장 범위로 조정하세요.",
  "번역투 표현 점검":
    "번역투/보고서체 단어를 쉬운 생활 언어로 바꾸고 문장을 말하듯 자연스럽게 다듬으세요.",
  "AI 티 문체 점검":
    "정형 문구 남발을 줄이고 실제 맥락/상황 표현을 넣어 문장을 자연스럽게 다듬으세요.",
  "문장 리듬 다양성":
    "문장 길이와 시작 어구를 다양화해 읽는 리듬을 분산하세요.",
  "구체성/맥락 표현": "숫자, 상황, 비교 기준 등 구체 표현을 보강하세요.",
  "태그 개수": "태그는 5~8개로 맞추고 중복 없이 키워드 연관성을 유지하세요.",
};

function formatFixHints(fixHints: string[] | undefined): string {
  if (!Array.isArray(fixHints) || fixHints.length === 0) return "- 없음";
  return fixHints.map((hint) => `- ${hint}`).join("\n");
}

function formatFixGuides(fixHints: string[] | undefined): string {
  if (!Array.isArray(fixHints) || fixHints.length === 0) return "- 없음";
  return fixHints
    .map(
      (hint) =>
        `- ${FIX_HINT_GUIDE[hint] || `${hint} 항목을 해결하고 필요하면 문단을 확장하세요.`}`
    )
    .join("\n");
}

export function buildDraftPrompt(params: {
  keyword: string;
  tone: ToneType;
  searchContext: string;
}): string {
  const { keyword, tone, searchContext } = params;
  const toneDesc = TONE_DESCRIPTIONS[tone];

  return `당신은 네이버 블로그에 실제로 글을 연재하는 한국인 작가입니다.

목표 우선순위:
1) 사람이 직접 쓴 듯한 자연스러운 흐름과 문체
2) 필수 안전 규칙(Hard Rule) 충족
3) SEO/형식 최적화(Soft Goal)

## 키워드
${keyword}

## 글 톤
${toneDesc}

## 최신 참고 정보
${searchContext || "최신 검색 결과 없음"}

## Hard Rule (반드시 준수)
- 제목에 키워드 "${keyword}" 포함
- 첫 문단(도입 2~3문장)에 키워드 1회 이상 포함
- 금칙어/불법/보장성 표현 금지
- 반복 문장부호(!!!!, ????) 및 스팸성 반복 표현 금지

## 문체/어휘 제한 (중요)
- 번역체/보고서체 표현을 금지하세요. 예: 상기, 해당, 기반으로, 관점에서, 수행, 구현, 도출, 제고, 유의미, 솔루션, 프로세스, 인사이트, 레버리지, 니즈, 페인포인트
- 낯설고 딱딱한 단어보다 일상적인 쉬운 한국어를 우선 사용하세요.
- 꼭 필요한 외래어는 1회만 쓰고 바로 쉬운 한국어로 풀어 설명하세요.
- 문장은 짧고 명확하게 쓰고, 말하듯 자연스럽게 이어지게 작성하세요.

## Soft Goal (권장)
- 소제목은 5~6개로 구성하고, 소제목 2개 이상에 키워드/연관 표현 반영
- 각 section.body는 최소 3문단 이상으로 작성
- 키워드 밀도는 자연스럽게 0.6~3.2% 범위
- 본문 길이는 2200~4500자 권장
- AI 상투문구("이 글에서는", "결론적으로" 등) 과다 사용 금지

## 이미지 연관성 가이드
- 본문에 언급한 브랜드/제품/서비스가 있으면 해당 명칭을 imageKeywords 앞순위에 반드시 포함하세요.
- imageKeywords는 "브랜드명 + 모델명", "브랜드 공식 이미지", "브랜드/제품 리뷰 기사 사진"처럼 구체적으로 작성하세요.
- 막연한 단어(예: technology, lifestyle, business)만 단독으로 쓰지 마세요.
- 브랜드명이 없는 주제라면 "주제 + 기사 사진", "주제 + 실제 사용 장면" 형태로 작성하세요.

## 자연스러움 가이드
- 실제 상황을 떠올릴 수 있는 표현(시간/장소/비교 기준/체감 포인트)을 넣으세요.
- 문장 길이와 문장 시작 패턴을 다양하게 섞으세요.
- 정보 나열보다 "왜 이런 선택이 나왔는지" 맥락을 설명하세요.
- 과장하지 말고 한계/주의점도 함께 적으세요.
- 각 소제목마다 실제 사례/비교 기준/실수 방지 팁 중 최소 1개를 반드시 포함하세요.

## 출력 형식 (JSON만)
\`\`\`json
{
  "title": "블로그 제목 (키워드 포함)",
  "sections": [
    {
      "heading": "소제목 1",
      "body": "본문 내용...",
      "tip": "팁 내용 (없으면 null)"
    }
  ],
  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],
  "imageKeywords": [
    "브랜드/제품명 중심 키워드 1",
    "브랜드 공식 이미지 키워드 2",
    "리뷰 기사 이미지 키워드 3",
    "실사용 장면 키워드 4",
    "비교/핵심 기능 키워드 5"
  ],
  "voiceAnchor": [
    "이 글의 문체를 대표하는 짧은 기준 문장 1",
    "이 글의 문체를 대표하는 짧은 기준 문장 2"
  ]
}
\`\`\`

JSON 외 텍스트는 출력하지 마세요.`;
}

export function buildCompliancePrompt(params: {
  keyword: string;
  tone: ToneType;
  searchContext: string;
  previousJson: string;
  hardFailLabels: string[];
  softFocusLabels: string[];
  requestedFixHints?: string[];
  allowExpansion?: boolean;
}): string {
  const {
    keyword,
    tone,
    searchContext,
    previousJson,
    hardFailLabels,
    softFocusLabels,
    requestedFixHints,
    allowExpansion,
  } = params;
  const toneDesc = TONE_DESCRIPTIONS[tone];
  const mergedFixHints = Array.from(
    new Set([...(requestedFixHints || []), ...hardFailLabels, ...softFocusLabels])
  ).slice(0, 10);

  return `당신은 네이버 블로그 전문 편집자입니다.
기존 원고를 품질 기준에 맞게 보정하세요.

## 편집 우선순위
1) Hard Rule 위반 해결
2) 사용자가 요청한 수정 항목 반영
3) Soft Goal 개선 (가능한 범위에서)

## 메인 키워드
${keyword}

## 톤 기준
${toneDesc}

## 최신 참고 정보
${searchContext || "최신 검색 결과 없음"}

## 반드시 해결할 Hard Fail
${formatFixHints(hardFailLabels)}

## 보완할 Soft 항목
${formatFixHints(softFocusLabels)}

## 사용자 요청 수정 항목
${formatFixHints(requestedFixHints)}

## 항목별 편집 가이드
${formatFixGuides(mergedFixHints)}

## 편집 모드
${allowExpansion
  ? "- 확장 모드: 원고 흐름/문체는 유지하되, 본문 길이와 정보 밀도를 충족하도록 문단과 사례를 적극 보강하세요."
  : "- 미세 보정 모드: 기존 구조를 유지하며 필요한 문장만 정밀 보정하세요."}

## 기존 원고(JSON)
\`\`\`json
${previousJson}
\`\`\`

## 절대 규칙
- 원고 전체 톤과 핵심 흐름은 유지하세요.
- 길이/깊이 부족이 있을 때는 section을 유지한 채 본문 문단과 사례를 추가 확장하세요.
- 번역투/딱딱한 단어를 쉬운 생활 언어로 바꾸세요.
- 특히 상기/해당/기반으로/관점에서/수행/구현/도출/제고/유의미/솔루션/프로세스/인사이트 같은 표현은 피하세요.
- 원문의 문체/리듬/관점(voiceAnchor)을 최대한 유지하세요.
- 정보 과장, 불법성, 보장성 표현은 제거하세요.
- imageKeywords는 본문 맥락과 직접 연결되게 유지/보정하세요. 특히 브랜드/제품 언급이 있으면 해당 명칭을 앞순위로 배치하세요.

## 출력 형식 (JSON만)
\`\`\`json
{
  "title": "블로그 제목 (키워드 포함)",
  "sections": [
    {
      "heading": "소제목 1",
      "body": "본문 내용...",
      "tip": "팁 내용 (없으면 null)"
    }
  ],
  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],
  "imageKeywords": [
    "브랜드/제품명 중심 키워드 1",
    "브랜드 공식 이미지 키워드 2",
    "리뷰 기사 이미지 키워드 3",
    "실사용 장면 키워드 4",
    "비교/핵심 기능 키워드 5"
  ],
  "voiceAnchor": ["기준 문장 1", "기준 문장 2"]
}
\`\`\`

JSON 외 텍스트는 출력하지 마세요.`;
}

// Backward-compatible aliases
export function buildBlogPrompt(params: {
  keyword: string;
  tone: ToneType;
  searchContext: string;
  fixHints?: string[];
}): string {
  return buildDraftPrompt(params);
}

export function buildRefinePrompt(params: {
  keyword: string;
  tone: ToneType;
  searchContext: string;
  fixHints: string[];
  previousJson: string;
}): string {
  return buildCompliancePrompt({
    keyword: params.keyword,
    tone: params.tone,
    searchContext: params.searchContext,
    previousJson: params.previousJson,
    hardFailLabels: params.fixHints,
    softFocusLabels: params.fixHints,
    requestedFixHints: params.fixHints,
  });
}
