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

// Make navigator.userAgentData agree with the user agent and the Sec-CH-UA headers (see sessions.ts):
// real Chrome reports a "Google Chrome" brand, Electron does not.
const CHROME_FULL = process.versions.chrome;
const CHROME_MAJOR = CHROME_FULL.split(".")[0];
const uaDataPatch = `(() => {
  const proto = globalThis.NavigatorUAData && NavigatorUAData.prototype;
  if (!proto) return;
  const brands = Object.freeze([
    Object.freeze({ brand: "Google Chrome", version: "${CHROME_MAJOR}" }),
    Object.freeze({ brand: "Chromium", version: "${CHROME_MAJOR}" }),
    Object.freeze({ brand: "Not.A/Brand", version: "99" }),
  ]);
  const fullVersionList = [
    { brand: "Google Chrome", version: "${CHROME_FULL}" },
    { brand: "Chromium", version: "${CHROME_FULL}" },
    { brand: "Not.A/Brand", version: "99.0.0.0" },
  ];
  const brandsGetter = Object.getOwnPropertyDescriptor(proto, "brands");
  if (brandsGetter && brandsGetter.configurable) {
    const desc = Object.getOwnPropertyDescriptor({ get brands() { return brands; } }, "brands");
    Object.defineProperty(proto, "brands", { get: desc.get, enumerable: brandsGetter.enumerable, configurable: true });
  }
  const original = proto.getHighEntropyValues;
  if (typeof original === "function") {
    const patched = {
      getHighEntropyValues(hints) {
        return original.call(this, hints).then((values) => {
          const out = { ...values, brands: brands.map((b) => ({ ...b })) };
          if ("fullVersionList" in values) out.fullVersionList = fullVersionList.map((b) => ({ ...b }));
          return out;
        });
      },
    }.getHighEntropyValues;
    Object.defineProperty(proto, "getHighEntropyValues", { value: patched, writable: true, configurable: true });
  }
})();`;
webFrame.executeJavaScript(uaDataPatch).catch(() => {});

if (HELPER_MATCHES.some((re) => re.test(location.href))) {
  webFrame.executeJavaScript(__HELPER_CODE__).catch((error) => console.error("[MultiPost] helper failed", error));
}
