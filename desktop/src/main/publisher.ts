// Publishing queue: one Chromium window per (account, platform) job, run with bounded concurrency.
// Each job opens the platform's publish page in the account's session and runs the extension's
// injectFunction there, exactly like chrome.scripting.executeScript does in the extension.
import crypto from "node:crypto";
import type { BrowserWindow } from "electron";
import type { ArticleData, DynamicData, FileData, PodcastData, SyncData, VideoData } from "~sync/common";
import type { Account, Draft, JobStatus, LocalFile, PublishJob, PublishRequest } from "../shared/types";
import { createAccountWindow } from "./browser-windows";
import { markdownToHtml } from "./markdown";
import { getPlatformInfo } from "./platforms";
import { revokeFiles, serveFile } from "./sessions";
import { getState, update } from "./store";

// Same isolation the extension gets from chrome.scripting (ISOLATED world): page scripts cannot
// tamper with the inject function, while the DOM is shared.
const ISOLATED_WORLD_ID = 1001;
// The inject functions resolve when they finish filling the form (or after publishing). Some keep
// polling forever; after this long we stop waiting and ask the user to look at the window.
const INJECT_SETTLE_MS = 10 * 60_000;
// A renderer that stays unresponsive this long is treated as hung.
const UNRESPONSIVE_MS = 45_000;
const LOGIN_URL_HINT = /(login|signin|sign-in|sign_in|passport|account\/begin|oauth|sso|captcha|challenge)/i;
const ACTIVE: JobStatus[] = ["queued", "loading", "injecting"];

interface RunContext {
  syncDataByJob: Map<string, SyncData>;
  fileTokens: string[];
}

interface JobWindow {
  win: BrowserWindow;
  finished: boolean;
  autoPublish: boolean;
}

const runs = new Map<string, RunContext>();
const windows = new Map<string, JobWindow>();
const queue: string[] = [];
let active = 0;

function buildData(draft: Draft, tokens: string[]): DynamicData | ArticleData | VideoData | PodcastData {
  const serve = (file: LocalFile) => {
    const served = serveFile(file);
    tokens.push(served.token);
    return served.data;
  };
  const toFileData = (file: LocalFile | undefined): FileData | undefined => (file ? serve(file) : undefined);
  switch (draft.contentType) {
    case "DYNAMIC":
      return {
        title: draft.title,
        content: draft.content,
        images: draft.images.map(serve),
        videos: draft.videos.map(serve),
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
  const ctx: RunContext = { syncDataByJob: new Map(), fileTokens: [] };
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
      autoPublish: request.autoPublish,
    };
    // Every job gets its own copy (and its own file tokens) of the payload.
    ctx.syncDataByJob.set(job.id, {
      platforms: [{ name: info.name, injectUrl: info.injectUrl, extraConfig: account.extraConfig }],
      isAutoPublish: request.autoPublish,
      data: buildData(request.draft, ctx.fileTokens),
    });
    jobs.push(job);
  }
  if (jobs.length === 0) {
    revokeFiles(ctx.fileTokens);
    throw new Error("No valid targets selected");
  }

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

function jobStatus(jobId: string): JobStatus | undefined {
  return getState().jobs.find((j) => j.id === jobId)?.status;
}

/**
 * Close the oldest windows nobody needs to make room: auto-published successes first, then failed or
 * cancelled jobs (the error is in Activity, and Retry reopens the page). Windows awaiting review stay open.
 */
function freeWindowSlots(limit: number) {
  const reclaimable = (jobId: string, entry: JobWindow) => {
    const status = jobStatus(jobId);
    if (!entry.finished || entry.win.isDestroyed()) return false;
    return (entry.autoPublish && status === "done") || status === "failed" || status === "cancelled";
  };
  for (const [jobId, entry] of windows) {
    if (windows.size < limit) return;
    if (reclaimable(jobId, entry)) {
      entry.win.destroy();
      windows.delete(jobId);
    }
  }
}

function pump() {
  const { concurrency, maxOpenWindows } = getState().settings;
  const windowLimit = Math.max(1, maxOpenWindows || 8);
  while (active < Math.max(1, concurrency) && queue.length > 0) {
    if (windows.size >= windowLimit) freeWindowSlots(windowLimit);
    // Every open window is a renderer process; wait until the user closes some instead of exhausting memory.
    if (windows.size >= windowLimit) return;
    const jobId = queue.shift()!;
    active++;
    runJob(jobId)
      .catch((error) => {
        if (ACTIVE.includes(jobStatus(jobId)!)) {
          setJob(jobId, { status: "failed", error: (error as Error).message, finishedAt: Date.now() });
        }
      })
      .finally(() => {
        active--;
        const entry = windows.get(jobId);
        if (entry) entry.finished = true;
        pump();
      });
  }
}

class JobAbort extends Error {}

/** Rejects when the page crashes, hangs, or its window is closed — for the whole life of the job. */
function watchdog(win: BrowserWindow): { aborted: Promise<never>; dispose: () => void } {
  let reject!: (e: Error) => void;
  const aborted = new Promise<never>((_, r) => {
    reject = r;
  });
  aborted.catch(() => {}); // observed via Promise.race
  const wc = win.webContents;
  let hangTimer: NodeJS.Timeout | null = null;
  const onGone = (_e: unknown, details: Electron.RenderProcessGoneDetails) =>
    reject(new JobAbort(`The page crashed (${details.reason}). Retry, or check the account in its browser.`));
  const onUnresponsive = () => {
    hangTimer ??= setTimeout(() => reject(new JobAbort("The page stopped responding.")), UNRESPONSIVE_MS);
  };
  const onResponsive = () => {
    if (hangTimer) clearTimeout(hangTimer);
    hangTimer = null;
  };
  const onClosed = () => reject(new JobAbort("Window closed"));
  wc.on("render-process-gone", onGone);
  win.on("unresponsive", onUnresponsive);
  win.on("responsive", onResponsive);
  win.on("closed", onClosed);
  return {
    aborted,
    dispose: () => {
      if (hangTimer) clearTimeout(hangTimer);
      if (!win.isDestroyed()) {
        wc.removeListener("render-process-gone", onGone);
        win.removeListener("unresponsive", onUnresponsive);
        win.removeListener("responsive", onResponsive);
        win.removeListener("closed", onClosed);
      }
    },
  };
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
      reject(new Error(`Page failed to load: ${desc} (${code}). Check the connection or this account's proxy.`));
    };
    function cleanup() {
      clearTimeout(timer);
      if (!wc.isDestroyed()) {
        wc.removeListener("did-finish-load", onFinish);
        wc.removeListener("did-fail-load", onFail);
      }
    }
    wc.on("did-finish-load", onFinish);
    wc.on("did-fail-load", onFail);
    wc.loadURL(url).catch(() => {
      // Errors are reported through did-fail-load.
    });
  });
}

/** Rough registrable domain ("creator.douyin.com" → "douyin.com", "mp.sohu.com.cn" → "sohu.com.cn"). */
function siteOf(url: string): string {
  try {
    const parts = new URL(url).hostname.split(".");
    const take = parts.length > 2 && /^(com|net|org|gov|edu|co)$/.test(parts[parts.length - 2]) ? 3 : 2;
    return parts.slice(-take).join(".");
  } catch {
    return "";
  }
}

function looksLikeLogin(url: string, expected: string): boolean {
  try {
    const u = new URL(url);
    return LOGIN_URL_HINT.test(u.hostname + u.pathname) && u.pathname !== new URL(expected).pathname;
  } catch {
    return false;
  }
}

function markLoggedOut(accountId: string) {
  update((s) => {
    const a = s.accounts.find((x) => x.id === accountId);
    if (a) a.status = "logged-out";
  });
}

async function runJob(jobId: string) {
  const state = getState();
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job || job.status !== "queued") return;
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
  windows.set(jobId, { win, finished: false, autoPublish: syncData.isAutoPublish });
  win.on("closed", () => {
    windows.delete(jobId);
    if (ACTIVE.includes(jobStatus(jobId)!)) {
      setJob(jobId, { status: "cancelled", error: "Window closed", finishedAt: Date.now() });
    }
    pump();
  });

  // Cancelled while the window was being created: never load (let alone auto-submit) the page.
  if (jobStatus(jobId) !== "loading") {
    if (!win.isDestroyed()) win.destroy();
    return;
  }
  const dog = watchdog(win);
  try {
    await Promise.race([waitForLoad(win, injectUrl, settings.pageTimeoutSec * 1000), dog.aborted]);
    if (jobStatus(jobId) !== "loading") return;

    const landed = win.webContents.getURL();
    if (siteOf(landed) !== siteOf(injectUrl) || looksLikeLogin(landed, injectUrl)) {
      if (looksLikeLogin(landed, injectUrl)) {
        markLoggedOut(account.id);
        throw new Error(`Not signed in — the site sent this account to ${new URL(landed).host}. Sign in and retry.`);
      }
      throw new Error(`The publish page redirected to ${new URL(landed).host}. Check the account in its browser.`);
    }

    setJob(jobId, { status: "injecting", url: landed });
    const code = `(${info.injectFunction.toString()})(${JSON.stringify(syncData)})`;
    let settleTimer: NodeJS.Timeout | undefined;
    const outcome = await Promise.race([
      win.webContents
        .executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [{ code }], true)
        .then(() => ({ kind: "resolved" as const }))
        .catch((error: Error) => ({ kind: "rejected" as const, error })),
      new Promise<{ kind: "timeout" }>((resolve) => {
        settleTimer = setTimeout(() => resolve({ kind: "timeout" }), INJECT_SETTLE_MS);
      }),
      dog.aborted,
    ]).finally(() => clearTimeout(settleTimer));

    if (!ACTIVE.includes(jobStatus(jobId)!)) return; // cancelled meanwhile
    const finalUrl = win.isDestroyed() ? landed : win.webContents.getURL();

    if (outcome.kind === "timeout") {
      setJob(jobId, {
        status: "attention",
        error: "Still working after 10 minutes. Check the window to finish or retry.",
        finishedAt: Date.now(),
        url: finalUrl,
      });
      return;
    }
    if (outcome.kind === "rejected") {
      if (finalUrl === landed) throw new Error(outcome.error?.message || "The publish script failed");
      // The script's world was torn down by a navigation. After submitting, platforms usually redirect
      // to the feed/manage page — success. A login/verification page or another site is not.
      if (looksLikeLogin(finalUrl, injectUrl)) {
        markLoggedOut(account.id);
        throw new Error(`The site asked this account to sign in again (${new URL(finalUrl).host}).`);
      }
      // Without auto-submit nothing should navigate away from the form: let the user check.
      if (siteOf(finalUrl) !== siteOf(injectUrl) || !syncData.isAutoPublish) {
        setJob(jobId, {
          status: "attention",
          error: `The page moved to ${new URL(finalUrl).host}. Check the window.`,
          finishedAt: Date.now(),
          url: finalUrl,
        });
        return;
      }
    }
    setJob(jobId, { status: "done", finishedAt: Date.now(), url: finalUrl });
    if (settings.closeWindowsOnSuccess && syncData.isAutoPublish && !win.isDestroyed()) {
      setTimeout(() => !win.isDestroyed() && win.close(), 5000);
    }
  } catch (error) {
    if (error instanceof JobAbort && error.message === "Window closed") return; // handled by "closed"
    throw error;
  } finally {
    dog.dispose();
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
  if (ACTIVE.includes(job.status)) return;
  const entry = windows.get(jobId);
  windows.delete(jobId);
  if (entry && !entry.win.isDestroyed()) entry.win.destroy();
  setJob(jobId, { status: "queued", error: undefined, finishedAt: undefined });
  queue.push(jobId);
  pump();
}

export function cancelJob(jobId: string) {
  const idx = queue.indexOf(jobId);
  if (idx >= 0) queue.splice(idx, 1);
  if (ACTIVE.includes(jobStatus(jobId)!)) {
    setJob(jobId, { status: "cancelled", error: "Cancelled", finishedAt: Date.now() });
  }
  const entry = windows.get(jobId);
  if (entry && !entry.win.isDestroyed()) entry.win.destroy();
}

export function showJobWindow(jobId: string): boolean {
  const entry = windows.get(jobId);
  if (!entry || entry.win.isDestroyed()) return false;
  entry.win.show();
  entry.win.focus();
  return true;
}

export function openJobWindowIds(): string[] {
  return [...windows.keys()];
}

export function canRetry(jobId: string): boolean {
  const job = getState().jobs.find((j) => j.id === jobId);
  return !!job && !!runs.get(job.runId)?.syncDataByJob.has(jobId);
}

/** Drop in-memory payloads (and file access) of runs removed from history. */
export function forgetRuns(runIds: string[]) {
  for (const id of runIds) {
    const ctx = runs.get(id);
    if (!ctx) continue;
    revokeFiles(ctx.fileTokens);
    runs.delete(id);
  }
}

export function activeJobCount() {
  return active + queue.length;
}

export function waitingForWindowCount() {
  return queue.length;
}
