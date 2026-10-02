import { AlertTriangle, Info, RotateCcw, Sparkles, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { accountKey, platformKey } from "../../shared/compose";
import { captionLength, rulesFor } from "../../shared/platform-rules";
import type { ContentOverride, Draft } from "../../shared/types";
import { api, errorMessage } from "../api";
import { type ResolvedTarget, issueText } from "../compose-logic";
import { useApp } from "../context";
import { t } from "../i18n";
import { TagInput } from "./ComposeView";
import { Button, Favicon, Toggle, cx, useFeedback } from "./ui";

function IssueIcon({ level }: { level: "error" | "warn" | "info" }) {
  if (level === "error") return <XCircle size={13} className="shrink-0 text-danger" />;
  if (level === "warn") return <AlertTriangle size={13} className="shrink-0 text-warning" />;
  return <Info size={13} className="shrink-0 text-muted" />;
}

export function worstLevel(issues: { level: string }[]): "error" | "warn" | "info" | null {
  if (issues.some((i) => i.level === "error")) return "error";
  if (issues.some((i) => i.level === "warn")) return "warn";
  if (issues.some((i) => i.level === "info")) return "info";
  return null;
}

function dedupeIssues(targets: ResolvedTarget[]) {
  const byText = new Map<string, { issue: ResolvedTarget["issues"][number]; accounts: string[] }>();
  for (const x of targets) {
    for (const issue of x.issues) {
      const key = issueText(issue);
      const entry = byText.get(key) ?? { issue, accounts: [] };
      entry.accounts.push(x.account.label);
      byText.set(key, entry);
    }
  }
  return [...byText.values()];
}

/** Per-platform / per-account text, live limit checks, final preview and optional AI rewrite. */
export function CustomizePanel({
  draft,
  patch,
  targets,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  targets: ResolvedTarget[];
}) {
  const { state, setView, sitesByKey } = useApp();
  const { toast } = useFeedback();
  const platforms = useMemo(() => {
    const seen = new Map<string, ResolvedTarget[]>();
    for (const tg of targets) {
      const list = seen.get(tg.platform.name) ?? [];
      list.push(tg);
      seen.set(tg.platform.name, list);
    }
    return [...seen.entries()];
  }, [targets]);

  const [active, setActive] = useState<string | null>(null);
  const [scope, setScope] = useState<string>("all"); // "all" or an accountId
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const activePlatform = platforms.find(([name]) => name === active) ? active : (platforms[0]?.[0] ?? null);
  useEffect(() => setScope("all"), [activePlatform]);

  if (platforms.length === 0) {
    return (
      <section className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-4 text-muted">
        <span className="font-medium text-foreground">{t("customizeTitle")}</span>
        <span className="text-xs">{t("customizeEmpty")}</span>
      </section>
    );
  }

  const group = platforms.find(([name]) => name === activePlatform)!;
  const [platformName, platformTargets] = group;
  const meta = platformTargets[0].platform;
  const overrideKey = scope === "all" ? platformKey(platformName) : accountKey(scope);
  const override: ContentOverride = draft.overrides?.[overrideKey] ?? {};
  const shown =
    scope === "all" ? platformTargets[0] : (platformTargets.find((x) => x.account.id === scope) ?? platformTargets[0]);
  const rules = rulesFor(platformName, draft.contentType);
  const baseText = draft.contentType === "ARTICLE" ? draft.markdownContent : draft.content;

  const setOverride = (next: ContentOverride | undefined) => {
    const all = { ...(draft.overrides ?? {}) };
    if (!next || (!next.title && !next.content && !next.tags?.length && !next.cover)) delete all[overrideKey];
    else all[overrideKey] = next;
    patch({ overrides: all });
  };

  const rewrite = async () => {
    setBusy(true);
    try {
      const result = await api.aiRewrite({
        platform: platformName,
        type: draft.contentType,
        title: override.title || draft.title,
        content: override.content || baseText,
        tags: override.tags?.length ? override.tags : draft.tags,
        instructions,
      });
      setOverride({ ...override, title: result.title, content: result.content, tags: result.tags });
      toast(t("aiDone", { platform: meta.platformName }), "success");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const aiReady = !!state.settings.aiApiKey;
  const counted = captionLength(rules, {
    type: draft.contentType,
    title: shown.resolved.title,
    content: shown.resolved.content,
    tags: shown.resolved.tags,
    images: [],
    videos: [],
  });

  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <span className="font-semibold">{t("customizeTitle")}</span>
        <div className="flex-1" />
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted" title={t("varyTagsHint")}>
          <Toggle checked={!!draft.varyTags} onChange={(v) => patch({ varyTags: v })} label={t("varyTags")} />
          {t("varyTags")}
        </label>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border bg-elevated/40 px-2 py-1.5">
        {platforms.map(([name, list]) => {
          const level = worstLevel(list.flatMap((x) => x.issues));
          const customized =
            !!draft.overrides?.[platformKey(name)] || list.some((x) => draft.overrides?.[accountKey(x.account.id)]);
          return (
            <button
              key={name}
              type="button"
              onClick={() => setActive(name)}
              className={cx(
                "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium",
                name === activePlatform ? "bg-surface shadow-card" : "text-muted hover:text-foreground",
              )}>
              <Favicon
                siteKey={list[0].account.accountKey}
                src={sitesByKey.get(list[0].account.accountKey)?.faviconUrl}
                label={list[0].platform.platformName}
                size={16}
              />
              {list[0].platform.platformName}
              {customized && <span className="h-1.5 w-1.5 rounded-full bg-primary-500" title={t("customized")} />}
              {level && <IssueIcon level={level} />}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">{t("appliesTo")}</span>
          <select className="field h-8 w-auto py-0 text-xs" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">
              {t("allAccountsOn", { platform: meta.platformName, n: platformTargets.length })}
            </option>
            {platformTargets.map((x) => (
              <option key={x.account.id} value={x.account.id}>
                {t("onlyAccount", { account: x.account.label })}
              </option>
            ))}
          </select>
          <div className="flex-1" />
          {(override.title || override.content || override.tags?.length) && (
            <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => setOverride(undefined)}>
              {t("useMainText")}
            </Button>
          )}
        </div>

        {(draft.contentType !== "DYNAMIC" || rules.titleMax || rules.titleRequired) && (
          <input
            className="field"
            placeholder={draft.title || t("title")}
            value={override.title ?? ""}
            onChange={(e) => setOverride({ ...override, title: e.target.value })}
          />
        )}
        <textarea
          className="field min-h-[110px] resize-y text-[14px] leading-relaxed"
          placeholder={baseText || t("content")}
          value={override.content ?? ""}
          onChange={(e) => setOverride({ ...override, content: e.target.value })}
        />
        <TagInput
          tags={override.tags ?? []}
          onChange={(tags) => setOverride({ ...override, tags })}
          placeholder={draft.tags.length ? draft.tags.map((x) => `#${x}`).join(" ") : undefined}
        />
        <p className="text-[11px] text-muted">{t("overrideHint")}</p>

        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-elevated/60 p-2">
          <Sparkles size={15} className="text-primary-600" />
          <input
            className="min-w-[180px] flex-1 bg-transparent text-xs outline-none placeholder:text-muted/70"
            placeholder={t("aiInstructionsPlaceholder")}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            disabled={!aiReady}
          />
          {aiReady ? (
            <Button size="sm" variant="primary" disabled={busy} onClick={rewrite}>
              {busy ? t("aiWorking") : t("aiRewrite", { platform: meta.platformName })}
            </Button>
          ) : (
            <Button size="sm" onClick={() => setView({ name: "settings" })}>
              {t("aiSetup")}
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-xs font-medium text-muted">
            <span>{t("finalPreview", { account: shown.account.label })}</span>
            {rules.textMax ? (
              <span className={cx("ml-auto tabular-nums", counted > rules.textMax ? "text-danger" : "text-muted")}>
                {counted}/{rules.textMax}
              </span>
            ) : null}
          </div>
          <div className="whitespace-pre-wrap rounded-lg border border-border bg-background/60 p-3 text-[13px] leading-relaxed">
            {shown.resolved.title && <div className="mb-1 font-semibold">{shown.resolved.title}</div>}
            {shown.resolved.content || <span className="text-muted">—</span>}
            {shown.resolved.tags.length > 0 && (
              <div className="mt-1.5 text-primary-600">{shown.resolved.tags.map((x) => `#${x}`).join(" ")}</div>
            )}
          </div>
          {dedupeIssues(scope === "all" ? platformTargets : [shown]).map(({ issue, accounts }) => (
            <div key={`${issue.code}-${accounts.join(",")}`} className="flex items-start gap-1.5 text-xs">
              <IssueIcon level={issue.level} />
              <span>
                {scope === "all" && platformTargets.length > 1 && accounts.length < platformTargets.length && (
                  <span className="text-muted">{accounts.join(", ")}: </span>
                )}
                {issueText(issue)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
