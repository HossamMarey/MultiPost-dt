// Resolves what one target (account × platform) actually publishes: the draft, then the platform override,
// then the account override, then group footers/hashtags, template variables and optional tag variation.
// Shared by the composer (preview + checks) and the publisher, so what you check is what gets posted.

import type { Account, ContentOverride, Draft, Group, LocalFile } from "./types";

export interface ResolvedContent {
  title: string;
  content: string;
  tags: string[];
  cover?: LocalFile;
}

export interface TargetContext {
  platform: string;
  account: Pick<Account, "id" | "label">;
  siteLabel: string;
  groups: Group[]; // groups the account belongs to
  now?: Date;
}

export const platformKey = (platform: string) => `platform:${platform}`;
export const accountKey = (accountId: string) => `account:${accountId}`;

function nonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function applyOverride(base: ResolvedContent, o: ContentOverride | undefined): ResolvedContent {
  if (!o) return base;
  return {
    title: nonEmpty(o.title) ? o.title : base.title,
    content: nonEmpty(o.content) ? o.content : base.content,
    tags: o.tags && o.tags.length > 0 ? o.tags : base.tags,
    cover: o.cover ?? base.cover,
  };
}

/** {account}, {site}, {date}, {time} in titles, text and footers. Unknown braces are left alone. */
export function fillTemplate(text: string, ctx: TargetContext): string {
  const now = ctx.now ?? new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const vars: Record<string, string> = {
    account: ctx.account.label,
    site: ctx.siteLabel,
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
  return text.replace(/\{(account|site|date|time)\}/g, (_, k: string) => vars[k]);
}

/** Deterministic shuffle so the same account always gets the same order (stable previews). */
function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const normalizeTag = (t: string) => t.trim().replace(/^#+/, "");

export function resolveContent(draft: Draft, ctx: TargetContext): ResolvedContent {
  const base: ResolvedContent = {
    title: draft.title,
    content: draft.contentType === "ARTICLE" ? draft.markdownContent : draft.content,
    tags: draft.tags,
    cover: draft.cover,
  };
  let r = applyOverride(base, draft.overrides?.[platformKey(ctx.platform)]);
  r = applyOverride(r, draft.overrides?.[accountKey(ctx.account.id)]);

  const footers = ctx.groups.map((g) => g.footer?.trim()).filter(nonEmpty);
  let content = r.content;
  for (const f of [...new Set(footers)]) {
    if (!content.includes(f)) content = content.trim() ? `${content.trimEnd()}\n\n${f}` : f;
  }

  const groupTags = ctx.groups.flatMap((g) => g.hashtags ?? []);
  let tags = [...new Set([...r.tags, ...groupTags].map(normalizeTag).filter(Boolean))];
  if (draft.varyTags) tags = seededShuffle(tags, ctx.account.id);

  return {
    title: fillTemplate(r.title, ctx),
    content: fillTemplate(content, ctx),
    tags,
    cover: r.cover,
  };
}

/** True when the target has its own text (an override exists for its platform or account). */
export function hasOverride(draft: Draft, platform: string, accountId: string): boolean {
  const o1 = draft.overrides?.[platformKey(platform)];
  const o2 = draft.overrides?.[accountKey(accountId)];
  const filled = (o?: ContentOverride) =>
    !!o && (nonEmpty(o.title) || nonEmpty(o.content) || (o.tags?.length ?? 0) > 0 || !!o.cover);
  return filled(o1) || filled(o2);
}
