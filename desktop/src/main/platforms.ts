// Platform registry, built from the extension's own InfoMaps so both products publish the same way.
import "./i18n-shim";
import { ArticleInfoMap } from "~sync/article";
import type { PlatformInfo } from "~sync/common";
import { DynamicInfoMap } from "~sync/dynamic";
import { PodcastInfoMap } from "~sync/podcast";
import { VideoInfoMap } from "~sync/video";
import type { ContentType, PlatformMeta, SiteMeta } from "../shared/types";
import { ACCOUNT_GETTER_KEYS, SITE_HOME_OVERRIDES } from "./account-getter-keys";
import { getMessage } from "./i18n-shim";

export const infoMap: Record<string, PlatformInfo> = {
  ...DynamicInfoMap,
  ...ArticleInfoMap,
  ...VideoInfoMap,
  ...PodcastInfoMap,
};

/**
 * Video through a post: Facebook, Instagram (Reels), X, LinkedIn, Threads… have no dedicated video page in
 * the extension, but their post scripts upload videos. Each such post platform also appears under VIDEO
 * (as VIDEO_<SITE>) and publishes the video through the post script. Sites with a real video script keep it.
 */
export const VIDEO_VIA_POST: Record<string, string> = {}; // VIDEO_<SITE> -> DYNAMIC_<SITE>
{
  const sitesWithVideo = new Set(Object.values(VideoInfoMap).map((p) => p.accountKey));
  for (const post of Object.values(DynamicInfoMap)) {
    if (sitesWithVideo.has(post.accountKey) || !/\bvideos\b/.test(post.injectFunction.toString())) continue;
    const name = post.name.replace(/^DYNAMIC_/, "VIDEO_");
    if (infoMap[name]) continue;
    infoMap[name] = { ...post, type: "VIDEO", name };
    VIDEO_VIA_POST[name] = post.name;
  }
}

export function getPlatformInfo(name: string): PlatformInfo | undefined {
  return infoMap[name];
}

export function listPlatforms(): PlatformMeta[] {
  return Object.values(infoMap).map((p) => ({
    name: p.name,
    type: p.type as ContentType,
    platformName: p.platformName,
    homeUrl: p.homeUrl,
    injectUrl: p.injectUrl,
    faviconUrl: p.faviconUrl,
    accountKey: p.accountKey,
    tags: p.tags ?? [],
  }));
}

// Display names of sites — prefer the dynamic/short form name, strip content-type suffixes.
function siteLabel(platforms: PlatformMeta[], accountKey: string): string {
  const i18nKey = `platform${accountKey.charAt(0).toUpperCase()}${accountKey.slice(1)}`;
  const fromI18n = getMessage(i18nKey);
  if (fromI18n && fromI18n !== i18nKey) return fromI18n;
  const preferred = platforms.find((p) => p.type === "DYNAMIC") ?? platforms[0];
  return preferred.platformName;
}

export function listSites(): SiteMeta[] {
  const byKey = new Map<string, PlatformMeta[]>();
  for (const p of listPlatforms()) {
    const list = byKey.get(p.accountKey) ?? [];
    list.push(p);
    byKey.set(p.accountKey, list);
  }
  const sites: SiteMeta[] = [];
  for (const [accountKey, platforms] of byKey) {
    const preferred = platforms.find((p) => p.type === "DYNAMIC") ?? platforms[0];
    sites.push({
      accountKey,
      label: siteLabel(platforms, accountKey),
      homeUrl: SITE_HOME_OVERRIDES[accountKey] ?? preferred.homeUrl,
      faviconUrl: platforms.find((p) => p.faviconUrl)?.faviconUrl,
      types: [...new Set(platforms.map((p) => p.type))],
      canDetect: ACCOUNT_GETTER_KEYS.includes(accountKey),
      region: platforms.some((p) => p.tags.includes("International")) ? "International" : "CN",
    });
  }
  return sites.sort((a, b) => a.label.localeCompare(b.label));
}
