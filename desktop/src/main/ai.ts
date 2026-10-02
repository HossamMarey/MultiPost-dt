// Optional "Rewrite with AI": adapts a post to one platform's style and limits with Claude.
// Runs only when the user clicks the button and has saved their own Anthropic API key. Only the post's
// title, text and tags are sent — never account names, cookies or files.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { net } from "electron";
import { z } from "zod";
import { charCount, describeRules, rulesFor } from "../shared/platform-rules";
import type { ContentType } from "../shared/types";
import { getPlatformInfo } from "./platforms";
import { getState } from "./store";

const MODEL = "claude-opus-5-5";

const RewriteSchema = z.object({
  title: z.string().describe("Post title; empty string if the platform has no separate title"),
  content: z.string().describe("Post text / caption / description, without the hashtags"),
  tags: z.array(z.string()).describe("Hashtags or tags without the # sign"),
});

export type Rewrite = z.infer<typeof RewriteSchema>;

export interface RewriteInput {
  platform: string;
  type: ContentType;
  title: string;
  content: string;
  tags: string[];
  instructions?: string;
}

const SYSTEM = `You adapt social media posts for a specific platform.
Keep the author's meaning, facts, links, mentions and language (reply in the same language as the post; keep mixed-language posts mixed).
Match the platform's culture and format: tone, length, line breaks, emoji use and hashtag conventions that perform well there.
Stay strictly within the platform limits you are given — count characters carefully; when in doubt, be shorter.
Do not invent facts, prices, dates, offers or claims that are not in the original.`;

function client(): Anthropic {
  const apiKey = getState().settings.aiApiKey;
  if (!apiKey) throw new Error("Add your Anthropic API key in Settings to use AI rewrite.");
  // Electron's network stack honours the system proxy configuration.
  return new Anthropic({ apiKey, fetch: net.fetch as unknown as typeof fetch, maxRetries: 2 });
}

export async function rewriteForPlatform(input: RewriteInput): Promise<Rewrite> {
  const info = getPlatformInfo(input.platform);
  const platformLabel = info?.platformName ?? input.platform;
  const rules = rulesFor(input.platform, input.type);
  const prompt = [
    `Platform: ${platformLabel} (${input.type.toLowerCase()} post)`,
    `Limits: ${describeRules(input.platform, input.type)}.`,
    rules.tagsInText ? "Tags will be appended to the text as #hashtags." : "Tags are entered in a separate tags field.",
    input.instructions?.trim() ? `Extra instructions from the author: ${input.instructions.trim()}` : "",
    "",
    "Original post:",
    `<title>${input.title}</title>`,
    `<text>${input.content}</text>`,
    `<tags>${input.tags.join(", ")}</tags>`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  const response = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    // Opt-in server-side fallback: if a safeguard declines, the API retries on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(RewriteSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") throw new Error("The AI declined to rewrite this post.");
  if (response.stop_reason === "max_tokens") throw new Error("The AI response was cut off. Try a shorter post.");
  const out = response.parsed_output;
  if (!out) throw new Error("The AI returned an unexpected answer. Try again.");

  // Enforce hard limits locally as a last guard.
  const result: Rewrite = { ...out, tags: out.tags.map((t) => t.replace(/^#+/, "").trim()).filter(Boolean) };
  if (rules.titleMax && charCount(result.title) > rules.titleMax) {
    result.title = [...result.title].slice(0, rules.titleMax).join("");
  }
  if (rules.tagsMax && result.tags.length > rules.tagsMax) result.tags = result.tags.slice(0, rules.tagsMax);
  return result;
}

export function describeAiError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError)
    return "The Anthropic API key was rejected. Check it in Settings.";
  if (error instanceof Anthropic.RateLimitError) return "The AI is rate limited right now. Try again in a minute.";
  if (error instanceof Anthropic.APIConnectionError) return "Could not reach the AI service. Check your connection.";
  if (error instanceof Anthropic.APIError) return `AI error ${error.status ?? ""}: ${error.message}`;
  return (error as Error)?.message ?? String(error);
}
