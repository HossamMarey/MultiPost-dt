// Login windows and logged-in account detection, each inside the account's own session.
import fs from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";
import type { Account, AccountProfile } from "../shared/types";
import { ACCOUNT_GETTER_HOMES } from "./account-getter-keys";
import { createAccountWindow } from "./browser-windows";
import { listSites } from "./platforms";
import { markScriptless } from "./sessions";
import { getState, update } from "./store";

const loginWindows = new Map<string, BrowserWindow>();
let gettersCode: string | null = null;

function getGettersCode() {
  gettersCode ??= fs.readFileSync(path.join(__dirname, "account-getters.js"), "utf8");
  return gettersCode;
}

function findAccount(id: string): Account {
  const account = getState().accounts.find((a) => a.id === id);
  if (!account) throw new Error(`Account ${id} not found`);
  return account;
}

export async function openLoginWindow(accountId: string, url?: string) {
  const existing = loginWindows.get(accountId);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return;
  }
  const account = findAccount(accountId);
  const site = listSites().find((s) => s.accountKey === account.accountKey);
  const win = await createAccountWindow(account, {
    title: `${site?.label ?? account.accountKey} · ${account.label}`,
    show: true,
  });
  loginWindows.set(accountId, win);
  win.on("closed", () => {
    loginWindows.delete(accountId);
    // The user usually closes the window right after signing in; refresh what we know.
    detectAccount(accountId).catch(() => {});
  });
  await win.loadURL(url || site?.homeUrl || "about:blank").catch(() => {});
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

class NetworkError extends Error {}

const detecting = new Map<string, Promise<Account>>();

/** Runs the extension's account getter for this site on the site's own origin, in a hidden window. */
export function detectAccount(accountId: string): Promise<Account> {
  const running = detecting.get(accountId);
  if (running) return running;
  const job = (async () => {
    const account = findAccount(accountId);
    const home = ACCOUNT_GETTER_HOMES[account.accountKey];
    if (!home) return account;
    const win = await createAccountWindow(account, { title: "detect", show: false, webSecurity: false });
    const unmark = markScriptless(win.webContents.id);
    try {
      // Network trouble (offline, bad proxy, timeout) says nothing about the sign-in: keep the status.
      const loaded = await withTimeout(
        win.loadURL(home).then(
          () => true,
          (e: { code?: string }) => e?.code === "ERR_ABORTED", // redirects abort the first navigation
        ),
        30_000,
        "Timed out loading the site",
      ).catch(() => false);
      if (!loaded) throw new NetworkError(`Could not reach ${new URL(home).host}`);
      const code = `${getGettersCode()}\n;window.__multipostGetters[${JSON.stringify(account.accountKey)}]()`;
      const info = (await withTimeout(
        win.webContents.executeJavaScript(code, true),
        30_000,
        "Timed out reading the account",
      ).catch((error: Error) => {
        if (/Timed out/.test(error.message)) throw new NetworkError(error.message);
        return null; // the getters throw when the page has no signed-in user
      })) as {
        username?: string;
        accountId?: string;
        avatarUrl?: string;
        profileUrl?: string;
      } | null;
      update((s) => {
        const a = s.accounts.find((x) => x.id === accountId);
        if (!a) return;
        if (info?.username || info?.accountId) {
          const profile: AccountProfile = {
            username: info.username || info.accountId || "",
            accountId: info.accountId,
            avatarUrl: info.avatarUrl,
            profileUrl: info.profileUrl,
            checkedAt: Date.now(),
          };
          a.profile = profile;
          a.status = "logged-in";
        } else {
          a.status = "logged-out";
        }
      });
    } catch (error) {
      console.warn(`[accounts] detect ${account.accountKey} failed:`, (error as Error).message);
      if (!(error instanceof NetworkError)) throw error;
      throw new Error(`${(error as Error).message}. Sign-in status was not changed.`);
    } finally {
      unmark();
      if (!win.isDestroyed()) win.destroy();
    }
    return findAccount(accountId);
  })().finally(() => detecting.delete(accountId));
  detecting.set(accountId, job);
  return job;
}

export function closeLoginWindow(accountId: string) {
  const win = loginWindows.get(accountId);
  if (win && !win.isDestroyed()) win.destroy();
}
