// Watches one publish window's network traffic and reports what the platform itself answered.
// Principles: only a known publish request with a readable, successful answer is "published"; a known
// request with a definite client error is "rejected"; anything weaker is at most "likely".
import type { WebContents } from "electron";
import type { PublishJob } from "../shared/types";
import { type ObservedResponse, instrument } from "./cdp";
import { GENERIC_PUBLISH_URL, VERIFY_RULES, type VerifyContext } from "./verify-rules";

const TELEMETRY =
  /(log|track|report|monitor|collect|stat|beacon|metric|analytic|sentry|trace|perf|heartbeat|ping|event|captcha|verify|passport|login|sso|oauth|draft|autosave|save|upload|chunk|preupload|cover)/i;

export type VerificationUpdate = Pick<PublishJob, "verification" | "verificationNote" | "postUrl">;

/** "creator.douyin.com" → "douyin.com" (kept local to avoid an import cycle with the publisher). */
function siteOf(url: string): string {
  try {
    const parts = new URL(url).hostname.split(".");
    const take = parts.length > 2 && /^(com|net|org|gov|edu|co)$/.test(parts[parts.length - 2]) ? 3 : 2;
    return parts.slice(-take).join(".");
  } catch {
    return "";
  }
}

/** Parses JSON answers, including anti-hijacking prefixes and line-delimited (streamed) GraphQL. */
export function parseJson(text: string | undefined): any {
  if (!text) return undefined;
  const cleaned = text
    .replace(/^\)\]\}'?\s*/, "")
    .replace(/^for\s*\(;;\);\s*/, "")
    .replace(/^while\s*\(1\);\s*/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstLine = cleaned.split("\n")[0];
    try {
      return JSON.parse(firstLine);
    } catch {
      return undefined;
    }
  }
}

export interface PublishWatch {
  /** Call once the app has clicked publish (auto mode): enables the weaker generic heuristic. */
  arm: () => void;
  stop: () => void;
}

export function watchPublish(
  wc: WebContents,
  opts: { siteKey: string; publishUrl: string; context: VerifyContext; onUpdate: (u: VerificationUpdate) => void },
): PublishWatch {
  const { network } = instrument(wc, {});
  const rules = VERIFY_RULES[opts.siteKey] ?? [];
  const site = siteOf(opts.publishUrl);
  let state: PublishJob["verification"] = "pending";
  let link: string | undefined;
  let armed = false;

  const update = (next: VerificationUpdate) => {
    if (state === "published" && next.verification !== "published") return; // never downgrade a confirmed post
    if (state === next.verification && !next.postUrl) return;
    state = next.verification;
    opts.onUpdate({ ...next, postUrl: next.postUrl ?? link });
  };

  const onResponse = async (r: ObservedResponse) => {
    const rule = rules.find(
      (x) =>
        x.url.test(r.url) && r.method === (x.method ?? "POST") && (!x.postData || x.postData.test(r.postData ?? "")),
    );
    if (rule) {
      // Rate limits and server errors are often retried by the web app itself (or the post was created anyway):
      // not proof of anything.
      if (r.status === 429 || r.status >= 500) return;
      const body = parseJson(await r.body());
      if (r.status >= 400) {
        if (!rule.partial) {
          update({
            verification: "rejected",
            verificationNote: (body !== undefined && rule.error?.(body)) || `The platform answered HTTP ${r.status}`,
          });
        }
        return;
      }
      if (body !== undefined) {
        const found = rule.link?.(body, opts.context);
        if (found) link = found;
      }
      // Intermediate steps (e.g. YouTube's upload creation) only provide the link.
      if (rule.partial) return;
      if (rule.ok) {
        if (body === undefined) {
          // Couldn't read the answer: the request went through, but success isn't proven.
          update({ verification: "likely" });
          return;
        }
        if (!rule.ok(body)) {
          update({
            verification: "rejected",
            verificationNote: rule.error?.(body) || "The platform rejected the post",
          });
          return;
        }
      }
      update({ verification: "published", postUrl: link });
      return;
    }
    // Platforms without rules: after the app pressed publish, a successful JSON publish/create/submit
    // request to the platform's own site is a hint, never proof.
    if (
      armed &&
      rules.length === 0 &&
      state === "pending" &&
      r.status >= 200 &&
      r.status < 300 &&
      /json/i.test(r.mimeType) &&
      siteOf(r.url) === site &&
      GENERIC_PUBLISH_URL.test(new URL(r.url).pathname) &&
      !TELEMETRY.test(new URL(r.url).pathname)
    ) {
      const body = parseJson(await r.body());
      // Common "it failed" shapes in a 200 answer.
      if (
        body &&
        (body.success === false ||
          body.ok === 0 ||
          (typeof body.code === "number" && body.code !== 0 && body.code !== 200))
      ) {
        return;
      }
      update({ verification: "likely" });
    }
  };

  network.on("response", onResponse);
  return {
    arm: () => {
      armed = true;
    },
    stop: () => network.removeListener("response", onResponse),
  };
}
