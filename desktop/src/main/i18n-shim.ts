import "./paths";
// The shared platform maps call chrome.i18n.getMessage() at import time.
// This module must be imported before them so the call resolves against the bundled locale files.
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import en from "../../../locales/en/messages.json";
import zh from "../../../locales/zh_CN/messages.json";

type Messages = Record<string, { message: string }>;

let primary: Messages = en as Messages;

export function setLocale(locale: "en" | "zh_CN") {
  primary = (locale === "zh_CN" ? zh : en) as Messages;
}

export function getMessage(key: string): string {
  return primary[key]?.message ?? (zh as Messages)[key]?.message ?? (en as Messages)[key]?.message ?? key;
}

// Locale must be known before the maps evaluate, so read the saved setting synchronously.
// Changing the language therefore takes effect after a restart.
function readSavedLocale(): "en" | "zh_CN" {
  try {
    const file = path.join(app.getPath("userData"), "multipost-data.json");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (saved?.settings?.language === "zh_CN") return "zh_CN";
    if (saved?.settings?.language === "en") return "en";
  } catch {
    // first run
  }
  // app.getLocale() is empty before "ready"; Intl reflects the OS language already.
  const system = Intl.DateTimeFormat().resolvedOptions().locale || process.env.LANG || "";
  return system.toLowerCase().startsWith("zh") ? "zh_CN" : "en";
}

export const currentLocale = readSavedLocale();
setLocale(currentLocale);

(globalThis as unknown as { chrome: unknown }).chrome = {
  i18n: { getMessage, getUILanguage: () => (currentLocale === "zh_CN" ? "zh-CN" : "en") },
};
