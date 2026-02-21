"use client";

import { useState, useRef } from "react";
import { GenerateResponse, ReviewReport, UnsplashImage } from "@/lib/types";

interface BlogResultProps {
  result: GenerateResponse;
  onFixIssue: (issue: string) => void;
  onFixAllIssues: (issues: string[]) => void;
}

export default function BlogResult({
  result,
  onFixIssue,
  onFixAllIssues,
}: BlogResultProps) {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"preview" | "html">("preview");
  const previewRef = useRef<HTMLDivElement>(null);

  async function handleCopyHtml() {
    try {
      // Copy as rich HTML so it pastes into Naver SmartEditor with formatting
      const blob = new Blob([result.html], { type: "text/html" });
      const plainBlob = new Blob([result.html], { type: "text/plain" });
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": blob,
          "text/plain": plainBlob,
        }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: copy as plain text
      await navigator.clipboard.writeText(result.html);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  async function handleDownloadImage(image: UnsplashImage) {
    try {
      // Trigger Unsplash download endpoint (required by API guidelines)
      const accessKey = new URLSearchParams(window.location.search).get(
        "unsplash_key"
      );
      if (image.provider === "unsplash" && accessKey) {
        fetch(
          `${image.downloadUrl}?client_id=${accessKey}`
        ).catch(() => {});
      }
      // Open image in new tab for download
      window.open(image.url, "_blank");
    } catch {
      window.open(image.url, "_blank");
    }
  }

  const review: ReviewReport = result.review ?? {
    overallStatus: "caution",
    score: 0,
    keywordCount: 0,
    keywordDensity: 0,
    flaggedWords: [],
    hardPass: false,
    hardFailLabels: ["검토 리포트"],
    hardChecks: { passed: 0, total: 0 },
    naturalnessScore: 0,
    complianceSoftScore: 0,
    seoScore: 0,
    selectionScore: 0,
    pipelineVersion: "unknown",
    items: [
      {
        label: "검토 리포트",
        status: "warn",
        detail: "이 결과에는 검토 데이터가 없어 새로 생성이 필요합니다.",
        bucket: "hard",
        isHard: true,
      },
    ],
  };

  const overallStatusMeta = {
    safe: {
      label: "양호",
      className:
        "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
    },
    caution: {
      label: "주의",
      className: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
    },
    risk: {
      label: "위험",
      className: "bg-red-500/15 text-red-300 border border-red-500/30",
    },
  }[review.overallStatus];
  const warningItems = review.items.filter((item) => item.status === "warn");
  const hardWarningItems = warningItems.filter((item) => item.isHard);

  return (
    <div className="space-y-6">
      {/* Action Bar */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-white truncate flex-1">
          {result.title}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("preview")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "preview"
                ? "bg-green-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            미리보기
          </button>
          <button
            onClick={() => setActiveTab("html")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "html"
                ? "bg-green-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            HTML 코드
          </button>
          <button
            onClick={handleCopyHtml}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
          >
            {copied ? (
              <>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                복사 완료!
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                  />
                </svg>
                HTML 복사 (네이버 붙여넣기용)
              </>
            )}
          </button>
        </div>
      </div>

      {/* Review Report */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-base font-bold text-white">콘텐츠 검토 리포트</h3>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {warningItems.length > 0 && (
              <button
                onClick={() => onFixAllIssues(warningItems.map((item) => item.label))}
                className="px-3 py-1.5 rounded-md text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 transition-colors"
              >
                주의 항목 일괄 수정
              </button>
            )}
            <span className="text-sm text-zinc-400">선택 점수 {review.score}/100</span>
            <span
              className={`px-2.5 py-1 rounded-md text-xs font-semibold ${overallStatusMeta.className}`}
            >
              {overallStatusMeta.label}
            </span>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl p-3 text-sm">
            <p className="text-zinc-400">Hard 규칙</p>
            <p className={`font-semibold mt-1 ${review.hardPass ? "text-emerald-300" : "text-red-300"}`}>
              {review.hardChecks.passed}/{review.hardChecks.total} 통과
            </p>
          </div>
          <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl p-3 text-sm">
            <p className="text-zinc-400">자연스러움</p>
            <p className="text-white font-semibold mt-1">
              {review.naturalnessScore}
            </p>
          </div>
          <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl p-3 text-sm">
            <p className="text-zinc-400">SEO 점수</p>
            <p className="text-white font-semibold mt-1">
              {review.seoScore}
            </p>
          </div>
          <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl p-3 text-sm">
            <p className="text-zinc-400">키워드 밀도</p>
            <p className="text-white font-semibold mt-1">
              {review.keywordDensity}% ({review.keywordCount}회)
            </p>
          </div>
        </div>

        {result.qualityGate && (
          <div className="mb-4 bg-zinc-800/50 border border-zinc-700 rounded-xl p-3 text-sm text-zinc-300">
            <p>{result.qualityGate.message}</p>
            <p className="mt-1 text-xs text-zinc-500">
              pipeline: {result.qualityGate.pipelineVersion} / 자연스러움 목표 {result.qualityGate.naturalnessTarget}
            </p>
            {result.usedModel && (
              <p className="mt-1 text-xs text-zinc-500">
                사용 모델: {result.usedModel}
              </p>
            )}
          </div>
        )}

        <div className="space-y-2">
          {review.items.map((item) => (
            <div
              key={item.label}
              className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-zinc-200 font-medium">{item.label}</p>
                <div className="flex items-center gap-2">
                  {item.status === "warn" && (
                    <button
                      onClick={() => onFixIssue(item.label)}
                      className="px-2.5 py-1 rounded text-xs font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25 transition-colors"
                    >
                      AI 수정
                    </button>
                  )}
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded ${
                      item.status === "pass"
                        ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                        : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                    }`}
                  >
                    {item.status === "pass" ? "통과" : "주의"}
                  </span>
                </div>
              </div>
              <p className="text-sm text-zinc-400 mt-1">{item.detail}</p>
            </div>
          ))}
        </div>

        {review.flaggedWords.length > 0 && (
          <p className="text-sm text-red-300 mt-4">
            금칙어 감지: {review.flaggedWords.join(", ")}
          </p>
        )}

        {hardWarningItems.length > 0 && (
          <p className="text-sm text-amber-300 mt-2">
            Hard 미통과: {hardWarningItems.map((item) => item.label).join(", ")}
          </p>
        )}
      </div>

      {/* Preview / HTML */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        {activeTab === "preview" ? (
          <div
            ref={previewRef}
            className="bg-white p-6 sm:p-10 rounded-2xl"
            dangerouslySetInnerHTML={{ __html: result.html }}
          />
        ) : (
          <div className="p-4 overflow-x-auto">
            <pre className="text-sm text-zinc-300 whitespace-pre-wrap break-all font-mono">
              {result.html}
            </pre>
          </div>
        )}
      </div>

      {/* Images Gallery */}
      {result.images.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <h3 className="text-base font-bold text-white mb-4">
            검색된 이미지 ({result.images.length}개)
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {result.images.map((img) => (
              <div
                key={img.id}
                className="group relative rounded-xl overflow-hidden border border-zinc-700"
              >
                <img
                  src={img.thumbUrl}
                  alt={img.alt}
                  className="w-full aspect-video object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <button
                    onClick={() => handleDownloadImage(img)}
                    className="px-3 py-1.5 bg-white text-black rounded-lg text-xs font-medium hover:bg-zinc-200 transition-colors"
                  >
                    다운로드
                  </button>
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                  <p className="text-xs text-zinc-300 truncate">{img.alt}</p>
                  <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                    {img.provider === "brave"
                      ? `출처: ${img.sourceName || img.photographer}`
                      : `Unsplash · ${img.photographer}`}
                  </p>
                </div>
                {result.thumbnail?.id === img.id && (
                  <div className="absolute top-2 left-2 px-2 py-0.5 bg-green-600 rounded text-xs text-white font-medium">
                    썸네일
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tags */}
      {result.tags.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <h3 className="text-base font-bold text-white mb-3">추천 태그</h3>
          <div className="flex flex-wrap gap-2">
            {result.tags.map((tag) => (
              <span
                key={tag}
                className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-300"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
