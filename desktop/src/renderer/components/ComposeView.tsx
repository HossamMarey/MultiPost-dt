import {
  Check,
  FileAudio,
  FileText,
  Film,
  Image as ImageIcon,
  ImagePlus,
  Mic,
  PenLine,
  Send,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Account, ContentType, Draft, LocalFile, PlatformMeta } from "../../shared/types";
import { api, errorMessage, fileUrl, formatBytes } from "../api";
import { useApp } from "../context";
import { t } from "../i18n";
import { Button, Checkbox, Favicon, Toggle, cx, useFeedback } from "./ui";

const DRAFT_KEY = "multipost.draft.v1";
const TARGETS_KEY = "multipost.targets.v1";

const EMPTY_DRAFT: Draft = {
  contentType: "DYNAMIC",
  title: "",
  content: "",
  digest: "",
  htmlContent: "",
  markdownContent: "",
  tags: [],
  images: [],
  videos: [],
};

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable — draft just won't survive a restart
  }
}

const TYPES: { type: ContentType; icon: React.ReactNode }[] = [
  { type: "DYNAMIC", icon: <PenLine size={15} /> },
  { type: "ARTICLE", icon: <FileText size={15} /> },
  { type: "VIDEO", icon: <Video size={15} /> },
  { type: "PODCAST", icon: <Mic size={15} /> },
];

export function ComposeView() {
  const { state } = useApp();
  const [draft, setDraft] = useState<Draft>(() => loadJson(DRAFT_KEY, EMPTY_DRAFT));
  const [targetsByType, setTargetsByType] = useState<Record<string, string[]>>(() => loadJson(TARGETS_KEY, {}));
  const [autoPublish, setAutoPublish] = useState(state.settings.autoPublish);

  useEffect(() => saveJson(DRAFT_KEY, draft), [draft]);
  useEffect(() => saveJson(TARGETS_KEY, targetsByType), [targetsByType]);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const targets = targetsByType[draft.contentType] ?? [];
  const setTargets = (list: string[]) => setTargetsByType((m) => ({ ...m, [draft.contentType]: list }));

  return (
    <div className="flex h-full">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border bg-surface/60 px-6 py-3">
          <div className="flex rounded-xl bg-elevated p-1">
            {TYPES.map(({ type, icon }) => (
              <button
                key={type}
                type="button"
                onClick={() => patch({ contentType: type })}
                className={cx(
                  "flex h-8 items-center gap-1.5 rounded-lg px-3.5 font-medium transition",
                  draft.contentType === type
                    ? "bg-surface text-foreground shadow-card"
                    : "text-muted hover:text-foreground",
                )}>
                {icon}
                {t(`type${type}` as "typeDYNAMIC")}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 size={14} />}
            onClick={() => setDraft({ ...EMPTY_DRAFT, contentType: draft.contentType })}>
            {t("clearDraft")}
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-6">
            <Editor draft={draft} patch={patch} />
          </div>
        </div>
      </section>
      <TargetsPanel
        draft={draft}
        targets={targets}
        setTargets={setTargets}
        autoPublish={autoPublish}
        setAutoPublish={setAutoPublish}
      />
    </div>
  );
}

function Editor({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  const type = draft.contentType;
  return (
    <>
      <input
        className="w-full bg-transparent text-lg font-semibold outline-none placeholder:font-medium placeholder:text-muted/50"
        placeholder={type === "DYNAMIC" ? t("titleOptional") : t("title")}
        value={draft.title}
        onChange={(e) => patch({ title: e.target.value })}
      />
      {type === "ARTICLE" ? (
        <ArticleEditor draft={draft} patch={patch} />
      ) : (
        <AutoTextarea
          value={draft.content}
          onChange={(content) => patch({ content })}
          placeholder={
            type === "DYNAMIC"
              ? t("dynamicPlaceholder")
              : type === "VIDEO"
                ? t("videoDescPlaceholder")
                : t("podcastDescPlaceholder")
          }
          minRows={type === "DYNAMIC" ? 8 : 4}
        />
      )}
      {type === "DYNAMIC" && (
        <div className="grid grid-cols-2 gap-4">
          <MediaGrid
            label={t("images")}
            files={draft.images}
            kind="image"
            onChange={(images) => patch({ images })}
            addLabel={t("addImages")}
            icon={<ImagePlus size={18} />}
          />
          <MediaGrid
            label={t("videos")}
            files={draft.videos}
            kind="video"
            onChange={(videos) => patch({ videos })}
            addLabel={t("addVideo")}
            icon={<Film size={18} />}
          />
        </div>
      )}
      {type === "VIDEO" && (
        <div className="grid grid-cols-[1fr_220px] gap-4">
          <SingleFile
            label={t("videoFile")}
            kind="video"
            file={draft.video}
            onChange={(video) => patch({ video })}
            icon={<Film size={22} />}
            tall
          />
          <SingleFile
            label={t("cover")}
            kind="image"
            file={draft.cover}
            onChange={(cover) => patch({ cover })}
            icon={<ImageIcon size={22} />}
            tall
          />
        </div>
      )}
      {type === "PODCAST" && (
        <div className="grid grid-cols-[1fr_220px] gap-4">
          <SingleFile
            label={t("audioFile")}
            kind="audio"
            file={draft.audio}
            onChange={(audio) => patch({ audio })}
            icon={<FileAudio size={22} />}
            tall
          />
          <SingleFile
            label={t("cover")}
            kind="image"
            file={draft.cover}
            onChange={(cover) => patch({ cover })}
            icon={<ImageIcon size={22} />}
            tall
          />
        </div>
      )}
      <TagInput tags={draft.tags} onChange={(tags) => patch({ tags })} />
    </>
  );
}

function AutoTextarea({
  value,
  onChange,
  placeholder,
  minRows,
}: { value: string; onChange: (v: string) => void; placeholder: string; minRows: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <div className="flex flex-col gap-1">
      <textarea
        ref={ref}
        rows={minRows}
        className="field resize-none text-[15px] leading-relaxed"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="self-end text-[11px] tabular-nums text-muted">{[...value].length}</span>
    </div>
  );
}

function ArticleEditor({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  return (
    <>
      <input
        className="field"
        placeholder={t("digest")}
        value={draft.digest}
        maxLength={300}
        onChange={(e) => patch({ digest: e.target.value })}
      />
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex gap-1 border-b border-border bg-elevated/50 px-2 py-1.5">
          {(["write", "preview"] as const).map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => setTab(x)}
              className={cx(
                "h-7 rounded-md px-3 text-xs font-medium",
                tab === x ? "bg-surface shadow-card" : "text-muted hover:text-foreground",
              )}>
              {x === "write" ? t("markdown") : t("preview")}
            </button>
          ))}
        </div>
        {tab === "write" ? (
          <textarea
            className="block min-h-[360px] w-full resize-y bg-transparent p-4 font-mono text-[13px] leading-relaxed outline-none"
            spellCheck={false}
            placeholder="# Heading&#10;&#10;Write your article in Markdown…"
            value={draft.markdownContent}
            onChange={(e) => patch({ markdownContent: e.target.value, htmlContent: "" })}
          />
        ) : (
          <MarkdownPreview markdown={draft.markdownContent} />
        )}
      </div>
      <SingleFile
        label={t("cover")}
        kind="image"
        file={draft.cover}
        onChange={(cover) => patch({ cover })}
        icon={<ImageIcon size={22} />}
      />
    </>
  );
}

// Minimal, safe preview (text only, no HTML passthrough). The real conversion happens in the main process.
function MarkdownPreview({ markdown }: { markdown: string }) {
  const blocks = markdown.split(/\n{2,}/).filter((b) => b.trim());
  return (
    <div className="flex min-h-[360px] flex-col gap-3 p-5 text-[15px] leading-relaxed">
      {blocks.map((b, i) => {
        const heading = /^(#{1,6})\s+(.*)$/.exec(b.trim());
        if (heading) {
          const size = ["text-2xl", "text-xl", "text-lg", "text-base", "text-base", "text-base"][heading[1].length - 1];
          return (
            <div key={i} className={cx("font-semibold", size)}>
              {heading[2]}
            </div>
          );
        }
        if (/^\s*[-*]\s/.test(b)) {
          return (
            <ul key={i} className="list-disc pl-6">
              {b.split("\n").map((line, j) => (
                <li key={j}>{line.replace(/^\s*[-*]\s/, "")}</li>
              ))}
            </ul>
          );
        }
        if (b.startsWith("```")) {
          return (
            <pre key={i} className="overflow-x-auto rounded-lg bg-elevated p-3 font-mono text-xs">
              {b.replace(/^```\w*\n?|```$/g, "")}
            </pre>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {b}
          </p>
        );
      })}
    </div>
  );
}

function useFileDrop(onFiles: (files: LocalFile[]) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: async (e: React.DragEvent) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(await api.filesFromDrop(files));
      },
    },
  };
}

const KIND_PREFIX: Record<string, string> = { image: "image/", video: "video/", audio: "audio/" };

function MediaGrid({
  label,
  files,
  kind,
  onChange,
  addLabel,
  icon,
}: {
  label: string;
  files: LocalFile[];
  kind: "image" | "video";
  onChange: (f: LocalFile[]) => void;
  addLabel: string;
  icon: React.ReactNode;
}) {
  const add = (more: LocalFile[]) => {
    const fitting = more.filter((f) => f.type.startsWith(KIND_PREFIX[kind]) && !files.some((x) => x.path === f.path));
    if (fitting.length) onChange([...files, ...fitting]);
  };
  const drop = useFileDrop(add);
  const pick = async () => add(await api.pickFiles(kind, true));

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted">
        {label} {files.length > 0 && <span className="tabular-nums">· {files.length}</span>}
      </span>
      <div
        {...drop.props}
        className={cx(
          "grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2 rounded-xl transition",
          drop.over && "ring-2 ring-primary-500",
        )}>
        {files.map((f, i) => (
          <div
            key={f.path}
            className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-elevated">
            {kind === "image" ? (
              <img src={fileUrl(f.path)} alt={f.name} className="h-full w-full object-cover" draggable={false} />
            ) : (
              <video src={fileUrl(f.path)} className="h-full w-full object-cover" muted preload="metadata" />
            )}
            <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-4 text-[10px] text-white">
              {f.name}
            </div>
            <button
              type="button"
              aria-label={t("remove")}
              onClick={() => onChange(files.filter((_, j) => j !== i))}
              className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white group-hover:flex">
              <X size={13} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={pick}
          className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-muted transition hover:border-primary-500 hover:text-primary-600">
          {icon}
          <span className="text-xs">{addLabel}</span>
        </button>
      </div>
    </div>
  );
}

function SingleFile({
  label,
  kind,
  file,
  onChange,
  icon,
  tall,
}: {
  label: string;
  kind: "image" | "video" | "audio";
  file?: LocalFile;
  onChange: (f: LocalFile | undefined) => void;
  icon: React.ReactNode;
  tall?: boolean;
}) {
  const accept = (list: LocalFile[]) => {
    const f = list.find((x) => x.type.startsWith(KIND_PREFIX[kind]));
    if (f) onChange(f);
  };
  const drop = useFileDrop(accept);
  const pick = async () => accept(await api.pickFiles(kind, false));

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted">{label}</span>
      {file ? (
        <div
          {...drop.props}
          className={cx(
            "relative flex flex-col overflow-hidden rounded-xl border border-border bg-surface",
            tall && "h-[200px]",
            drop.over && "ring-2 ring-primary-500",
          )}>
          <div className="flex min-h-0 flex-1 items-center justify-center bg-elevated">
            {kind === "image" && (
              <img src={fileUrl(file.path)} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
            )}
            {kind === "video" && (
              <video src={fileUrl(file.path)} className="max-h-full max-w-full" controls preload="metadata" />
            )}
            {kind === "audio" && (
              <div className="flex w-full flex-col items-center gap-3 p-4">
                <FileAudio size={30} className="text-primary-600" />
                <audio src={fileUrl(file.path)} controls className="w-full" preload="metadata" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 border-t border-border px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-xs">{file.name}</span>
            <span className="text-[11px] tabular-nums text-muted">{formatBytes(file.size)}</span>
            <Button size="sm" variant="ghost" onClick={pick}>
              {t("replace")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>
              {t("remove")}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          {...drop.props}
          onClick={pick}
          className={cx(
            "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-6 text-muted transition hover:border-primary-500 hover:text-primary-600",
            tall ? "h-[200px]" : "h-[120px]",
            drop.over && "border-primary-500 bg-primary-50/50 text-primary-600",
          )}>
          {icon}
          <span className="text-xs">{t("dropHere")}</span>
        </button>
      )}
    </div>
  );
}

function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [value, setValue] = useState("");
  const commit = () => {
    const parts = value
      .split(/[,，#\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (parts.length) onChange([...new Set([...tags, ...parts])]);
    setValue("");
  };
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted">{t("tags")}</span>
      <div className="field flex flex-wrap items-center gap-1.5 py-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-md bg-primary-50 px-2 py-0.5 text-xs text-primary-700 dark:text-primary-500">
            #{tag}
            <button type="button" aria-label={t("remove")} onClick={() => onChange(tags.filter((x) => x !== tag))}>
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          className="min-w-[160px] flex-1 bg-transparent py-0.5 outline-none placeholder:text-muted/70"
          placeholder={tags.length ? "" : t("tagsPlaceholder")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && !value && tags.length) {
              onChange(tags.slice(0, -1));
            }
          }}
        />
      </div>
    </div>
  );
}

// ---- Targets -----------------------------------------------------------------------------------

interface TargetRow {
  account: Account;
  platforms: PlatformMeta[];
}

function TargetsPanel({
  draft,
  targets,
  setTargets,
  autoPublish,
  setAutoPublish,
}: {
  draft: Draft;
  targets: string[];
  setTargets: (t: string[]) => void;
  autoPublish: boolean;
  setAutoPublish: (v: boolean) => void;
}) {
  const { state, sitesByKey, platformsFor, setView } = useApp();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);

  const rows: TargetRow[] = useMemo(
    () =>
      state.accounts
        .map((account) => ({ account, platforms: platformsFor(account.accountKey, draft.contentType) }))
        .filter((r) => r.platforms.length > 0)
        .sort(
          (a, b) =>
            (sitesByKey.get(a.account.accountKey)?.label ?? "").localeCompare(
              sitesByKey.get(b.account.accountKey)?.label ?? "",
            ) || a.account.label.localeCompare(b.account.label),
        ),
    [state.accounts, draft.contentType, platformsFor, sitesByKey],
  );

  const allKeys = useMemo(() => rows.flatMap((r) => r.platforms.map((p) => `${r.account.id}:${p.name}`)), [rows]);
  const valid = new Set(allKeys);
  const selected = targets.filter((k) => valid.has(k));
  const selectedSet = new Set(selected);

  const keysForAccounts = (ids: string[]) =>
    rows.filter((r) => ids.includes(r.account.id)).flatMap((r) => r.platforms.map((p) => `${r.account.id}:${p.name}`));

  const toggleKeys = (keys: string[], on: boolean) => {
    const next = new Set(selected);
    for (const k of keys) on ? next.add(k) : next.delete(k);
    setTargets([...next]);
  };

  const notSignedIn = new Set(
    selected
      .map((k) => k.split(":")[0])
      .filter((id) => state.accounts.find((a) => a.id === id)?.status === "logged-out"),
  ).size;

  const publish = async () => {
    if (!selected.length) {
      toast(t("selectTargets"), "error");
      return;
    }
    setBusy(true);
    try {
      await api.publish({
        draft,
        autoPublish,
        targets: selected.map((k) => {
          const i = k.indexOf(":");
          return { accountId: k.slice(0, i), platform: k.slice(i + 1) };
        }),
      });
      toast(t("publishStarted", { n: selected.length }), "success");
      setView({ name: "activity" });
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h2 className="font-semibold">{t("publishTo")}</h2>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setTargets([...new Set([...targets, ...allKeys])])}
            disabled={!allKeys.length}>
            {t("selectAll")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setTargets(targets.filter((k) => !valid.has(k)))}
            disabled={!selected.length}>
            {t("none")}
          </Button>
        </div>
      </div>

      {state.groups.length > 0 && rows.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {state.groups.map((g) => {
            const keys = keysForAccounts(g.accountIds);
            if (!keys.length) return null;
            const picked = keys.filter((k) => selectedSet.has(k)).length;
            const on = picked === keys.length;
            const some = !on && picked > 0;
            return (
              <button
                key={g.id}
                type="button"
                aria-pressed={on ? "true" : some ? "mixed" : "false"}
                title={some ? t("partialGroup", { n: picked, total: keys.length }) : undefined}
                onClick={() => toggleKeys(keys, !on)}
                className={cx(
                  "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition",
                  on
                    ? "border-primary-600 bg-primary-600 text-white"
                    : some
                      ? "border-primary-500 bg-primary-50 text-primary-700 dark:text-primary-500"
                      : "border-border hover:bg-elevated",
                )}>
                {on ? <Check size={12} /> : <span className="h-2 w-2 rounded-full" style={{ background: g.color }} />}
                {g.name}
                <span className={cx("tabular-nums", on ? "text-white/80" : "text-muted")}>
                  {some ? `${picked}/${keys.length}` : keys.length}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center text-muted">
            <Upload size={22} />
            <p>{t("noTargetsForType")}</p>
            <Button size="sm" onClick={() => setView({ name: "accounts" })}>
              {t("addAccounts")}
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col py-1">
            {rows.map(({ account, platforms }) => {
              const site = sitesByKey.get(account.accountKey);
              const keys = platforms.map((p) => `${account.id}:${p.name}`);
              const on = keys.every((k) => selectedSet.has(k));
              const some = !on && keys.some((k) => selectedSet.has(k));
              return (
                <li key={account.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-elevated/60">
                    <Checkbox checked={on} indeterminate={some} onChange={(v) => toggleKeys(keys, v)} />
                    <Favicon src={site?.faviconUrl} siteKey={site?.accountKey} label={site?.label ?? ""} size={22} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{account.label}</span>
                      <span className="truncate text-[11px] text-muted">
                        {platforms.length === 1 ? platforms[0].platformName : site?.label}
                        {account.profile?.username && ` · @${account.profile.username.replace(/^@/, "")}`}
                      </span>
                    </div>
                    {account.status === "logged-out" && (
                      <span
                        className="shrink-0 rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning"
                        title={t("notSignedInDot")}>
                        {t("statusLoggedOut")}
                      </span>
                    )}
                  </label>
                  {platforms.length > 1 && (
                    <div className="flex flex-col pb-1 pl-[52px]">
                      {platforms.map((p) => {
                        const k = `${account.id}:${p.name}`;
                        return (
                          <label
                            key={p.name}
                            className="flex cursor-pointer items-center gap-2 py-1 pr-4 text-xs hover:text-foreground">
                            <Checkbox checked={selectedSet.has(k)} onChange={(v) => toggleKeys([k], v)} />
                            {p.platformName}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-border p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <Toggle checked={autoPublish} onChange={setAutoPublish} label={t("autoPublish")} />
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{t("autoPublish")}</span>
            <span className="text-xs leading-snug text-muted">{t("autoPublishHint")}</span>
          </div>
        </label>
        {notSignedIn > 0 && (
          <div className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
            {t("notSignedInWarn", { n: notSignedIn })}
          </div>
        )}
        <Button
          variant="primary"
          size="lg"
          onClick={publish}
          disabled={busy || !selected.length}
          icon={<Send size={16} />}>
          {busy ? t("publishing") : selected.length ? t("publishCount", { n: selected.length }) : t("publish")}
        </Button>
      </div>
    </aside>
  );
}
