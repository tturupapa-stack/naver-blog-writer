import { NextRequest, NextResponse } from "next/server";
import { UnsplashImage } from "@/lib/types";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query");
  if (!query) {
    return NextResponse.json(
      { error: "query is required" },
      { status: 400 }
    );
  }

  const accessKey =
    process.env.UNSPLASH_ACCESS_KEY ||
    process.env.NEXT_PUBLIC_UNSPLASH_ACCESS_KEY;
  if (!accessKey) {
    return NextResponse.json(
      { error: "UNSPLASH_ACCESS_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=6&orientation=landscape`,
      {
        headers: {
          Authorization: `Client-ID ${accessKey}`,
        },
      }
    );

    if (!res.ok) {
      console.error("Unsplash API error:", res.status);
      return NextResponse.json({ images: [] });
    }

    const data = await res.json();
    const images: UnsplashImage[] = data.results.map(
      (photo: {
        id: string;
        urls: { regular: string; small: string };
        links: { download: string };
        alt_description: string | null;
        description: string | null;
        user: { name: string; links: { html: string } };
      }) => ({
        id: photo.id,
        url: photo.urls.regular,
        thumbUrl: photo.urls.small,
        downloadUrl: photo.links.download,
        alt: photo.alt_description || photo.description || query,
        photographer: photo.user.name,
        photographerUrl: photo.user.links.html,
      })
    );

    return NextResponse.json({ images });
  } catch (error) {
    console.error("Image search error:", error);
    return NextResponse.json({ images: [] });
  }
}
