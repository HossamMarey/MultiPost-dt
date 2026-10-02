import { useMemo } from "react";
import { type ResolvedContent, resolveContent } from "../shared/compose";
import { type Issue, checkPost } from "../shared/platform-rules";
import type { Account, Draft, LocalFile, PlatformMeta } from "../shared/types";
import { fileUrl } from "./api";
import { useApp } from "./context";
import { type MessageKey, t } from "./i18n";

export interface ResolvedTarget {
  key: string; // `${accountId}:${platform}`
  account: Account;
  platform: PlatformMeta;
  resolved: ResolvedContent;
  issues: Issue[];
}

export function splitKey(key: string): { accountId: string; platform: string } {
  const i = key.indexOf(":");
  return { accountId: key.slice(0, i), platform: key.slice(i + 1) };
}

/** Resolves and checks every selected target, exactly as the publisher will build it. */
export function useResolvedTargets(draft: Draft, selectedKeys: string[]): ResolvedTarget[] {
  const { state, init, sitesByKey } = useApp();
  return useMemo(() => {
    const accounts = new Map(state.accounts.map((a) => [a.id, a]));
    const platforms = new Map(init.platforms.map((p) => [p.name, p]));
    const out: ResolvedTarget[] = [];
    for (const key of selectedKeys) {
      const { accountId, platform } = splitKey(key);
      const account = accounts.get(accountId);
      const meta = platforms.get(platform);
      if (!account || !meta || meta.type !== draft.contentType) continue;
      const resolved = resolveContent(draft, {
        platform,
        account,
        siteLabel: sitesByKey.get(account.accountKey)?.label ?? account.accountKey,
        groups: state.groups.filter((g) => g.accountIds.includes(account.id)),
      });
      const issues = checkPost(platform, {
        type: draft.contentType,
        title: resolved.title,
        content: resolved.content,
        tags: resolved.tags,
        images: draft.contentType === "DYNAMIC" ? draft.images : [],
        videos: draft.contentType === "DYNAMIC" ? draft.videos : draft.video ? [draft.video] : [],
        cover: resolved.cover,
      });
      out.push({ key, account, platform: meta, resolved, issues });
    }
    return out;
  }, [draft, selectedKeys, state.accounts, state.groups, init.platforms, sitesByKey]);
}

export function issueText(issue: Issue): string {
  return t(`issue_${issue.code}` as MessageKey, issue.vars);
}

/** Reads dimensions/duration of attached media so platform limits can be checked. */
export async function withMediaMeta(file: LocalFile): Promise<LocalFile> {
  const src = fileUrl(file.path);
  try {
    if (file.type.startsWith("image/")) {
      const img = new Image();
      img.src = src;
      await img.decode();
      return { ...file, width: img.naturalWidth, height: img.naturalHeight };
    }
    if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
      const el = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
      el.preload = "metadata";
      el.src = src;
      await new Promise<void>((resolve, reject) => {
        el.onloadedmetadata = () => resolve();
        el.onerror = () => reject(new Error("metadata"));
        setTimeout(() => reject(new Error("timeout")), 8000);
      });
      const v = el as HTMLVideoElement;
      return {
        ...file,
        durationSec: Number.isFinite(el.duration) ? el.duration : undefined,
        width: v.videoWidth || undefined,
        height: v.videoHeight || undefined,
      };
    }
  } catch {
    // Unsupported codec etc.: checks that need metadata are simply skipped.
  }
  return file;
}
