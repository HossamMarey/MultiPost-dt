// Chromium windows that browse as a specific account.
import path from "node:path";
import { BrowserWindow, type BrowserWindowConstructorOptions, shell } from "electron";
import type { Account } from "../shared/types";
import { sessionForAccount } from "./sessions";

const ICON = path.join(__dirname, "icon.png");

export async function createAccountWindow(
  account: Account,
  opts: { title: string; show: boolean; width?: number; height?: number; webSecurity?: boolean },
): Promise<BrowserWindow> {
  const ses = await sessionForAccount(account);
  const webPreferences: BrowserWindowConstructorOptions["webPreferences"] = {
    session: ses,
    // Runs the extension's MAIN-world helper (upload shims) at document start on the pages that need it.
    preload: path.join(__dirname, "page-preload.js"),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    backgroundThrottling: false, // publishing must keep running while the window is in the background
    spellcheck: false,
    webSecurity: opts.webSecurity ?? true,
  };
  const win = new BrowserWindow({
    width: opts.width ?? 1280,
    height: opts.height ?? 860,
    show: opts.show,
    title: opts.title,
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences,
  });
  win.on("page-title-updated", (event, pageTitle) => {
    event.preventDefault();
    win.setTitle(`${opts.title} — ${pageTitle}`);
  });
  // Popups (OAuth, upload dialogs) stay in the same account session; non-web links go to the OS.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!/^https?:/i.test(url) && url !== "about:blank") {
      shell.openExternal(url).catch(() => {});
      return { action: "deny" };
    }
    return {
      action: "allow",
      overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: ICON, webPreferences },
    };
  });
  return win;
}
