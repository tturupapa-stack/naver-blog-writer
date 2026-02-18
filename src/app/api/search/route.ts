import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const keyword = req.nextUrl.searchParams.get("keyword");
  if (!keyword) {
    return NextResponse.json(
      { error: "keyword is required" },
      { status: 400 }
    );
  }

  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ results: [] });
  }

  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(keyword)}&count=5&search_lang=ko`,
      {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
      }
    );

    if (!res.ok) {
      console.error("Brave Search API error:", res.status);
      return NextResponse.json({ results: [] });
    }

    const data = await res.json();
    const results = (data.web?.results ?? [])
      .slice(0, 5)
      .map((r: { title: string; description: string; url: string }) => ({
        title: r.title,
        description: r.description,
        url: r.url,
      }));

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json({ results: [] });
  }
}
