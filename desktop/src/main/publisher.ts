// Publishing queue: one Chromium window per (account, platform) job, run with bounded concurrency.
// Each job opens the platform's publish page in the account's session and runs the extension's
// injectFunction there, exactly like chrome.scripting.executeScript does in the extension.
import crypto from "node:crypto";
import type { BrowserWindow } from "electron";
import type { ArticleData, DynamicData, FileData, PodcastData, SyncData, VideoData } from "~sync/common";
import type { Account, Draft, LocalFile, PublishJob, PublishRequest } from "../shared/types";
import { createAccountWindow } from "./browser-windows";
import { markdownToHtml } from "./markdown";
import { getPlatformInfo } from "./platforms";
import { serveFile } from "./sessions";
import { getState, update } from "./store";

// Same isolation the extension gets from chrome.scripting (ISOLATED world): page scripts cannot
// tamper with the inject function, while the DOM is shared.
const ISOLATED_WORLD_ID = 1001;
// The inject functions resolve when they finish filling the form (or after publishing). Some keep
// polling forever; after this long we stop waiting and consider the page handed over to the user.
const INJECT_SETTLE_MS = 10 * 60_000;
const LOGIN_URL_HINT = /(login|signin|sign-in|passport|account\/begin|oauth|sso)/i;

interface RunContext {
  syncDataByJob: Map<string, SyncData>;
}

const runs = new Map<string, RunContext>();
const windows = new Map<string, BrowserWindow>();
const queue: string[] = [];
let active = 0;

function toFileData(file: LocalFile | undefined): FileData | undefined {
  return file ? serveFile(file) : undefined;
}

function buildData(draft: Draft): DynamicData | ArticleData | VideoData | PodcastData {
  switch (draft.contentType) {
    case "DYNAMIC":
      return {
        title: draft.title,
        content: draft.content,
        images: draft.images.map((f) => serveFile(f)),
        videos: draft.videos.map((f) => serveFile(f)),
        tags: draft.tags,
        scheduledPublishTime: draft.scheduledPublishTime,
      } satisfies DynamicData;
    case "ARTICLE": {
      const html = draft.htmlContent || markdownToHtml(draft.markdownContent);
      return {
        title: draft.title,
        digest: draft.digest,
        cover: toFileData(draft.cover) ?? { name: "", url: "" },
        htmlContent: html,
        markdownContent: draft.markdownContent,
        images: [],
        tags: draft.tags,
        scheduledPublishTime: draft.scheduledPublishTime,
      } satisfies ArticleData;
    }
    case "VIDEO":
      return {
        title: draft.title,
        content: draft.content,
        description: draft.content,
        video: toFileData(draft.video) ?? { name: "", url: "" },
        cover: toFileData(draft.cover),
        tags: draft.tags,
        scheduledPublishTime: draft.scheduledPublishTime,
      } satisfies VideoData;
    case "PODCAST":
      return {
        title: draft.title,
        description: draft.content,
        audio: toFileData(draft.audio) ?? { name: "", url: "" },
        cover: toFileData(draft.cover),
        tags: draft.tags,
      } satisfies PodcastData;
  }
}

export function validateDraft(draft: Draft): string | null {
  if (draft.contentType === "VIDEO" && !draft.video) return "A video file is required";
  if (draft.contentType === "PODCAST" && !draft.audio) return "An audio file is required";
  if (draft.contentType === "ARTICLE" && !draft.title.trim()) return "A title is required";
  if (
    draft.contentType === "DYNAMIC" &&
    !draft.content.trim() &&
    !draft.title.trim() &&
    draft.images.length === 0 &&
    draft.videos.length === 0
  ) {
    return "Write something or attach media";
  }
  return null;
}

export function startPublish(request: PublishRequest): string {
  const error = validateDraft(request.draft);
  if (error) throw new Error(error);
  const state = getState();
  const runId = crypto.randomUUID();
  const ctx: RunContext = { syncDataByJob: new Map() };
  const jobs: PublishJob[] = [];
  const seen = new Set<string>();

  for (const target of request.targets) {
    const key = `${target.accountId}:${target.platform}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const account = state.accounts.find((a) => a.id === target.accountId);
    const info = getPlatformInfo(target.platform);
    if (!account || !info || info.type !== request.draft.contentType || info.accountKey !== account.accountKey)
      continue;
    const job: PublishJob = {
      id: crypto.randomUUID(),
      runId,
      accountId: account.id,
      accountLabel: account.label,
      platform: info.name,
      platformName: info.platformName,
      status: "queued",
      attempts: 0,
    };
    // Every job gets its own copy (and its own file tokens) of the payload.
    ctx.syncDataByJob.set(job.id, {
      platforms: [{ name: info.name, injectUrl: info.injectUrl, extraConfig: account.extraConfig }],
      isAutoPublish: request.autoPublish,
      data: buildData(request.draft),
    });
    jobs.push(job);
  }
  if (jobs.length === 0) throw new Error("No valid targets selected");

  runs.set(runId, ctx);
  update((s) => {
    s.runs.push({
      id: runId,
      createdAt: Date.now(),
      title: request.draft.title || request.draft.content.slice(0, 60) || "(untitled)",
      contentType: request.draft.contentType,
      jobIds: jobs.map((j) => j.id),
    });
    s.jobs.push(...jobs);
  });
  queue.push(...jobs.map((j) => j.id));
  pump();
  return runId;
}

function setJob(jobId: string, patch: Partial<PublishJob>) {
  update((s) => {
    const job = s.jobs.find((j) => j.id === jobId);
    if (job) Object.assign(job, patch);
  });
}

function pump() {
  const { concurrency } = getState().settings;
  while (active < Math.max(1, concurrency) && queue.length > 0) {
    const jobId = queue.shift()!;
    active++;
    runJob(jobId)
      .catch((error) => setJob(jobId, { status: "failed", error: (error as Error).message, finishedAt: Date.now() }))
      .finally(() => {
        active--;
        pump();
      });
  }
}

function waitForLoad(win: BrowserWindow, url: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const wc = win.webContents;
    const timer = setTimeout(() => {
      // Heavy SPAs often never reach "load"; the DOM is usually usable by now, so carry on.
      cleanup();
      resolve();
    }, timeoutMs);
    const onFinish = () => {
      cleanup();
      resolve();
    };
    const onFail = (_e: unknown, code: number, desc: string, _url: string, isMainFrame: boolean) => {
      if (!isMainFrame || code === -3 /* ABORTED: superseded by a redirect */) return;
      cleanup();
      reject(new Error(`Page failed to load: ${desc} (${code})`));
    };
    const onClosed = () => {
      cleanup();
      reject(new Error("Window closed"));
    };
    function cleanup() {
      clearTimeout(timer);
      wc.removeListener("did-finish-load", onFinish);
      wc.removeListener("did-fail-load", onFail);
      win.removeListener("closed", onClosed);
    }
    wc.on("did-finish-load", onFinish);
    wc.on("did-fail-load", onFail);
    win.on("closed", onClosed);
    wc.loadURL(url).catch(() => {
      // Errors are reported through did-fail-load.
    });
  });
}

async function runJob(jobId: string) {
  const state = getState();
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job || job.status === "cancelled") return;
  const ctx = runs.get(job.runId);
  const syncData = ctx?.syncDataByJob.get(jobId);
  const account = state.accounts.find((a) => a.id === job.accountId);
  const info = getPlatformInfo(job.platform);
  if (!syncData || !account || !info) throw new Error("This job can no longer run (account or platform removed)");

  const { settings } = state;
  const injectUrl = customInjectUrl(account) ?? info.injectUrl;
  setJob(jobId, {
    status: "loading",
    startedAt: Date.now(),
    error: undefined,
    attempts: job.attempts + 1,
    url: injectUrl,
  });

  const win = await createAccountWindow(account as Account, {
    title: `${info.platformName} · ${account.label}`,
    show: settings.showPublishWindows,
  });
  windows.set(jobId, win);
  let cancelled = false;
  win.on("closed", () => {
    windows.delete(jobId);
    const current = getState().jobs.find((j) => j.id === jobId);
    if (current && (current.status === "loading" || current.status === "injecting")) {
      cancelled = true;
      setJob(jobId, { status: "cancelled", error: "Window closed", finishedAt: Date.now() });
    }
  });

  await waitForLoad(win, injectUrl, settings.pageTimeoutSec * 1000);
  if (cancelled || win.isDestroyed()) return;

  const landed = win.webContents.getURL();
  if (new URL(landed).host !== new URL(injectUrl).host && LOGIN_URL_HINT.test(landed)) {
    update((s) => {
      const a = s.accounts.find((x) => x.id === account.id);
      if (a) a.status = "logged-out";
    });
    throw new Error(`Not signed in — redirected to ${new URL(landed).host}. Sign in to this account and retry.`);
  }

  setJob(jobId, { status: "injecting", url: landed });
  const code = `(${info.injectFunction.toString()})(${JSON.stringify({ ...syncData, isAutoPublish: syncData.isAutoPublish })})`;
  const settled = await Promise.race([
    win.webContents
      .executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [{ code }], true)
      .then(() => ({ ok: true as const }))
      .catch((error: Error) => ({ ok: false as const, error })),
    new Promise<{ ok: true; timedOut: true }>((resolve) =>
      setTimeout(() => resolve({ ok: true, timedOut: true }), INJECT_SETTLE_MS),
    ),
  ]);
  if (cancelled) return;

  if (!settled.ok) {
    // A navigation after submitting (the usual "post published, go to the feed" redirect) tears down the
    // world the script ran in. That is a success, not a failure.
    if (win.isDestroyed()) return;
    const err = (settled as { error?: Error }).error;
    const msg = err?.message ?? String(err);
    const navigatedAway = win.webContents.getURL() !== landed;
    if (!navigatedAway) throw new Error(msg);
  }
  setJob(jobId, { status: "done", finishedAt: Date.now(), url: win.isDestroyed() ? landed : win.webContents.getURL() });
  if (settings.closeWindowsOnSuccess && syncData.isAutoPublish && !win.isDestroyed()) {
    setTimeout(() => !win.isDestroyed() && win.close(), 5000);
  }
}

function customInjectUrl(account: Account): string | undefined {
  const urls = (account.extraConfig as { customInjectUrls?: string[] } | undefined)?.customInjectUrls;
  return urls?.find((u) => /^https?:\/\//.test(u));
}

export function retryJob(jobId: string) {
  const job = getState().jobs.find((j) => j.id === jobId);
  if (!job || !runs.get(job.runId)?.syncDataByJob.has(jobId)) {
    throw new Error("This job's files are no longer available. Publish again from the composer.");
  }
  if (job.status === "loading" || job.status === "injecting" || job.status === "queued") return;
  const win = windows.get(jobId);
  if (win && !win.isDestroyed()) win.destroy();
  setJob(jobId, { status: "queued", error: undefined, finishedAt: undefined });
  queue.push(jobId);
  pump();
}

export function cancelJob(jobId: string) {
  const idx = queue.indexOf(jobId);
  if (idx >= 0) queue.splice(idx, 1);
  const job = getState().jobs.find((j) => j.id === jobId);
  if (job && (job.status === "queued" || job.status === "loading" || job.status === "injecting")) {
    setJob(jobId, { status: "cancelled", error: "Cancelled", finishedAt: Date.now() });
  }
  const win = windows.get(jobId);
  if (win && !win.isDestroyed()) win.destroy();
}

export function showJobWindow(jobId: string): boolean {
  const win = windows.get(jobId);
  if (!win || win.isDestroyed()) return false;
  win.show();
  win.focus();
  return true;
}

export function canRetry(jobId: string): boolean {
  const job = getState().jobs.find((j) => j.id === jobId);
  return !!job && !!runs.get(job.runId)?.syncDataByJob.has(jobId);
}

export function activeJobCount() {
  return active + queue.length;
}
