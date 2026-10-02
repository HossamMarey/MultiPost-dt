// One persistent Chromium session per account: cookies, storage, cache and proxy never leak between accounts.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { net, type Session, app, protocol, session } from "electron";
import type { Account, LocalFile } from "../shared/types";

export const FILE_SCHEME = "multipost-file";

// Must run before app "ready".
export function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: FILE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        bypassCSP: true,
        stream: true,
      },
    },
  ]);
}

/**
 * A user agent indistinguishable from desktop Chrome: no "Electron/x" or app tokens, and the reduced
 * "Chrome/<major>.0.0.0" form real Chrome sends. Sites treat anything else as a bot or embedded browser.
 */
export function cleanUserAgent(ua: string): string {
  return ua
    .replace(/\s?Electron\/[\d.]+/i, "")
    .replace(new RegExp(`\\s?${app.getName().replace(/[^\w-]/g, ".")}\\/[\\d.]+`, "i"), "")
    .replace(/\s?multipost-desktop\/[\d.]+/i, "")
    .replace(/Chrome\/(\d+)\.[\d.]+/, "Chrome/$1.0.0.0")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const CHROME_MAJOR = process.versions.chrome.split(".")[0];
// What Chrome itself sends (Electron omits the "Google Chrome" brand, which some sites check).
const SEC_CH_UA = `"Google Chrome";v="${CHROME_MAJOR}", "Chromium";v="${CHROME_MAJOR}", "Not.A/Brand";v="99"`;
const SEC_CH_UA_FULL = `"Google Chrome";v="${process.versions.chrome}", "Chromium";v="${process.versions.chrome}", "Not.A/Brand";v="99.0.0.0"`;

function acceptLanguages(): string {
  const langs = app.getPreferredSystemLanguages?.() ?? [];
  const list = [...new Set([...langs, "en-US", "en"])];
  return list.join(",");
}

// Permissions a publishing page legitimately needs. Everything else (notifications, location,
// camera, opening other apps…) is denied so pages in hidden windows can't prompt or misbehave.
const ALLOWED_PERMISSIONS = new Set(["clipboard-read", "clipboard-sanitized-write", "fullscreen", "pointerLock"]);

// ---- Local files served to publishing pages --------------------------------------------------

interface ServedFile {
  path: string;
  type: string;
}
const servedFiles = new Map<string, ServedFile>();

export function serveFile(file: LocalFile): {
  token: string;
  data: { name: string; url: string; type: string; size: number };
} {
  const token = crypto.randomBytes(16).toString("hex");
  servedFiles.set(token, { path: file.path, type: file.type || "application/octet-stream" });
  return {
    token,
    data: {
      name: file.name,
      url: `${FILE_SCHEME}://file/${token}/${encodeURIComponent(file.name)}`,
      type: file.type,
      size: file.size,
    },
  };
}

export function revokeFiles(tokens: string[]) {
  for (const t of tokens) servedFiles.delete(t);
}

async function handleFileRequest(request: Request): Promise<Response> {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const url = new URL(request.url);
  const token = url.pathname.split("/")[1];
  const served = servedFiles.get(token);
  if (!served || !fs.existsSync(served.path)) {
    return new Response("Not found", { status: 404, headers: corsHeaders });
  }
  const upstream = await net.fetch(pathToFileURL(served.path).toString());
  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", served.type);
  headers.set("Content-Length", String(fs.statSync(served.path).size));
  return new Response(upstream.body, { status: 200, headers });
}

// ---- Sessions ---------------------------------------------------------------------------------

interface SessionConfig {
  proxy: string;
  userAgent: string;
}
// partition -> promise of the config being applied, so concurrent jobs share one setup.
const configured = new Map<string, { config: SessionConfig; ready: Promise<Session> }>();
const initialized = new Set<string>();
const proxyCredentials = new Map<Session, { username: string; password: string }>();

export function getProxyCredentials(ses: Session) {
  return proxyCredentials.get(ses);
}

/** Credentials to use when Chromium can't tell which session asked (e.g. service workers). */
export function getOnlyProxyCredentials() {
  const unique = new Map([...proxyCredentials.values()].map((c) => [`${c.username}\0${c.password}`, c]));
  return unique.size === 1 ? [...unique.values()][0] : undefined;
}

export function parseProxy(proxy: string): { rules: string; username?: string; password?: string } {
  const trimmed = proxy.trim();
  const withScheme = /^[a-z0-9]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const u = new URL(withScheme);
  const scheme = u.protocol.replace(":", "").toLowerCase();
  if (!["http", "https", "socks4", "socks5"].includes(scheme)) throw new Error(`Unsupported proxy type "${scheme}"`);
  if (!u.hostname) throw new Error("Proxy host is missing");
  if (scheme.startsWith("socks") && u.username) {
    throw new Error(
      "Chromium can't sign in to SOCKS proxies with a username/password. Use an HTTP proxy for authenticated proxies.",
    );
  }
  return {
    rules: `${scheme}://${u.hostname}${u.port ? `:${u.port}` : ""}`,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
  };
}

/** Throws a user-facing error if the proxy string can't be used. */
export function validateProxy(proxy: string | undefined) {
  if (proxy?.trim()) parseProxy(proxy);
}

// Hidden sign-in check windows run with webSecurity off (the extension's account getters were written for an
// extension background page). No page script may run there: the site's own and third-party scripts would
// otherwise get credentialed cross-origin access to the account's session.
const scriptlessWebContents = new Set<number>();

export function markScriptless(webContentsId: number) {
  scriptlessWebContents.add(webContentsId);
  return () => scriptlessWebContents.delete(webContentsId);
}

function initSession(ses: Session) {
  if (!ses.protocol.isProtocolHandled(FILE_SCHEME)) ses.protocol.handle(FILE_SCHEME, handleFileRequest);
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission === "openExternal") {
      callback(/^mailto:/i.test((details as { externalURL?: string }).externalURL ?? ""));
      return;
    }
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders;
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();
      if (lower === "sec-ch-ua") headers[key] = SEC_CH_UA;
      else if (lower === "sec-ch-ua-full-version-list") headers[key] = SEC_CH_UA_FULL;
    }
    callback({ requestHeaders: headers });
  });
  ses.webRequest.onHeadersReceived((details, callback) => {
    if (details.webContentsId === undefined || !scriptlessWebContents.has(details.webContentsId)) {
      callback({});
      return;
    }
    if (details.resourceType === "mainFrame" || details.resourceType === "subFrame") {
      const headers = { ...(details.responseHeaders ?? {}) };
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase().startsWith("content-security-policy")) delete headers[key];
      }
      // Scripts injected by the app itself (executeJavaScript) are not affected by the page CSP.
      headers["Content-Security-Policy"] = [
        "script-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'",
      ];
      callback({ responseHeaders: headers });
      return;
    }
    callback({});
  });
}

async function applyConfig(ses: Session, partition: string, config: SessionConfig, previous?: SessionConfig) {
  if (!initialized.has(partition)) {
    initSession(ses);
    initialized.add(partition);
  }
  ses.setUserAgent(config.userAgent || cleanUserAgent(ses.getUserAgent()), acceptLanguages());
  if (config.proxy) {
    const parsed = parseProxy(config.proxy);
    await ses.setProxy({ proxyRules: parsed.rules, proxyBypassRules: "<local>" });
    if (parsed.username) proxyCredentials.set(ses, { username: parsed.username, password: parsed.password ?? "" });
    else proxyCredentials.delete(ses);
  } else {
    await ses.setProxy({ mode: "system" });
    proxyCredentials.delete(ses);
  }
  // Only when the proxy really changed: dropping connections aborts in-flight loads and uploads.
  if (previous && previous.proxy !== config.proxy) await ses.closeAllConnections();
  return ses;
}

export function sessionForAccount(account: Account): Promise<Session> {
  const ses = session.fromPartition(account.partition);
  const config: SessionConfig = { proxy: account.proxy?.trim() ?? "", userAgent: account.userAgent?.trim() ?? "" };
  const current = configured.get(account.partition);
  if (current && current.config.proxy === config.proxy && current.config.userAgent === config.userAgent) {
    return current.ready;
  }
  // Chain after any in-flight setup so two configs never interleave.
  const ready = (current?.ready.catch(() => ses) ?? Promise.resolve(ses)).then(() =>
    applyConfig(ses, account.partition, config, current?.config),
  );
  configured.set(account.partition, { config, ready });
  ready.catch(() => configured.delete(account.partition));
  return ready;
}

export async function clearAccountSession(account: Account) {
  const ses = session.fromPartition(account.partition);
  await ses.clearStorageData();
  await ses.clearCache();
}

export function partitionFor(accountId: string) {
  return `persist:acc-${accountId}`;
}

export function isSafeAccountId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(id);
}

/** Folder of an account's partition, only if it is a well-formed account partition inside userData. */
export function partitionDir(partition: string): string | null {
  const name = partition.replace(/^persist:/, "");
  if (!/^acc-[A-Za-z0-9-]{1,64}$/.test(name)) return null;
  const root = path.join(app.getPath("userData"), "Partitions");
  const dir = path.join(root, encodeURIComponent(name));
  return path.dirname(dir) === root ? dir : null;
}

/** Remove partition folders of deleted accounts. On Windows they are locked while loaded, so retry at startup. */
export function removePartitionDirs(partitions: string[]): string[] {
  const remaining: string[] = [];
  for (const partition of partitions) {
    const dir = partitionDir(partition);
    if (!dir) continue;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      remaining.push(partition);
    }
  }
  return remaining;
}
