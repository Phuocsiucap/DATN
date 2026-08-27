import { readFile } from "node:fs/promises";
import * as cheerio from "cheerio";

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

const DETAIL_SELECTOR = "article.fck_detail, article .fck_detail, section.fck_detail, .fck_detail";

function cleanUrl(value) {
  if (!value) return "";
  return value
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .trim();
}

function isBlockedImage(url) {
  const clean = cleanUrl(url).toLowerCase();
  return (
    !clean ||
    clean.includes(".svg") ||
    clean.includes("nguonuutien.jpg") ||
    clean.includes("/logos/") ||
    clean.includes("/graphics/logo")
  );
}

function isVideoObject(node) {
  const type = node?.["@type"];
  if (Array.isArray(type)) {
    return type.some((item) => String(item).toLowerCase() === "videoobject");
  }
  return String(type || "").toLowerCase() === "videoobject";
}

function collectVideoObjects(node, output = []) {
  if (!node || typeof node !== "object") return output;

  if (Array.isArray(node)) {
    node.forEach((item) => collectVideoObjects(item, output));
    return output;
  }

  if (isVideoObject(node)) {
    output.push(node);
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === "object") {
      collectVideoObjects(value, output);
    }
  }

  return output;
}

function extractJsonLdVideos($) {
  const videos = [];

  $('script[type="application/ld+json"]').each((_, script) => {
    const raw = $(script).text().trim();
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      for (const video of collectVideoObjects(parsed)) {
        videos.push({
          source: "json-ld",
          name: video.name || "",
          description: video.description || "",
          thumbnailUrl: cleanUrl(
            Array.isArray(video.thumbnailUrl) ? video.thumbnailUrl[0] : video.thumbnailUrl
          ),
          uploadDate: video.uploadDate || "",
          duration: video.duration || "",
          contentUrl: cleanUrl(
            Array.isArray(video.contentUrl) ? video.contentUrl[0] : video.contentUrl
          ),
          embedUrl: cleanUrl(
            Array.isArray(video.embedUrl) ? video.embedUrl[0] : video.embedUrl
          )
        });
      }
    } catch {
      // Some pages contain non-strict JSON-LD. Regex fallback below still catches media URLs.
    }
  });

  return videos;
}

function collectImageObjects(node, output = []) {
  if (!node || typeof node !== "object") return output;

  if (Array.isArray(node)) {
    node.forEach((item) => collectImageObjects(item, output));
    return output;
  }

  if (node["@type"] === "ImageObject" && node.url) {
    output.push({
      src: cleanUrl(node.url),
      alt: node.caption || "",
      caption: node.caption || ""
    });
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === "object") {
      collectImageObjects(value, output);
    }
  }

  return output;
}

function extractJsonLdImages($) {
  const images = [];

  $('script[type="application/ld+json"]').each((_, script) => {
    const raw = $(script).text().trim();
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      images.push(...collectImageObjects(parsed));
    } catch {
      // Ignore non-strict JSON-LD.
    }
  });

  return images;
}

function detectVideoKind(url) {
  if (/\.m3u8(?:[?#]|$)/i.test(url)) return "hls";
  if (/\.mp4(?:[?#]|$)/i.test(url)) return "mp4";
  return "embed";
}

function detectMimeType(url, fallback = "") {
  if (fallback) return fallback;
  if (/\.m3u8(?:[?#]|$)/i.test(url)) return "application/x-mpegURL";
  if (/\.mp4(?:[?#]|$)/i.test(url)) return "video/mp4";
  return "";
}

function parseEmbedVideoUrl(rawUrl) {
  const result = {
    playbackUrl: rawUrl,
    embedUrl: "",
    thumbnail: "",
    provider: ""
  };

  try {
    const parsed = new URL(rawUrl);
    result.provider = parsed.hostname;

    const file = cleanUrl(parsed.searchParams.get("file"));
    const poster = cleanUrl(parsed.searchParams.get("poster"));

    if (file) {
      result.playbackUrl = file;
      result.embedUrl = rawUrl;
    }

    if (poster) {
      result.thumbnail = poster;
    }
  } catch {
    // Keep the original URL when it is not an absolute URL.
  }

  return result;
}

function normalizeVideo(rawVideo) {
  const rawUrl = cleanUrl(rawVideo.contentUrl || rawVideo.src || rawVideo.embedUrl || rawVideo.url);
  const embedData = parseEmbedVideoUrl(rawUrl);
  const url = embedData.playbackUrl;
  const qualities = String(rawVideo.modes || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    url,
    kind: detectVideoKind(url),
    mimeType: detectMimeType(url, rawVideo.type || ""),
    embedUrl: embedData.embedUrl || cleanUrl(rawVideo.embedUrl || ""),
    provider: embedData.provider,
    title: rawVideo.name || rawVideo.title || "",
    description: rawVideo.description || "",
    thumbnail: cleanUrl(rawVideo.thumbnailUrl || rawVideo.poster || embedData.thumbnail),
    uploadDate: rawVideo.uploadDate || "",
    duration: rawVideo.duration || "",
    qualities,
    maxQuality: rawVideo.maxMode || "",
    extractionSource: rawVideo.source || ""
  };
}

function mergeVideoData(existing, incoming) {
  const extractionSources = [existing.extractionSource, incoming.extractionSource]
    .flatMap((value) => String(value || "").split(","))
    .map((source) => source.trim())
    .filter(Boolean)
    .filter((source, index, sources) => sources.indexOf(source) === index);

  return {
    url: existing.url,
    kind: existing.kind || incoming.kind,
    mimeType: existing.mimeType || incoming.mimeType,
    embedUrl: existing.embedUrl || incoming.embedUrl,
    provider: existing.provider || incoming.provider,
    title: existing.title || incoming.title,
    description: existing.description || incoming.description,
    thumbnail: existing.thumbnail || incoming.thumbnail,
    uploadDate: existing.uploadDate || incoming.uploadDate,
    duration: existing.duration || incoming.duration,
    qualities: existing.qualities.length ? existing.qualities : incoming.qualities,
    maxQuality: existing.maxQuality || incoming.maxQuality,
    extractionSource: extractionSources.join(",")
  };
}

function normalizeVideos(rawVideos) {
  const byUrl = new Map();

  for (const rawVideo of rawVideos) {
    const video = normalizeVideo(rawVideo);
    if (!video.url) continue;

    const existing = byUrl.get(video.url);
    byUrl.set(video.url, existing ? mergeVideoData(existing, video) : video);
  }

  return Array.from(byUrl.values());
}

function dedupeImages(images) {
  const bySrc = new Map();

  for (const image of images) {
    if (!image?.src || isBlockedImage(image.src) || bySrc.has(image.src)) continue;
    bySrc.set(image.src, image);
  }

  return Array.from(bySrc.values());
}

function getCategoryName($) {
  const direct = $('meta[name="tt_site_id_detail"]').attr("catename");
  if (direct) return direct;

  const folderNames = $('meta[name="tt_list_folder_name"]').attr("content") || "";
  const names = folderNames
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item && item.toLowerCase() !== "vnexpress");
  return names.at(-1) || "";
}

function extractDomVideos($) {
  const videos = [];

  $(`${DETAIL_SELECTOR} video, video`).each((_, video) => {
    const el = $(video);
    const src = cleanUrl(el.attr("src") || el.attr("data-src"));
    if (src && !src.startsWith("blob:")) {
      videos.push({
        source: "video-tag",
        src,
        type: el.attr("type") || "",
        poster: cleanUrl(el.attr("poster") || el.attr("data-poster")),
        modes: el.attr("data-mode") || "",
        maxMode: el.attr("max-mode") || ""
      });
    }

    el.find("source").each((_, source) => {
      const sourceEl = $(source);
      const sourceSrc = cleanUrl(sourceEl.attr("src") || sourceEl.attr("data-src"));
      if (sourceSrc) {
        videos.push({
          source: "video-source",
          src: sourceSrc,
          type: sourceEl.attr("type") || ""
        });
      }
    });
  });

  $(`${DETAIL_SELECTOR} iframe, iframe`).each((_, iframe) => {
    const el = $(iframe);
    const wrapper = el.closest("div");
    const nearbyTitle = normalizeText(
      wrapper
        .prevAll("p")
        .filter((_, paragraph) => $(paragraph).find("strong").length > 0)
        .first()
        .text()
    );
    const src = cleanUrl(el.attr("src") || el.attr("data-src"));
    if (src) {
      videos.push({
        source: "iframe",
        embedUrl: src,
        title: el.attr("title") || nearbyTitle
      });
    }
  });

  $(
    [
      "article.fck_detail [data-video-src]",
      "article.fck_detail [data-file]",
      "article.fck_detail [data-url]",
      "article.fck_detail [data-source]",
      "article.fck_detail [data-src]",
      "article .fck_detail [data-video-src]",
      "article .fck_detail [data-file]",
      "article .fck_detail [data-url]",
      "article .fck_detail [data-source]",
      "article .fck_detail [data-src]",
      "section.fck_detail [data-video-src]",
      "section.fck_detail [data-file]",
      "section.fck_detail [data-url]",
      "section.fck_detail [data-source]",
      "section.fck_detail [data-src]"
    ].join(",")
  ).each((_, node) => {
    const el = $(node);
    for (const attr of ["data-video-src", "data-file", "data-url", "data-source", "data-src"]) {
      const src = cleanUrl(el.attr(attr));
      if (src && /\.(m3u8|mp4)(?:[?#].*)?$/i.test(src)) {
        videos.push({
          source: `data-attr:${attr}`,
          src
        });
      }
    }
  });

  return videos;
}

function extractRegexVideos(html) {
  const videos = [];
  const pattern = /https?:\\?\/\\?\/[^"'\s<>]+?\.(?:m3u8|mp4)(?:[^"'\s<>]*)?/gi;

  for (const match of html.matchAll(pattern)) {
    videos.push({
      source: "regex",
      src: cleanUrl(match[0])
    });
  }

  return videos;
}

async function loadHtml(source) {
  if (!/^https?:\/\//i.test(source)) {
    return readFile(source, "utf8");
  }

  const res = await fetch(source, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  return res.text();
}

async function getVnExpressDetail(source) {
  const html = await loadHtml(source);
  const $ = cheerio.load(html);

  const articleId = $('meta[name="tt_article_id"]').attr("content");
  const categoryId = $('meta[name="tt_category_id"]').attr("content");
  const categoryName = getCategoryName($);
  const siteId = $('meta[name="tt_site_id"]').attr("content");

  const title = $("h1.title-detail").first().text().trim();
  const lead = $("p.description").first().text().trim();
  const publishedAt =
    $('meta[itemprop="datePublished"]').attr("content") ||
    $('meta[name="pubdate"]').attr("content");
  const detailRoot = $(DETAIL_SELECTOR).first();

  const content = detailRoot
    .find("p.Normal")
    .map((_, el) => normalizeText($(el).text()))
    .get()
    .filter(Boolean)
    .join("\n\n");

  const metadataImages = [
    {
      src: cleanUrl($('meta[property="og:image"]').attr("content")),
      alt: $('meta[property="og:image:alt"]').attr("content") || "",
      caption: $('meta[property="og:image:alt"]').attr("content") || ""
    },
    ...extractJsonLdImages($)
  ].filter((image) => image.src && !isBlockedImage(image.src));

  const figureImages = detailRoot
    .find("figure")
    .map((_, fig) => {
      const figure = $(fig);
      if (figure.find("video, iframe, .box_embed_video_parent, [data-vid]").length) return null;

      const img = $(fig).find("img").first();
      const src = cleanUrl(img.attr("data-src") || img.attr("src"));
      if (!src || src.startsWith("data:") || isBlockedImage(src)) return null;

      return {
        src,
        alt: img.attr("alt"),
        caption: normalizeText(figure.find("figcaption").text())
      };
    })
    .get();

  const images = dedupeImages([...metadataImages, ...figureImages]);
  const videoThumbnailUrls = new Set(
    extractJsonLdVideos($)
      .map((video) => video.thumbnailUrl)
      .filter(Boolean)
  );
  const filteredImages = images.filter((image) => !videoThumbnailUrls.has(image.src));
  const videos = normalizeVideos([
    ...extractJsonLdVideos($),
    ...extractDomVideos($),
    ...extractRegexVideos(html)
  ]);

  return {
    articleId,
    categoryId,
    categoryName,
    siteId,
    title,
    lead,
    publishedAt,
    content,
    images: filteredImages,
    videos,
    url: source
  };
}

const input =
  process.argv[2] ||
  "https://vnexpress.net/ket-qua-viet-nam-vs-thai-lan-5113742-tong-thuat.html";

const result = await getVnExpressDetail(input);
console.dir(result, { depth: null });
