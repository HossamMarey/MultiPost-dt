// Types shared by the main process, preload and renderer.

export type ContentType = "DYNAMIC" | "ARTICLE" | "VIDEO" | "PODCAST";

export interface PlatformMeta {
  name: string; // e.g. DYNAMIC_X — unique key from the extension InfoMaps
  type: ContentType;
  platformName: string; // localized display name
  homeUrl: string;
  injectUrl: string;
  faviconUrl?: string;
  accountKey: string; // accounts are keyed by site, one login covers every content type of that site
  tags: string[];
}

/** A login target: one site the user can sign in to (derived from accountKey). */
export interface SiteMeta {
  accountKey: string;
  label: string;
  homeUrl: string;
  faviconUrl?: string;
  types: ContentType[];
  canDetect: boolean; // an account-info getter exists for this site
  region: "International" | "CN";
}

export interface Group {
  id: string;
  name: string;
  color: string;
  accountIds: string[];
  createdAt: number;
}

export interface AccountProfile {
  username: string;
  accountId?: string;
  avatarUrl?: string;
  profileUrl?: string;
  checkedAt: number;
}

export interface Account {
  id: string;
  accountKey: string;
  label: string; // user-given name, e.g. "Brand EN"
  partition: string; // persist:acc-<id> — isolated Chromium storage
  proxy?: string; // optional, e.g. socks5://127.0.0.1:1080 or http://user:pass@host:port
  userAgent?: string; // optional override
  extraConfig?: Record<string, unknown>; // platform specific (e.g. webhook urls)
  profile?: AccountProfile;
  status: "unknown" | "logged-in" | "logged-out";
  notes?: string;
  createdAt: number;
}

export interface Settings {
  concurrency: number;
  autoPublish: boolean;
  closeWindowsOnSuccess: boolean;
  showPublishWindows: boolean;
  pageTimeoutSec: number;
  maxOpenWindows: number; // publish windows kept open at once (finished ones included)
  language: "en" | "zh_CN";
  theme: "system" | "light" | "dark";
}

export interface LocalFile {
  path: string;
  name: string;
  size: number;
  type: string;
}

export interface Draft {
  contentType: ContentType;
  title: string;
  content: string; // dynamic text / video description / podcast description
  digest: string; // article summary
  htmlContent: string;
  markdownContent: string;
  tags: string[];
  images: LocalFile[];
  videos: LocalFile[];
  video?: LocalFile;
  audio?: LocalFile;
  cover?: LocalFile;
  scheduledPublishTime?: number;
}

export interface PublishTarget {
  accountId: string;
  platform: string; // PlatformMeta.name
}

export interface PublishRequest {
  draft: Draft;
  targets: PublishTarget[];
  autoPublish: boolean;
}

// "attention": the page is filled but we could not confirm the result — the user should look at the window.
export type JobStatus = "queued" | "loading" | "injecting" | "done" | "attention" | "failed" | "cancelled";

export interface PublishJob {
  id: string;
  runId: string;
  accountId: string;
  accountLabel: string;
  platform: string;
  platformName: string;
  status: JobStatus;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  url?: string;
  attempts: number;
  autoPublish?: boolean;
}

export interface PublishRun {
  id: string;
  createdAt: number;
  title: string;
  contentType: ContentType;
  jobIds: string[];
}

export interface AppState {
  groups: Group[];
  accounts: Account[];
  settings: Settings;
  runs: PublishRun[];
  jobs: PublishJob[];
  pendingPartitionDeletes?: string[]; // folders of deleted accounts still locked by Chromium
}

export const DEFAULT_SETTINGS: Settings = {
  concurrency: 3,
  autoPublish: false,
  closeWindowsOnSuccess: false,
  showPublishWindows: true,
  pageTimeoutSec: 60,
  maxOpenWindows: 8,
  language: "en",
  theme: "system",
};

export const GROUP_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#8b5cf6", "#64748b"];
