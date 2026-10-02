// Chrome DevTools Protocol instrumentation of account windows (attached by the app, invisible to pages):
// - per-account timezone/locale so pages see the same location as the account's proxy
// - network observation so the publisher can confirm what the platform answered
import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import type { Account } from "../shared/types";

export interface ObservedResponse {
  url: string;
  method: string;
  status: number;
  mimeType: string;
  postData?: string;
  timestamp: number;
  /** Response body as text (only fetched on demand). */
  body: () => Promise<string | undefined>;
}

export interface Instrumented {
  network: EventEmitter; // "response" → ObservedResponse
}

const instrumented = new WeakMap<WebContents, Instrumented>();

/** Locale like "en-US" → language list for Accept-Language (Chromium adds the q-weights itself). */
export function acceptLanguageFor(locale: string | undefined): string | undefined {
  if (!locale?.trim()) return undefined;
  const tag = locale.trim();
  const lang = tag.split("-")[0];
  return [...new Set([tag, lang, "en"])].filter(Boolean).join(",");
}

export function instrument(wc: WebContents, account: Pick<Account, "timezone" | "locale">): Instrumented {
  const existing = instrumented.get(wc);
  if (existing) return existing;
  const network = new EventEmitter();
  network.setMaxListeners(20);
  const handle: Instrumented = { network };
  instrumented.set(wc, handle);

  const dbg = wc.debugger;
  try {
    if (!dbg.isAttached()) dbg.attach("1.3");
  } catch (error) {
    console.warn("[cdp] attach failed", (error as Error).message);
    return handle;
  }

  const send = (method: string, params?: Record<string, unknown>) =>
    dbg.sendCommand(method, params).catch((error: Error) => console.warn(`[cdp] ${method}:`, error.message));

  if (account.timezone?.trim()) send("Emulation.setTimezoneOverride", { timezoneId: account.timezone.trim() });
  if (account.locale?.trim()) send("Emulation.setLocaleOverride", { locale: account.locale.trim() });
  // Bounded buffers: only metadata is kept; bodies are fetched on demand for matching requests.
  send("Network.enable", { maxTotalBufferSize: 20_000_000, maxResourceBufferSize: 5_000_000 });

  const requests = new Map<string, { url: string; method: string; postData?: string }>();
  const responses = new Map<string, { status: number; mimeType: string }>();

  dbg.on("message", (_event, method, params) => {
    if (method === "Network.requestWillBeSent") {
      const r = params.request;
      if (r.method === "GET" || r.method === "OPTIONS" || r.method === "HEAD") return;
      requests.set(params.requestId, { url: r.url, method: r.method, postData: r.postData });
      if (requests.size > 500) requests.delete(requests.keys().next().value!);
    } else if (method === "Network.responseReceived") {
      if (!requests.has(params.requestId)) return;
      responses.set(params.requestId, { status: params.response.status, mimeType: params.response.mimeType ?? "" });
    } else if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
      const req = requests.get(params.requestId);
      const res = responses.get(params.requestId);
      requests.delete(params.requestId);
      responses.delete(params.requestId);
      if (!req || !res || method === "Network.loadingFailed") return;
      const requestId = params.requestId;
      const observed: ObservedResponse = {
        ...req,
        ...res,
        timestamp: Date.now(),
        body: async () => {
          try {
            const r = (await dbg.sendCommand("Network.getResponseBody", { requestId })) as {
              body: string;
              base64Encoded: boolean;
            };
            return r.base64Encoded ? Buffer.from(r.body, "base64").toString("utf8") : r.body;
          } catch {
            return undefined;
          }
        },
      };
      network.emit("response", observed);
    }
  });
  dbg.on("detach", () => {
    requests.clear();
    responses.clear();
  });
  return handle;
}
