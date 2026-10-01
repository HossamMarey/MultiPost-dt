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

/** A Chrome-like user agent: sites treat "Electron/x" or unknown app tokens as bots or embedded browsers. */
export function cleanUserAgent(ua: string): string {
  return ua
    .replace(/\s?Electron\/[\d.]+/i, "")
    .replace(new RegExp(`\\s?${app.getName().replace(/[^\w-]/g, ".")}\\/[\\d.]+`, "i"), "")
    .replace(/\s?multipost-desktop\/[\d.]+/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---- Local files served to publishing pages --------------------------------------------------

interface ServedFile {
  path: string;
  type: string;
}
const servedFiles = new Map<string, ServedFile>();

export function serveFile(file: LocalFile): { name: string; url: string; type: string; size: number } {
  const token = crypto.randomBytes(16).toString("hex");
  servedFiles.set(token, { path: file.path, type: file.type || "application/octet-stream" });
  return {
    name: file.name,
    url: `${FILE_SCHEME}://file/${token}/${encodeURIComponent(file.name)}`,
    type: file.type,
    size: file.size,
  };
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

const configured = new Map<string, string>(); // partition -> config fingerprint
const proxyCredentials = new Map<Session, { username: string; password: string }>();

export function getProxyCredentials(ses: Session) {
  return proxyCredentials.get(ses);
}

function parseProxy(proxy: string): { rules: string; username?: string; password?: string } {
  const trimmed = proxy.trim();
  const withScheme = /^[a-z0-9]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const u = new URL(withScheme);
  const scheme = u.protocol.replace(":", "");
  return {
    rules: `${scheme}://${u.hostname}${u.port ? `:${u.port}` : ""}`,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
  };
}

export async function sessionForAccount(account: Account): Promise<Session> {
  const ses = session.fromPartition(account.partition);
  const fingerprint = JSON.stringify([account.proxy ?? "", account.userAgent ?? ""]);
  if (configured.get(account.partition) === fingerprint) return ses;

  if (!configured.has(account.partition)) {
    if (!ses.protocol.isProtocolHandled(FILE_SCHEME)) ses.protocol.handle(FILE_SCHEME, handleFileRequest);
  }
  ses.setUserAgent(account.userAgent?.trim() || cleanUserAgent(ses.getUserAgent()));

  if (account.proxy?.trim()) {
    const parsed = parseProxy(account.proxy);
    await ses.setProxy({ proxyRules: parsed.rules, proxyBypassRules: "<local>" });
    if (parsed.username) proxyCredentials.set(ses, { username: parsed.username, password: parsed.password ?? "" });
    else proxyCredentials.delete(ses);
  } else {
    await ses.setProxy({ mode: "system" });
    proxyCredentials.delete(ses);
  }
  await ses.closeAllConnections();
  configured.set(account.partition, fingerprint);
  return ses;
}

export async function clearAccountSession(account: Account) {
  const ses = session.fromPartition(account.partition);
  await ses.clearStorageData();
  await ses.clearCache();
}

/** Remove the on-disk partition folder of a deleted account (best effort; Chromium may hold locks until restart). */
export function scheduleRemovePartitionDir(account: Account) {
  const name = account.partition.replace(/^persist:/, "");
  const dir = path.join(app.getPath("userData"), "Partitions", encodeURIComponent(name));
  setTimeout(() => {
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }, 2000);
}
