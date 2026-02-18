import { ToneType } from "./types";

const TONE_DESCRIPTIONS: Record<ToneType, string> = {
  informative: "정보성 글: 객관적이고 신뢰감 있는 톤. 정확한 정보 전달에 초점. '~입니다', '~합니다' 체를 사용.",
  experience: "경험담 글: 친근하고 개인적인 톤. 실제 경험한 것처럼 자연스럽게. '~했어요', '~더라고요' 체를 사용.",
  review: "리뷰 글: 솔직하고 상세한 톤. 장단점을 균형있게. '~인데요', '~거든요' 체를 사용.",
  guide: "가이드 글: 단계별로 친절한 톤. 따라하기 쉽게 설명. '~해보세요', '~하면 됩니다' 체를 사용.",
};

const FIX_HINT_GUIDE: Record<string, string> = {
  "SEO: 제목 키워드 포함": "제목에 메인 키워드를 정확히 포함하세요.",
  "SEO: 첫 문단 키워드 포함": "첫 문단(도입부 2~3문장)에 메인 키워드를 자연스럽게 1회 이상 넣으세요.",
  "SEO: 소제목 키워드 반영": "소제목 중 최소 2개에 메인 키워드 또는 밀접한 연관 표현을 포함하세요.",
  "키워드 밀도":
    "전체 본문에서 메인 키워드가 자연스럽게 5~8회 등장하도록 조정하세요. 과도 반복은 금지합니다.",
  "본문 길이": "본문은 1800~3000자 범위를 우선 목표로 작성하세요.",
  "저품질 위험 패턴":
    "과도한 감탄사/반복 문장부호를 제거하고 문장 길이와 표현을 자연스럽게 분산하세요.",
  "AI 티 문체 점검":
    "AI가 쓴 듯한 정형 문구(예: '이 글에서는', '결론적으로')를 줄이고 실제 경험/맥락이 드러나는 자연스러운 문체로 작성하세요.",
  "금칙어 점검":
    "과장/보장/불법성으로 해석될 수 있는 표현을 제거하고 중립적인 문장으로 교체하세요.",
  "태그 개수": "태그를 5~8개 범위로 맞추고 키워드 연관성을 유지하세요.",
};

export function buildBlogPrompt(params: {
  keyword: string;
  tone: ToneType;
  searchContext: string;
  fixHints?: string[];
}): string {
  const { keyword, tone, searchContext, fixHints } = params;
  const toneDesc = TONE_DESCRIPTIONS[tone];
  const hasFixHints = Array.isArray(fixHints) && fixHints.length > 0;
  const fixGuides = hasFixHints
    ? fixHints.map((hint) => FIX_HINT_GUIDE[hint] || `${hint} 항목을 통과하도록 수정`)
    : [];

  return `당신은 네이버 블로그 전문 작가입니다. 아래 조건에 맞는 블로그 글을 작성하세요.

## 키워드
${keyword}

## 글 톤/스타일
${toneDesc}

## 최신 정보 (참고용)
${searchContext || "최신 검색 결과 없음"}

## 우선 개선할 항목
${
  hasFixHints
    ? fixHints.map((hint) => `- ${hint}`).join("\n")
    : "- 없음"
}

## 우선 개선 방법
${hasFixHints ? fixGuides.map((guide) => `- ${guide}`).join("\n") : "- 없음"}

## 반드시 지켜야 할 규칙

### SEO 최적화
- 제목에 반드시 키워드 "${keyword}" 포함
- 첫 문단에 키워드를 자연스럽게 1-2회 포함
- 각 소제목에도 키워드 또는 관련 표현 포함
- 키워드 밀도: 전체 글에서 키워드가 자연스럽게 5-8회 등장 (과다 사용 금지)
- 이전 결과에서 개선 요청이 들어온 항목은 우선순위로 반영
- 개선 요청이 들어온 항목은 가능한 한 모두 "통과" 상태를 목표로 작성

### 글 구조
- 소제목 4-5개로 구성
- 각 소제목 아래 2-3개 문단
- 전체 글 길이: 2000-3000자
- 마지막에 간단한 마무리 문단

### 네이버 저품질 방지
- 자연스러운 한국어 문체 사용
- 키워드 나열/스팸 금지
- 복사한 듯한 문장 금지
- 독창적이고 읽기 편한 글

### AI 티 방지
- "이 글에서는, 결론적으로, 요약하면" 같은 정형 문구 남발 금지
- 문장 시작 패턴 반복 금지 (같은 어휘로 연속 시작하지 않기)
- 실제 사용 맥락/경험 뉘앙스를 넣어 사람 글처럼 자연스럽게 작성

### 유용한 팁
- 적절한 곳에 TIP 박스로 표시할 유용한 정보 1-2개 포함

## 출력 형식 (반드시 이 JSON 형식으로)
\`\`\`json
{
  "title": "블로그 제목 (키워드 포함)",
  "sections": [
    {
      "heading": "소제목 1",
      "body": "본문 내용...",
      "tip": "팁 내용 (없으면 null)"
    },
    {
      "heading": "소제목 2",
      "body": "본문 내용...",
      "tip": null
    }
  ],
  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],
  "imageKeywords": ["영문 이미지 검색 키워드1", "영문 이미지 검색 키워드2", "영문 이미지 검색 키워드3"]
}
\`\`\`

tags: 네이버 블로그에 사용할 한글 태그 5-8개 (키워드 관련)
imageKeywords: Unsplash에서 검색할 영문 키워드 3개 (글 내용과 관련된 실사 이미지)

JSON만 출력하세요. 다른 설명은 필요 없습니다.`;
}

export function buildRefinePrompt(params: {
  keyword: string;
  tone: ToneType;
  searchContext: string;
  fixHints: string[];
  previousJson: string;
}): string {
  const { keyword, tone, searchContext, fixHints, previousJson } = params;
  const toneDesc = TONE_DESCRIPTIONS[tone];
  const fixGuides = fixHints.map(
    (hint) => FIX_HINT_GUIDE[hint] || `${hint} 항목을 통과하도록 수정`
  );

  return `당신은 네이버 블로그 전문 편집자입니다. 기존 원고를 개선해 기준을 충족시키세요.

## 메인 키워드
${keyword}

## 글 톤/스타일
${toneDesc}

## 최신 정보 (참고용)
${searchContext || "최신 검색 결과 없음"}

## 반드시 개선할 항목
${fixHints.map((hint) => `- ${hint}`).join("\n")}

## 개선 가이드
${fixGuides.map((guide) => `- ${guide}`).join("\n")}

## 기존 원고(JSON)
\`\`\`json
${previousJson}
\`\`\`

## 수정 원칙
- 기존 글의 핵심 맥락은 유지하되, 반드시 개선 항목을 해결
- 사람의 실제 작성처럼 자연스러운 문체 사용
- 키워드 과다 반복은 금지
- 전체 길이는 2000~3000자 목표

## 출력 형식
아래 JSON만 출력하세요.
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
  "imageKeywords": ["english keyword 1", "english keyword 2", "english keyword 3"]
}
\`\`\``;
}
