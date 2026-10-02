// How to recognize, from the platform's own network traffic, that a post was really created.
// Each rule matches the request the platform's web app sends when you press "publish", checks the
// platform's answer (HTTP status and, when known, its JSON "ok" field) and, when possible, builds a
// link to the live post. Unknown platforms fall back to a generic heuristic (reported as "likely").

export interface VerifyContext {
  username?: string; // from the account check, used to build some links
}

export interface VerifyRule {
  url: RegExp;
  method?: string; // default POST
  postData?: RegExp; // for GraphQL-style endpoints that share one URL
  /** Platform-level success inside a 2xx answer (many Chinese APIs answer 200 with an error code). */
  ok?: (body: any) => boolean;
  /** Human-readable reason when ok() is false. */
  error?: (body: any) => string | undefined;
  link?: (body: any, ctx: VerifyContext) => string | undefined;
  /** An intermediate step (e.g. upload created): proves progress and may yield the link, not the publish. */
  partial?: boolean;
}

const okCode0 = (b: any) => b == null || b.code === undefined || b.code === 0 || b.code === "0";
const errMsg = (b: any) => b?.message || b?.msg || b?.error_msg || b?.status_msg || b?.errmsg || undefined;
const dig = (obj: any, path: string): any => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const firstString = (obj: any, paths: string[]) => {
  for (const p of paths) {
    const v = dig(obj, p);
    if (typeof v === "string" || typeof v === "number") return String(v);
  }
  return undefined;
};

/** Rules per site (accountKey). */
export const VERIFY_RULES: Record<string, VerifyRule[]> = {
  x: [
    {
      url: /\/i\/api\/graphql\/[^/]+\/Create(Tweet|NoteTweet)\b/,
      ok: (b) => !b?.errors?.length,
      error: (b) => b?.errors?.[0]?.message,
      link: (b) => {
        const id = firstString(b, [
          "data.create_tweet.tweet_results.result.rest_id",
          "data.notetweet_create.tweet_results.result.rest_id",
        ]);
        return id ? `https://x.com/i/web/status/${id}` : undefined;
      },
    },
  ],
  bluesky: [
    {
      url: /\/xrpc\/com\.atproto\.repo\.(createRecord|applyWrites)\b/,
      link: (b) => {
        const uri: string | undefined =
          b?.uri ?? b?.results?.find((r: any) => /app\.bsky\.feed\.post/.test(r?.uri))?.uri;
        const m = uri?.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/);
        return m ? `https://bsky.app/profile/${m[1]}/post/${m[2]}` : undefined;
      },
    },
  ],
  youtube: [
    {
      // Studio creates the video as soon as the upload starts…
      url: /\/youtubei\/v1\/upload\/createvideo\b/,
      partial: true,
      ok: (b) => !b?.error,
      error: (b) => b?.error?.message,
      link: (b) => {
        const id = firstString(b, ["videoId"]);
        return id ? `https://youtu.be/${id}` : undefined;
      },
    },
    {
      // …and saves details/visibility when you press Publish/Save.
      url: /\/youtubei\/v1\/video_manager\/metadata_update\b/,
      ok: (b) => !b?.error && !(b?.overallResult?.resultCode && b.overallResult.resultCode !== "UPDATE_SUCCESS"),
      error: (b) => b?.error?.message ?? b?.overallResult?.resultCode,
    },
  ],
  tiktok: [
    {
      url: /\/(tiktok\/web\/project\/post|api\/v1\/web\/project\/post|tiktok\/v1\/videos\/post|web\/project\/post)\b/,
      ok: (b) => b == null || b.status_code === undefined || b.status_code === 0,
      error: (b) => b?.status_msg,
      link: (b, ctx) => {
        const id = firstString(b, ["single_post_resp_list.0.item_id", "item_id", "data.item_id"]);
        return id && ctx.username ? `https://www.tiktok.com/@${ctx.username.replace(/^@/, "")}/video/${id}` : undefined;
      },
    },
  ],
  douyin: [
    {
      url: /\/(web\/api\/media\/aweme\/create(_v2)?|janus\/douyin\/creator\/pc\/work\/publish|aweme\/v1\/creator\/item\/create)\b/,
      ok: (b) => b == null || b.status_code === undefined || b.status_code === 0,
      error: (b) => b?.status_msg,
      link: (b) => {
        const id = firstString(b, ["aweme_id", "item_id", "data.aweme_id"]);
        return id ? `https://www.douyin.com/video/${id}` : undefined;
      },
    },
  ],
  bilibili: [
    {
      url: /\/x\/vu\/web\/add(\/v3)?\b/,
      ok: okCode0,
      error: errMsg,
      link: (b) => {
        const bvid = firstString(b, ["data.bvid"]);
        return bvid ? `https://www.bilibili.com/video/${bvid}` : undefined;
      },
    },
    {
      url: /\/(x\/dynamic\/feed\/create\/(dyn|opus)|dynamic_svr\/v1\/dynamic_svr\/create)\b/,
      ok: okCode0,
      error: errMsg,
      link: (b) => {
        const id = firstString(b, ["data.dyn_id_str", "data.dynamic_id_str", "data.dyn_id"]);
        return id ? `https://t.bilibili.com/${id}` : undefined;
      },
    },
    {
      url: /\/x\/article\/creative\/article\/submit\b/,
      ok: okCode0,
      error: errMsg,
      link: (b) => {
        const aid = firstString(b, ["data.aid"]);
        return aid ? `https://www.bilibili.com/read/cv${aid}` : undefined;
      },
    },
  ],
  weibo: [
    {
      url: /\/(ajax\/statuses\/update|aj\/mblog\/add|ajax\/statuses\/repost)\b/,
      ok: (b) => b == null || b.ok === undefined || b.ok === 1 || b.ok === true,
      error: (b) => b?.msg || b?.message,
      link: (b) => {
        const idstr = firstString(b, ["data.idstr", "data.id"]);
        return idstr ? `https://m.weibo.cn/detail/${idstr}` : undefined;
      },
    },
  ],
  rednote: [
    {
      url: /\/web_api\/sns\/v\d\/note\b/,
      ok: (b) => b == null || b.success === undefined || b.success === true,
      error: (b) => b?.msg,
      link: (b) => {
        const id = firstString(b, ["data.id", "data.note_id"]);
        return id ? `https://www.xiaohongshu.com/explore/${id}` : undefined;
      },
    },
  ],
  instagram: [
    {
      url: /\/api\/v1\/media\/configure(_sidecar|_to_clips)?\/?(\?|$)/,
      ok: (b) => b == null || b.status === undefined || b.status === "ok",
      error: (b) => b?.message,
      link: (b) => {
        const code = firstString(b, ["media.code"]);
        return code ? `https://www.instagram.com/p/${code}/` : undefined;
      },
    },
  ],
  threads: [
    {
      url: /\/api\/v1\/media\/configure_(text_only_post|text_post_app_feed|sidecar)\/?(\?|$)/,
      ok: (b) => b == null || b.status === undefined || b.status === "ok",
      error: (b) => b?.message,
      link: (b, ctx) => {
        const code = firstString(b, ["media.code"]);
        return code ? `https://www.threads.net/@${(ctx.username ?? "_").replace(/^@/, "")}/post/${code}` : undefined;
      },
    },
  ],
  facebook: [
    {
      url: /\/api\/graphql\/?(\?|$)/,
      postData: /ComposerStoryCreateMutation|useCometFeedComposerPublish/,
      ok: (b) => !b?.errors?.length,
      error: (b) => b?.errors?.[0]?.message,
    },
  ],
  linkedin: [
    {
      url: /\/voyager\/api\/(contentcreation\/normShares|graphql\?[^ ]*createContentcreation|voyagerContentcreationDashShares)/,
      link: (b) => {
        const urn = firstString(b, ["value.urn", "data.value.urn", "urn"]);
        return urn?.startsWith("urn:li:") ? `https://www.linkedin.com/feed/update/${urn}/` : undefined;
      },
    },
  ],
  reddit: [
    { url: /\/(api\/submit|svc\/shreddit\/graphql|svc\/shreddit\/post-submit)\b/, postData: /submit|CreatePost|post/i },
  ],
  kuaishou: [
    {
      url: /\/rest\/cp\/works\/v\d\/video\/pc\/submit\b|\/rest\/cp\/works\/.*\/submit\b/,
      ok: (b) => b == null || b.result === undefined || b.result === 1,
      error: errMsg,
    },
  ],
  zhihu: [{ url: /\/api\/v4\/(content\/publish|pins)\b|\/api\/articles\/\d+\/publish\b/ }],
  weixinchannel: [
    {
      url: /\/mmfinderassistant-bin\/post\/post_create\b/,
      ok: (b) => b == null || b.errCode === undefined || b.errCode === 0,
      error: (b) => b?.errMsg,
    },
  ],
};

/** Generic heuristic for platforms without a rule: a successful write request to the platform's own site. */
export const GENERIC_PUBLISH_URL = /(publish|create|submit|post|add|save|release|upload_done|complete)/i;
