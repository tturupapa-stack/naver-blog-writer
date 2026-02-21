"use client";

import { useState } from "react";
import { ToneType, GenerateResponse } from "@/lib/types";
import BlogResult from "./BlogResult";

const TONES: { value: ToneType; label: string; desc: string }[] = [
  { value: "informative", label: "정보성", desc: "객관적 정보 전달" },
  { value: "experience", label: "경험담", desc: "개인 경험 공유" },
  { value: "review", label: "리뷰", desc: "솔직한 장단점 분석" },
  { value: "guide", label: "가이드", desc: "단계별 친절한 설명" },
];

export default function BlogGenerator() {
  const [keyword, setKeyword] = useState("");
  const [tone, setTone] = useState<ToneType>("experience");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [loadingLabel, setLoadingLabel] = useState("생성 중...");

  async function handleGenerate(fixHints?: string[]) {
    if (!keyword.trim()) {
      setError("키워드를 입력해주세요.");
      return;
    }

    setLoading(true);
    setLoadingLabel(fixHints?.length ? "주의 항목 수정 중..." : "생성 중...");
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: keyword.trim(), tone, fixHints }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "생성에 실패했습니다.");
      }

      setResult(data as GenerateResponse);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "알 수 없는 에러가 발생했습니다."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Input Section */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-8">
        <div className="mb-5">
          <label
            htmlFor="keyword"
            className="block text-sm font-medium text-zinc-400 mb-2"
          >
            키워드 입력
          </label>
          <div className="flex gap-3">
            <input
              id="keyword"
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !loading) handleGenerate();
              }}
              placeholder="예: 제주도 맛집, 아이폰 16 리뷰, 홈카페 레시피"
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition-colors"
            />
            <button
              onClick={() => handleGenerate()}
              disabled={loading}
              className="px-6 py-3 bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium rounded-xl transition-colors whitespace-nowrap"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg
                    className="animate-spin h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  생성 중...
                </span>
              ) : (
                "블로그 글 생성"
              )}
            </button>
          </div>
        </div>

        {/* Tone Selection */}
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-2">
            글 톤 선택
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {TONES.map((t) => (
              <button
                key={t.value}
                onClick={() => setTone(t.value)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  tone === t.value
                    ? "border-green-500 bg-green-500/10 text-green-400"
                    : "border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600"
                }`}
              >
                <div className="font-medium text-sm">{t.label}</div>
                <div className="text-xs mt-0.5 opacity-70">{t.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center">
          <div className="inline-flex items-center gap-3 text-zinc-400">
            <svg
              className="animate-spin h-6 w-6 text-green-500"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <div>
              <p className="font-medium text-white">블로그 글을 생성하고 있습니다...</p>
              <p className="text-sm mt-1 text-zinc-300">{loadingLabel}</p>
              <p className="text-sm mt-1">
                키워드 검색, AI 글 작성, 이미지 검색을 진행 중입니다
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Result */}
      {result && !loading && (
        <BlogResult
          result={result}
          onFixIssue={(issue) => handleGenerate([issue])}
          onFixAllIssues={(issues) => handleGenerate(issues)}
        />
      )}
    </div>
  );
}
