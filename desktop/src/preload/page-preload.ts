// Preload for account windows (login + publishing). It exposes nothing to the page.
// It only replays what the extension's MAIN-world content script (src/contents/helper.ts) does:
// on the listed sites it installs upload shims before any page script runs.
import { webFrame } from "electron";

declare const __HELPER_CODE__: string;

// Same list as the `matches` of src/contents/helper.ts.
const HELPER_MATCHES = [
  /^https:\/\/t\.bilibili\.com\//,
  /^https:\/\/bsky\.app\//,
  /^https:\/\/(www\.)?v2ex\.com\/write/,
  /^https:\/\/www\.xiaoheihe\.cn\/creator\/editor\//,
  /^https:\/\/weibo\.com\/upload\/channel/,
  /^https:\/\/www\.jianpian\.cn\/p\/edit/,
];

if (HELPER_MATCHES.some((re) => re.test(location.href))) {
  webFrame.executeJavaScript(__HELPER_CODE__).catch((error) => console.error("[MultiPost] helper failed", error));
}
