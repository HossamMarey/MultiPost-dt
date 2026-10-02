import "./i18n-shim";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, Menu, app, dialog, ipcMain, nativeTheme, session, shell } from "electron";
import {
  type Account,
  type AppState,
  GROUP_COLORS,
  type Group,
  type LocalFile,
  type PublishRequest,
  type Settings,
} from "../shared/types";
import { closeLoginWindow, detectAccount, openLoginWindow } from "./accounts";
import { describeAiError, rewriteForPlatform } from "./ai";
import { currentLocale } from "./i18n-shim";
import { listPlatforms, listSites } from "./platforms";
import { preflight } from "./preflight";
import {
  activeJobCount,
  canRetry,
  cancelJob,
  forgetRuns,
  openJobWindowIds,
  retryJob,
  showJobWindow,
  startPublish,
} from "./publisher";
import { detectRegion } from "./region";
import {
  cleanUserAgent,
  clearAccountSession,
  getOnlyProxyCredentials,
  getProxyCredentials,
  isSafeAccountId,
  partitionFor,
  registerSchemes,
  removePartitionDirs,
  validateProxy,
} from "./sessions";
import { SECRET_MASK, flush, getState, loadState, onChange, publicState, replaceState, update } from "./store";
import { startAutoUpdates } from "./updater";

registerSchemes();

// A second instance must exit before it touches anything: the first one owns the data file.
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) {
  app.exit(0);
}

let mainWindow: BrowserWindow | null = null;

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".heic": "image/heic",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".flv": "video/x-flv",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function toLocalFile(filePath: string): LocalFile | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    return {
      path: filePath,
      name: path.basename(filePath),
      size: stat.size,
      type: MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    title: "MultiPost Desktop",
    icon: path.join(__dirname, "icon.png"),
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0b0d12" : "#f7f8fa",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "app-preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e) => e.preventDefault());
  mainWindow.on("close", (e) => {
    const pending = activeJobCount();
    if (pending > 0) {
      const choice = dialog.showMessageBoxSync(mainWindow!, {
        type: "warning",
        buttons: ["Keep running", "Quit anyway"],
        defaultId: 0,
        cancelId: 0,
        message: `${pending} publish job(s) are still running.`,
        detail: "Quitting now closes their windows before they finish.",
      });
      if (choice === 0) {
        e.preventDefault();
        return;
      }
    }
    app.quit();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

// Push state to the UI, coalescing bursts of updates into one message per frame.
let pushTimer: NodeJS.Timeout | null = null;
onChange(() => {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    mainWindow?.webContents.send("state", publicState());
  }, 16);
});

function stripProxyCredentials(proxy: string | undefined): string | undefined {
  if (!proxy) return proxy;
  try {
    const u = new URL(/^[a-z0-9]+:\/\//i.test(proxy) ? proxy : `http://${proxy}`);
    u.username = "";
    u.password = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function sanitizeAccountPatch(patch: Partial<Account>): Partial<Account> {
  const allowed: (keyof Account)[] = ["label", "proxy", "userAgent", "extraConfig", "notes", "timezone", "locale"];
  const out: Partial<Account> = {};
  for (const key of allowed) if (key in patch) (out as Record<string, unknown>)[key] = patch[key];
  if (typeof out.label === "string") out.label = out.label.trim().slice(0, 80) || "Account";
  return out;
}

// Every app command must come from the app's own UI, never from a website shown in an account window.
// (Account windows expose no bridge today; this keeps it that way even if one is added by mistake.)
function handle(channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    const fromMainWindow = !!mainWindow && event.sender === mainWindow.webContents;
    const url = event.senderFrame?.url ?? "";
    if (!fromMainWindow || !url.startsWith("file://") || event.senderFrame !== event.sender.mainFrame) {
      throw new Error("Blocked: request did not come from the MultiPost window");
    }
    return listener(event, ...args);
  });
}

function registerIpc() {
  handle("app:init", () => ({
    state: publicState(),
    platforms: listPlatforms(),
    sites: listSites(),
    version: app.getVersion(),
    locale: currentLocale,
    platform: process.platform,
  }));

  // Groups
  handle("group:create", (_e, name: string) => {
    const group: Group = {
      id: crypto.randomUUID(),
      name: name.trim().slice(0, 60) || "Group",
      color: GROUP_COLORS[getState().groups.length % GROUP_COLORS.length],
      accountIds: [],
      createdAt: Date.now(),
    };
    update((s) => s.groups.push(group));
    return group;
  });
  handle(
    "group:update",
    (_e, id: string, patch: Partial<Pick<Group, "name" | "color" | "accountIds" | "footer" | "hashtags">>) => {
      update((s) => {
        const g = s.groups.find((x) => x.id === id);
        if (!g) return;
        if (typeof patch.name === "string") g.name = patch.name.trim().slice(0, 60) || g.name;
        if (typeof patch.color === "string") g.color = patch.color;
        if (Array.isArray(patch.accountIds)) {
          const valid = new Set(s.accounts.map((a) => a.id));
          g.accountIds = [...new Set(patch.accountIds)].filter((x) => valid.has(x));
        }
        if (typeof patch.footer === "string") g.footer = patch.footer.slice(0, 2000) || undefined;
        if (Array.isArray(patch.hashtags)) {
          g.hashtags = [
            ...new Set(patch.hashtags.map((t) => String(t).trim().replace(/^#+/, "")).filter(Boolean)),
          ].slice(0, 50);
        }
      });
    },
  );
  handle("group:delete", (_e, id: string) => {
    update((s) => {
      s.groups = s.groups.filter((g) => g.id !== id);
    });
  });
  handle("group:reorder", (_e, ids: string[]) => {
    update((s) => {
      const order = new Map(ids.map((id, i) => [id, i]));
      s.groups.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
    });
  });

  // Accounts
  handle("account:create", (_e, input: { accountKey: string; label: string; proxy?: string; groupIds?: string[] }) => {
    if (!listSites().some((s) => s.accountKey === input.accountKey)) throw new Error("Unknown site");
    validateProxy(input.proxy);
    const id = crypto.randomUUID();
    const account: Account = {
      id,
      accountKey: input.accountKey,
      label: input.label?.trim().slice(0, 80) || "Account",
      partition: partitionFor(id),
      proxy: input.proxy?.trim() || undefined,
      status: "unknown",
      createdAt: Date.now(),
    };
    update((s) => {
      s.accounts.push(account);
      for (const g of s.groups) if (input.groupIds?.includes(g.id)) g.accountIds.push(id);
    });
    return account;
  });
  handle("account:update", (_e, id: string, patch: Partial<Account>) => {
    if ("proxy" in patch) validateProxy(patch.proxy);
    update((s) => {
      const a = s.accounts.find((x) => x.id === id);
      if (a) Object.assign(a, sanitizeAccountPatch(patch));
    });
  });
  handle("account:setGroups", (_e, id: string, groupIds: string[]) => {
    update((s) => {
      for (const g of s.groups) {
        const has = g.accountIds.includes(id);
        const want = groupIds.includes(g.id);
        if (want && !has) g.accountIds.push(id);
        if (!want && has) g.accountIds = g.accountIds.filter((x) => x !== id);
      }
    });
  });
  handle("account:delete", async (_e, id: string) => {
    const account = getState().accounts.find((a) => a.id === id);
    if (!account) return;
    closeLoginWindow(id);
    await clearAccountSession(account).catch(() => {});
    update((s) => {
      s.accounts = s.accounts.filter((a) => a.id !== id);
      for (const g of s.groups) g.accountIds = g.accountIds.filter((x) => x !== id);
    });
    // Chromium keeps the folder locked while the session is loaded (always on Windows): delete on next start.
    update((s) => {
      s.pendingPartitionDeletes = [...new Set([...(s.pendingPartitionDeletes ?? []), account.partition])];
    });
  });
  handle("account:login", (_e, id: string) => openLoginWindow(id));
  handle("account:detect", (_e, id: string) => detectAccount(id));
  handle("account:detectAll", async () => {
    const ids = getState().accounts.map((a) => a.id);
    // A few at a time: each check spins up a hidden page.
    for (let i = 0; i < ids.length; i += 3) {
      await Promise.all(ids.slice(i, i + 3).map((id) => detectAccount(id).catch(() => null)));
    }
  });
  handle("account:signOut", async (_e, id: string) => {
    const account = getState().accounts.find((a) => a.id === id);
    if (!account) return;
    closeLoginWindow(id);
    await clearAccountSession(account);
    update((s) => {
      const a = s.accounts.find((x) => x.id === id);
      if (a) {
        a.status = "logged-out";
        a.profile = undefined;
      }
    });
  });

  // Files
  handle("files:pick", async (_e, kind: "image" | "video" | "audio" | "any", multiple: boolean) => {
    const filters: Record<string, Electron.FileFilter[]> = {
      image: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "webp", "bmp"] }],
      video: [{ name: "Videos", extensions: ["mp4", "mov", "m4v", "webm", "mkv", "avi", "flv"] }],
      audio: [{ name: "Audio", extensions: ["mp3", "m4a", "wav", "aac", "ogg", "flac"] }],
      any: [],
    };
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: multiple ? ["openFile", "multiSelections"] : ["openFile"],
      filters: filters[kind],
    });
    if (result.canceled) return [];
    return result.filePaths.map(toLocalFile).filter(Boolean);
  });
  handle("files:fromPaths", (_e, paths: string[]) => paths.map(toLocalFile).filter(Boolean));

  // Publishing
  handle("publish:start", (_e, request: PublishRequest) => startPublish(request));
  handle("job:retry", (_e, id: string) => retryJob(id));
  handle("job:cancel", (_e, id: string) => cancelJob(id));
  handle("job:show", (_e, id: string) => showJobWindow(id));
  handle("job:canRetry", (_e, ids: string[]) => ids.filter((id) => canRetry(id)));
  handle("job:openWindows", () => openJobWindowIds());
  handle("publish:preflight", (_e, targets: PublishRequest["targets"]) => preflight(targets));
  handle("ai:rewrite", async (_e, input: Parameters<typeof rewriteForPlatform>[0]) => {
    try {
      return await rewriteForPlatform(input);
    } catch (error) {
      throw new Error(describeAiError(error));
    }
  });
  handle("account:detectRegion", (_e, id: string) => detectRegion(id));
  handle("history:clear", () => {
    const before = new Set(getState().runs.map((r) => r.id));
    update((s) => {
      const running = new Set(
        s.jobs
          .filter((j) => j.status === "queued" || j.status === "loading" || j.status === "injecting")
          .map((j) => j.runId),
      );
      s.runs = s.runs.filter((r) => running.has(r.id));
      const keep = new Set(s.runs.flatMap((r) => r.jobIds));
      s.jobs = s.jobs.filter((j) => keep.has(j.id));
    });
    const after = new Set(getState().runs.map((r) => r.id));
    forgetRuns([...before].filter((id) => !after.has(id)));
  });

  // Settings & data
  handle("settings:update", (_e, incoming: Partial<Settings>) => {
    // The UI only ever sees a mask for the stored key: sending the mask back means "unchanged".
    const { aiApiKey, ...rest } = incoming;
    const patch: Partial<Settings> = rest;
    if (typeof aiApiKey === "string" && aiApiKey !== SECRET_MASK) patch.aiApiKey = aiApiKey.trim() || undefined;
    update((s) => {
      const next = { ...s.settings, ...patch };
      next.concurrency = Math.min(10, Math.max(1, Math.round(Number(next.concurrency) || 1)));
      next.pageTimeoutSec = Math.min(300, Math.max(10, Math.round(Number(next.pageTimeoutSec) || 60)));
      next.maxOpenWindows = Math.min(30, Math.max(1, Math.round(Number(next.maxOpenWindows) || 8)));
      s.settings = next;
    });
    if (patch.theme) nativeTheme.themeSource = patch.theme;
  });
  handle("data:export", async () => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: `multipost-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return false;
    const { groups, accounts, settings } = getState();
    // Backups may be shared or synced to the cloud: never include proxy passwords.
    const safeAccounts = accounts.map((a) => ({ ...a, proxy: stripProxyCredentials(a.proxy) }));
    fs.writeFileSync(
      result.filePath,
      JSON.stringify(
        {
          format: "multipost-desktop",
          version: 1,
          groups,
          accounts: safeAccounts,
          settings: { ...settings, aiApiKey: undefined },
        },
        null,
        2,
      ),
    );
    return true;
  });
  handle("data:import", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0]) return false;
    const parsed = JSON.parse(fs.readFileSync(result.filePaths[0], "utf8")) as Partial<AppState> & { format?: string };
    if (parsed.format !== "multipost-desktop" || !Array.isArray(parsed.accounts) || !Array.isArray(parsed.groups)) {
      throw new Error("This file is not a MultiPost Desktop backup");
    }
    const current = getState();
    const sites = new Set(listSites().map((x) => x.accountKey));
    // Never trust paths from a file: partitions are rebuilt from validated ids.
    const imported: Account[] = parsed.accounts
      .filter((a) => isSafeAccountId(a?.id) && sites.has(a.accountKey))
      .map((a) => {
        let proxy = typeof a.proxy === "string" ? a.proxy.trim() : undefined;
        try {
          validateProxy(proxy);
        } catch {
          proxy = undefined;
        }
        return {
          id: a.id,
          accountKey: a.accountKey,
          label: String(a.label ?? "Account").slice(0, 80),
          partition: partitionFor(a.id),
          proxy: proxy || undefined,
          userAgent: typeof a.userAgent === "string" ? a.userAgent : undefined,
          extraConfig: a.extraConfig && typeof a.extraConfig === "object" ? a.extraConfig : undefined,
          notes: typeof a.notes === "string" ? a.notes : undefined,
          status: "unknown",
          createdAt: Number(a.createdAt) || Date.now(),
        } satisfies Account;
      });
    const importedIds = new Set(imported.map((a) => a.id));
    // A restored account must not have its (reused) profile folder wiped at the next start.
    update((s) => {
      s.pendingPartitionDeletes = (s.pendingPartitionDeletes ?? []).filter(
        (p) => !imported.some((a) => a.partition === p),
      );
    });
    const accounts = [...current.accounts.filter((a) => !importedIds.has(a.id)), ...imported];
    const validIds = new Set(accounts.map((a) => a.id));
    const importedGroups: Group[] = parsed.groups
      .filter((g) => typeof g?.id === "string" && typeof g.name === "string")
      .map((g) => ({
        id: g.id,
        name: g.name.slice(0, 60),
        color: typeof g.color === "string" && /^#[0-9a-f]{6}$/i.test(g.color) ? g.color : GROUP_COLORS[0],
        accountIds: (Array.isArray(g.accountIds) ? g.accountIds : []).filter((x) => validIds.has(x)),
        createdAt: Number(g.createdAt) || Date.now(),
      }));
    const groups = [...current.groups.filter((g) => !importedGroups.some((b) => b.id === g.id)), ...importedGroups];
    replaceState({ ...current, accounts, groups });
    return true;
  });
  handle("data:openFolder", () => shell.openPath(app.getPath("userData")));
  handle("app:relaunch", () => {
    flush();
    app.relaunch();
    app.exit(0);
  });
  handle("app:openExternal", (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url);
  });
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Proxy authentication for accounts configured with user:pass proxies.
app.on("login", (event, webContents, _details, authInfo, callback) => {
  if (!authInfo.isProxy) return;
  // Service-worker requests have no webContents; fall back to the only configured credentials.
  const creds = webContents ? getProxyCredentials(webContents.session) : getOnlyProxyCredentials();
  if (!creds) return;
  event.preventDefault();
  // Chromium asks again after a rejected password; give up after a retry instead of looping
  // until the page times out, so the job fails with a proxy error.
  const key = `${creds.username}@${authInfo.host}:${authInfo.port}`;
  const attempts = (proxyAuthAttempts.get(key) ?? 0) + 1;
  proxyAuthAttempts.set(key, attempts);
  setTimeout(() => proxyAuthAttempts.delete(key), 30_000);
  if (attempts > 2) callback();
  else callback(creds.username, creds.password);
});

const proxyAuthAttempts = new Map<string, number>();

app.whenReady().then(() => {
  if (!isPrimaryInstance) return;
  // Default UA for every session, then each account session sets its own (see sessions.ts).
  app.userAgentFallback = cleanUserAgent(app.userAgentFallback);
  session.defaultSession.setUserAgent(cleanUserAgent(session.defaultSession.getUserAgent()));
  loadState();
  const pending = getState().pendingPartitionDeletes ?? [];
  if (pending.length) {
    const remaining = removePartitionDirs(pending);
    update((s) => {
      s.pendingPartitionDeletes = remaining;
    });
  }
  nativeTheme.themeSource = getState().settings.theme;
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  app.setAppUserModelId("com.leaperone.multipost.desktop");
  registerIpc();
  createMainWindow();
  startAutoUpdates();
});

app.on("before-quit", () => {
  try {
    flush();
  } catch (error) {
    console.error(error);
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (!mainWindow) createMainWindow();
});
