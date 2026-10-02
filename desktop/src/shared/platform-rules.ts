// Publishing limits of each platform, checked live in the composer.
// Only limits the platforms document or enforce in their editors are listed; anything unknown is not checked.
// Issues are warnings unless the platform is known to reject the post outright ("error").

import type { ContentType, LocalFile } from "./types";

export interface PlatformRules {
  /** How the platform counts text: people-visible characters (default), X's weighted count, or UTF-8 bytes. */
  textCount?: "graphemes" | "x-weighted" | "bytes";
  /** Limits the platform enforces for every account (errors). Others are warnings (e.g. X Premium allows more). */
  strict?: boolean;
  titleMax?: number;
  titleRequired?: boolean;
  textMax?: number; // body text (for X etc. the whole post)
  countTitleInText?: boolean; // platforms that publish title + text as one caption
  tagsMax?: number;
  tagMaxLength?: number;
  tagsTotalChars?: number; // YouTube: all tags together
  tagsInText?: boolean; // tags become #hashtags inside the caption (counted against textMax)
  imagesMax?: number;
  mediaRequired?: boolean; // needs at least one image or video
  imageRequired?: boolean;
  videoMaxSec?: number;
  preferVertical?: boolean;
  coverAspect?: number; // expected width/height of the cover
}

/** Rules per platform name (see the extension's InfoMaps). */
export const PLATFORM_RULES: Record<string, PlatformRules> = {
  DYNAMIC_X: {
    textMax: 280,
    textCount: "x-weighted",
    countTitleInText: true,
    tagsInText: true,
    imagesMax: 4,
    videoMaxSec: 140,
  },
  DYNAMIC_THREADS: {
    textMax: 500,
    strict: true,
    countTitleInText: true,
    tagsInText: true,
    imagesMax: 20,
    videoMaxSec: 300,
  },
  DYNAMIC_BLUESKY: {
    textMax: 300,
    strict: true,
    countTitleInText: true,
    tagsInText: true,
    imagesMax: 4,
    videoMaxSec: 180,
  },
  VIDEO_BLUESKY: { textMax: 300, strict: true, countTitleInText: true, tagsInText: true, videoMaxSec: 180 },
  DYNAMIC_INSTAGRAM: {
    textMax: 2200,
    strict: true,
    countTitleInText: true,
    tagsInText: true,
    tagsMax: 30,
    imagesMax: 20,
    mediaRequired: true,
  },
  DYNAMIC_FACEBOOK: { textMax: 63206, countTitleInText: true, tagsInText: true },
  DYNAMIC_LINKEDIN: { textMax: 3000, countTitleInText: true, tagsInText: true },
  DYNAMIC_REDDIT: { titleRequired: true, titleMax: 300 },
  DYNAMIC_PINTEREST: { titleMax: 100, textMax: 500, imageRequired: true },
  DYNAMIC_WEIBO: { textMax: 2000, countTitleInText: true, tagsInText: true, imagesMax: 18 },
  VIDEO_WEIBO: { textMax: 2000, titleMax: 30 },
  DYNAMIC_REDNOTE: { titleMax: 20, textMax: 1000, strict: true, imagesMax: 18, mediaRequired: true, tagsInText: true },
  VIDEO_REDNOTE: { titleMax: 20, textMax: 1000, strict: true, tagsInText: true, preferVertical: true },
  DYNAMIC_DOUYIN: { titleMax: 20, textMax: 1000, imagesMax: 35, mediaRequired: true, tagsInText: true },
  VIDEO_DOUYIN: { titleMax: 30, textMax: 1000, tagsInText: true, preferVertical: true },
  VIDEO_TIKTOK: { textMax: 2200, countTitleInText: true, tagsInText: true, videoMaxSec: 3600, preferVertical: true },
  VIDEO_YOUTUBE: {
    titleRequired: true,
    titleMax: 100,
    textMax: 5000,
    textCount: "bytes",
    strict: true,
    tagsTotalChars: 500,
    coverAspect: 16 / 9,
  },
  VIDEO_BILIBILI: {
    titleRequired: true,
    titleMax: 80,
    textMax: 2000,
    tagsMax: 10,
    tagMaxLength: 20,
    coverAspect: 16 / 10,
  },
  VIDEO_KUAISHOU: { textMax: 500, tagsInText: true, preferVertical: true },
  VIDEO_WEIXINCHANNEL: { titleMax: 16, textMax: 1000, preferVertical: true },
  DYNAMIC_WEIXINCHANNEL: { titleMax: 16, textMax: 1000, mediaRequired: true },
  DYNAMIC_KUAISHOU: { textMax: 500, mediaRequired: true },
  DYNAMIC_ZHIHU: { textMax: 1000 },
};

const GENERIC_BY_TYPE: Record<ContentType, PlatformRules> = {
  DYNAMIC: {},
  ARTICLE: { titleRequired: true },
  VIDEO: {},
  PODCAST: { titleRequired: true },
};

export function rulesFor(platform: string, type: ContentType): PlatformRules {
  return { ...GENERIC_BY_TYPE[type], ...(PLATFORM_RULES[platform] ?? {}) };
}

export type IssueCode =
  | "titleRequired"
  | "titleTooLong"
  | "textTooLong"
  | "tooManyTags"
  | "tagTooLong"
  | "tagsTooLong"
  | "tooManyImages"
  | "needsMedia"
  | "needsImage"
  | "videoTooLong"
  | "preferVertical"
  | "coverAspect";

export interface Issue {
  level: "error" | "warn" | "info";
  code: IssueCode;
  vars?: Record<string, string | number>;
}

export interface CheckInput {
  type: ContentType;
  title: string;
  content: string;
  tags: string[];
  images: LocalFile[];
  videos: LocalFile[]; // DYNAMIC videos, or [draft.video] for VIDEO
  cover?: LocalFile;
}

/** Characters as people count them (emoji and CJK count once). */
export function charCount(text: string): number {
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    let n = 0;
    for (const _ of seg.segment(text)) n++;
    return n;
  } catch {
    return [...text].length;
  }
}

/**
 * X's weighted length (twitter-text v3): most Latin/punctuation counts 1, CJK and emoji count 2,
 * and every link counts 23 regardless of its length.
 */
export function xWeightedLength(text: string): number {
  const URL = /https?:\/\/[^\s]+/g;
  let total = (text.match(URL)?.length ?? 0) * 23;
  const rest = text.replace(URL, "");
  const light = (cp: number) =>
    (cp >= 0 && cp <= 4351) || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247);
  let graphemes: string[];
  try {
    graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(rest)].map((g) => g.segment);
  } catch {
    graphemes = [...rest];
  }
  for (const g of graphemes) {
    if (/\p{Extended_Pictographic}/u.test(g)) total += 2;
    else for (const ch of g) total += light(ch.codePointAt(0)!) ? 1 : 2;
  }
  return total;
}

export function measure(rules: PlatformRules, text: string): number {
  if (rules.textCount === "x-weighted") return xWeightedLength(text);
  if (rules.textCount === "bytes") return new TextEncoder().encode(text).length;
  return charCount(text);
}

export function captionLength(rules: PlatformRules, input: CheckInput): number {
  let text = input.content;
  if (rules.countTitleInText && input.title.trim()) text = `${input.title}\n\n${text}`;
  if (rules.tagsInText && input.tags.length) text = `${text} ${input.tags.map((t) => `#${t}`).join(" ")}`;
  return measure(rules, text.trim());
}

export function checkPost(platform: string, input: CheckInput): Issue[] {
  const r = rulesFor(platform, input.type);
  const issues: Issue[] = [];
  const titleLen = charCount(input.title.trim());

  if (r.titleRequired && !titleLen) issues.push({ level: "error", code: "titleRequired" });
  const limitLevel = r.strict ? "error" : "warn";
  if (r.titleMax && titleLen > r.titleMax) {
    issues.push({ level: limitLevel, code: "titleTooLong", vars: { max: r.titleMax, n: titleLen } });
  }
  if (r.textMax) {
    const n = captionLength(r, input);
    if (n > r.textMax) issues.push({ level: limitLevel, code: "textTooLong", vars: { max: r.textMax, n } });
  }
  if (r.tagsMax && input.tags.length > r.tagsMax) {
    issues.push({ level: "warn", code: "tooManyTags", vars: { max: r.tagsMax, n: input.tags.length } });
  }
  if (r.tagMaxLength) {
    const long = input.tags.find((t) => charCount(t) > r.tagMaxLength!);
    if (long) issues.push({ level: "warn", code: "tagTooLong", vars: { max: r.tagMaxLength, tag: long } });
  }
  if (r.tagsTotalChars) {
    const n = input.tags.join(",").length;
    if (n > r.tagsTotalChars) issues.push({ level: "warn", code: "tagsTooLong", vars: { max: r.tagsTotalChars, n } });
  }
  if (r.imagesMax && input.images.length > r.imagesMax) {
    issues.push({ level: "error", code: "tooManyImages", vars: { max: r.imagesMax, n: input.images.length } });
  }
  if (r.mediaRequired && input.images.length === 0 && input.videos.length === 0) {
    issues.push({ level: "error", code: "needsMedia" });
  }
  if (r.imageRequired && input.images.length === 0) issues.push({ level: "error", code: "needsImage" });
  for (const v of input.videos) {
    if (r.videoMaxSec && v.durationSec && v.durationSec > r.videoMaxSec + 0.5) {
      issues.push({
        level: "warn",
        code: "videoTooLong",
        vars: { max: formatDuration(r.videoMaxSec), n: formatDuration(v.durationSec) },
      });
    }
    if (r.preferVertical && v.width && v.height && v.width > v.height) {
      issues.push({ level: "info", code: "preferVertical" });
    }
  }
  if (r.coverAspect && input.cover?.width && input.cover.height) {
    const ratio = input.cover.width / input.cover.height;
    if (Math.abs(ratio - r.coverAspect) / r.coverAspect > 0.06) {
      issues.push({ level: "warn", code: "coverAspect", vars: { ratio: aspectLabel(r.coverAspect) } });
    }
  }
  return issues;
}

function formatDuration(sec: number): string {
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  return m ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}

function aspectLabel(ratio: number): string {
  if (Math.abs(ratio - 16 / 9) < 0.01) return "16:9";
  if (Math.abs(ratio - 16 / 10) < 0.01) return "16:10";
  if (Math.abs(ratio - 9 / 16) < 0.01) return "9:16";
  return ratio.toFixed(2);
}

/** A compact description of a platform's limits, for the AI rewrite prompt. */
export function describeRules(platform: string, type: ContentType): string {
  const r = rulesFor(platform, type);
  const parts: string[] = [];
  if (r.titleMax) parts.push(`title at most ${r.titleMax} characters`);
  if (r.titleRequired) parts.push("title required");
  if (r.textMax) {
    parts.push(
      `${r.countTitleInText ? "title + text" : "text"}${r.tagsInText ? " + #hashtags" : ""} at most ${r.textMax} characters in total`,
    );
  }
  if (r.textCount === "x-weighted")
    parts.push("Chinese/Japanese/Korean characters and emoji count as 2, every link counts as 23");
  if (r.textCount === "bytes") parts.push("the text limit is in UTF-8 bytes (CJK characters use 3)");
  if (r.tagsMax) parts.push(`at most ${r.tagsMax} tags`);
  if (r.tagMaxLength) parts.push(`each tag at most ${r.tagMaxLength} characters`);
  if (r.tagsTotalChars) parts.push(`all tags together at most ${r.tagsTotalChars} characters`);
  return parts.join("; ") || "no special limits";
}
