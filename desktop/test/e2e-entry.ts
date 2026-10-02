// Test build of the main process: the real app plus a fake platform served from localhost.
import "../src/main/index";
import { createAccountWindow } from "../src/main/browser-windows";
import { infoMap } from "../src/main/platforms";
import { preflight } from "../src/main/preflight";
import { cancelJob, retryJob, startPublish } from "../src/main/publisher";
import { markScriptless } from "../src/main/sessions";
import { flush, getState, publicState, update } from "../src/main/store";

// Self-contained like every real inject function.
async function e2eInject(data: {
  data: { content: string; images: { url: string; name: string }[] };
  isAutoPublish: boolean;
}) {
  const box = document.querySelector("#editor") as HTMLTextAreaElement;
  box.value = data.data.content;
  const blobs = await Promise.all(data.data.images.map(async (img) => (await fetch(img.url)).blob()));
  const sizes = blobs.map((b) => b.size).join(",");
  // Proves we ran isolated from the page: the page replaced window.fetch with a function that throws.
  document.body.setAttribute("data-result", `ok:${sizes}:${navigator.userAgent}`);
  if (data.isAutoPublish) (document.querySelector("#submit") as HTMLButtonElement).click();
}

infoMap.DYNAMIC_E2E = {
  type: "DYNAMIC",
  name: "DYNAMIC_E2E",
  homeUrl: process.env.E2E_URL ?? "http://127.0.0.1:1/",
  platformName: "E2E",
  injectUrl: process.env.E2E_URL ?? "http://127.0.0.1:1/",
  injectFunction: e2eInject as never,
  accountKey: "x", // reuse an existing site so accounts can target it
  tags: [],
};

// Never resolves: used to test crash handling and the window cap.
async function e2eHang() {
  document.body.setAttribute("data-result", "hanging");
  await new Promise(() => {});
}

const base = process.env.E2E_URL ?? "http://127.0.0.1:1/compose";
for (const [name, injectUrl, fn] of [
  ["DYNAMIC_E2E_LOGIN", base.replace("/compose", "/needs-login"), e2eInject],
  ["DYNAMIC_E2E_HANG", base, e2eHang],
  ["DYNAMIC_E2E_REJECT", base.replace("/compose", "/compose-reject"), e2eInject],
  // Nothing listens there: the page load fails with a network error (retry path).
  ["DYNAMIC_E2E_DOWN", process.env.E2E_DOWN_URL ?? "http://127.0.0.1:1/compose", e2eInject],
] as const) {
  infoMap[name] = { ...infoMap.DYNAMIC_E2E, name, injectUrl, injectFunction: fn as never, platformName: name };
}

(globalThis as Record<string, unknown>).__mp = {
  startPublish,
  getState,
  update,
  retryJob,
  cancelJob,
  flush,
  createAccountWindow,
  markScriptless,
  preflight,
  publicState,
};
