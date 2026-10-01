import type { MultiPostApi } from "../preload/app-preload";
import type { AppState, PlatformMeta, SiteMeta } from "../shared/types";

declare global {
  interface Window {
    multipost: MultiPostApi;
  }
}

export const api = window.multipost;

export interface InitData {
  state: AppState;
  platforms: PlatformMeta[];
  sites: SiteMeta[];
  version: string;
  locale: "en" | "zh_CN";
  platform: string;
}

/** file:// URL for previewing a local file inside the UI. */
export function fileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const prefixed = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${prefixed
    .split("/")
    .map(encodeURIComponent)
    .join("/")
    .replace(/^\/([A-Za-z])%3A/, "/$1:")}`;
}

export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // ipcRenderer.invoke prefixes "Error invoking remote method 'x': Error: "
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
