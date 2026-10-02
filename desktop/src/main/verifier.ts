// Watches one publish window's network traffic and reports what the platform itself answered.
import type { WebContents } from "electron";
import type { PublishJob } from "../shared/types";
import { type ObservedResponse, instrument } from "./cdp";
import { GENERIC_PUBLISH_URL, VERIFY_RULES, type VerifyContext } from "./verify-rules";

const TELEMETRY =
  /(log|track|report|monitor|collect|stat|beacon|metric|analytic|sentry|trace|perf|heartbeat|ping|event|captcha|verify|passport|login|sso|oauth|draft)/i;

export type VerificationUpdate = Pick<PublishJob, "verification" | "verificationNote" | "postUrl">;

/** "creator.douyin.com" → "douyin.com" (same helper as the publisher's, kept local to avoid a cycle). */
function siteOf(url: string): string {
  try {
    const parts = new URL(url).hostname.split(".");
    const take = parts.length > 2 && /^(com|net|org|gov|edu|co)$/.test(parts[parts.length - 2]) ? 3 : 2;
    return parts.slice(-take).join(".");
  } catch {
    return "";
  }
}

function parseJson(text: string | undefined): any {
  if (!text) return undefined;
  // Some APIs prefix JSON with an anti-hijacking guard like ")]}'".
  const cleaned = text.replace(/^\)\]\}'?\s*/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return undefined;
  }
}

export function watchPublish(
  wc: WebContents,
  opts: { siteKey: string; publishUrl: string; context: VerifyContext; onUpdate: (u: VerificationUpdate) => void },
): () => void {
  const { network } = instrument(wc, {});
  const rules = VERIFY_RULES[opts.siteKey] ?? [];
  const site = siteOf(opts.publishUrl);
  let state: PublishJob["verification"] = "pending";
  let link: string | undefined;

  const update = (next: VerificationUpdate) => {
    if (state === "published" && next.verification !== "published") return; // never downgrade a confirmed post
    state = next.verification;
    opts.onUpdate({ ...next, postUrl: next.postUrl ?? link });
  };

  const onResponse = async (r: ObservedResponse) => {
    const rule = rules.find(
      (x) =>
        x.url.test(r.url) && r.method === (x.method ?? "POST") && (!x.postData || x.postData.test(r.postData ?? "")),
    );
    if (rule) {
      if (r.status >= 400) {
        update({ verification: "rejected", verificationNote: `The platform answered HTTP ${r.status}` });
        return;
      }
      const body = parseJson(await r.body());
      if (rule.ok && body !== undefined && !rule.ok(body)) {
        update({ verification: "rejected", verificationNote: rule.error?.(body) || "The platform rejected the post" });
        return;
      }
      const found = body !== undefined ? rule.link?.(body, opts.context) : undefined;
      if (found) link = found;
      if (rule.partial) {
        if (state === "pending" || state === "unconfirmed") update({ verification: "likely", postUrl: link });
      } else {
        update({ verification: "published", postUrl: link });
      }
      return;
    }
    // No known rule for this request: a successful JSON write to the platform's own site is a strong hint.
    if (
      rules.length === 0 &&
      (state === "pending" || state === "unconfirmed") &&
      r.status >= 200 &&
      r.status < 300 &&
      /json/i.test(r.mimeType) &&
      siteOf(r.url) === site &&
      GENERIC_PUBLISH_URL.test(new URL(r.url).pathname) &&
      !TELEMETRY.test(new URL(r.url).pathname)
    ) {
      update({ verification: "likely" });
    }
  };

  network.on("response", onResponse);
  return () => network.removeListener("response", onResponse);
}
