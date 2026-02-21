import BlogGenerator from "@/components/BlogGenerator";

export default function Home() {
  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="border-b border-zinc-800">
        <div className="max-w-4xl mx-auto px-4 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center font-bold text-sm">
              N
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">
                네이버 블로그 글 생성기
              </h1>
              <p className="text-xs text-zinc-500">
                키워드 입력 → AI 글 생성 → 네이버 블로그에 붙여넣기
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        <BlogGenerator />
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 mt-12">
        <div className="max-w-4xl mx-auto px-4 py-6 text-center text-xs text-zinc-600">
          <p>
            이미지 출처:{" "}
            <a
              href="https://unsplash.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-500 hover:text-zinc-400 underline"
            >
              Unsplash
            </a>{" "}
            | AI 텍스트 생성: OpenAI (선택 모델) | 검색: Brave Search
          </p>
          <p className="mt-1">
            생성된 글은 참고용입니다. 발행 전 내용을 검토해주세요.
          </p>
        </div>
      </footer>
    </div>
  );
}
