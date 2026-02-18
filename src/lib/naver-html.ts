import { UnsplashImage } from "./types";

export function buildNaverHtml(params: {
  title: string;
  sections: {
    heading?: string;
    body: string;
    tip?: string;
  }[];
  images: UnsplashImage[];
  keyword: string;
}): string {
  const { title, sections, images, keyword } = params;

  const imageInsertPoints = getImageInsertPoints(sections.length, images.length);

  let html = `<div style="font-family: 'Noto Sans KR', 'Malgun Gothic', sans-serif; line-height: 1.8; color: #333; max-width: 100%;">`;

  // Title
  html += `<p style="font-size: 24px; font-weight: bold; color: #333; margin: 0 0 20px 0; text-align: center;">${escapeHtml(title)}</p>`;
  html += `<div style="width: 60px; height: 3px; background: #2db400; margin: 0 auto 30px auto;"></div>`;

  let imageIndex = 0;

  sections.forEach((section, sectionIdx) => {
    // Heading
    if (section.heading) {
      html += `<p style="font-size: 20px; font-weight: bold; color: #2db400; margin: 30px 0 15px 0; padding-bottom: 8px; border-bottom: 2px solid #2db400;">${escapeHtml(section.heading)}</p>`;
    }

    // Body paragraphs
    const paragraphs = section.body.split("\n").filter((p) => p.trim());
    paragraphs.forEach((para) => {
      html += `<p style="font-size: 16px; line-height: 1.8; margin: 10px 0; color: #333;">${para}</p>`;
    });

    // Tip box
    if (section.tip) {
      html += `<div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #2db400; margin: 20px 0; font-size: 15px; color: #555;">💡 ${escapeHtml(section.tip)}</div>`;
    }

    // Image
    if (imageInsertPoints.includes(sectionIdx) && imageIndex < images.length) {
      const img = images[imageIndex];
      html += buildImageBlock(img);
      imageIndex++;
    }
  });

  // Keyword tag at the bottom
  html += `<p style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 14px; color: #888;">#${escapeHtml(keyword)}</p>`;
  html += `</div>`;

  return html;
}

function buildImageBlock(img: UnsplashImage): string {
  return `<div style="text-align: center; margin: 25px 0;">
<img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt)}" style="max-width: 100%; border-radius: 8px;" />
<p style="font-size: 12px; color: #999; margin-top: 8px;">Photo by <a href="${escapeHtml(img.photographerUrl)}?utm_source=naver_blog_writer&utm_medium=referral" style="color: #999; text-decoration: underline;" target="_blank" rel="noopener noreferrer">${escapeHtml(img.photographer)}</a> on <a href="https://unsplash.com?utm_source=naver_blog_writer&utm_medium=referral" style="color: #999; text-decoration: underline;" target="_blank" rel="noopener noreferrer">Unsplash</a></p>
</div>`;
}

function getImageInsertPoints(
  totalSections: number,
  imageCount: number
): number[] {
  if (totalSections <= 1 || imageCount === 0) return [0];
  const points: number[] = [];
  const step = Math.floor(totalSections / (imageCount + 1));
  for (let i = 0; i < imageCount; i++) {
    points.push(Math.min(step * (i + 1), totalSections - 1));
  }
  return points;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
