// "Check targets": open each target's publish page hidden and confirm it is usable before publishing:
// still signed in, page loads, and an editor or upload field is present (platforms change their pages).
import type { Account, PreflightReport, PublishTarget } from "../shared/types";
import { createAccountWindow } from "./browser-windows";
import { getPlatformInfo } from "./platforms";
import { customInjectUrl, looksLikeLogin, markLoggedOut, siteOf } from "./publisher";
import { getState } from "./store";

const PROBE = `(() => !!document.querySelector(
  'input[type=file], [contenteditable="true"], [contenteditable=""], textarea, .ql-editor, .ProseMirror, [role="textbox"], .DraftEditor-root, iframe[src*="editor"]'
))()`;
const PROBE_TIMEOUT_MS = 20_000;
const PARALLEL = 3;

async function checkOne(account: Account, platform: string): Promise<PreflightReport> {
  const info = getPlatformInfo(platform);
  if (!info) return { accountId: account.id, platform, result: "load-failed", detail: "Unknown platform" };
  const url = customInjectUrl(account) ?? info.injectUrl;
  const win = await createAccountWindow(account, { title: "check", show: false });
  try {
    let failed: string | undefined;
    win.webContents.on("did-fail-load", (_e, code, desc, _u, isMainFrame) => {
      if (isMainFrame && code !== -3) failed = `${desc} (${code})`;
    });
    await Promise.race([win.loadURL(url).catch(() => {}), new Promise((r) => setTimeout(r, 45_000))]);
    if (failed) return { accountId: account.id, platform, result: "load-failed", detail: failed };
    const landed = win.webContents.getURL();
    if (looksLikeLogin(landed, url) || (siteOf(landed) !== siteOf(url) && /login|passport|sso|signin/i.test(landed))) {
      markLoggedOut(account.id);
      return { accountId: account.id, platform, result: "signed-out", detail: new URL(landed).host };
    }
    // SPAs render their editor after load: poll for it.
    const deadline = Date.now() + PROBE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const found = await win.webContents.executeJavaScriptInIsolatedWorld(1002, [{ code: PROBE }]).catch(() => false);
      if (found) return { accountId: account.id, platform, result: "ok" };
      const now = win.webContents.getURL();
      if (looksLikeLogin(now, url)) {
        markLoggedOut(account.id);
        return { accountId: account.id, platform, result: "signed-out", detail: new URL(now).host };
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return { accountId: account.id, platform, result: "page-changed", detail: win.webContents.getURL() };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

export async function preflight(targets: PublishTarget[]): Promise<PreflightReport[]> {
  const accounts = new Map(getState().accounts.map((a) => [a.id, a]));
  const work = targets.filter((t) => accounts.has(t.accountId));
  const results: PreflightReport[] = [];
  let next = 0;
  async function worker() {
    while (next < work.length) {
      const t = work[next++];
      try {
        results.push(await checkOne(accounts.get(t.accountId)!, t.platform));
      } catch (error) {
        results.push({
          accountId: t.accountId,
          platform: t.platform,
          result: "load-failed",
          detail: (error as Error).message,
        });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, work.length) }, worker));
  return results;
}
