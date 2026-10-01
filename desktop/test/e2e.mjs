// End-to-end check of the publishing pipeline against a local page with a strict CSP.
// Run: node test/build-e2e.mjs && node test/e2e.mjs   (needs a display; use xvfb-run on Linux)
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const shotsDir = process.env.SHOTS_DIR;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "multipost-e2e-"));
const imagePath = path.join(tmp, "photo one.png");
fs.copyFileSync(path.join(here, "../build/icon.png"), imagePath);
const imageSize = fs.statSync(imagePath).size;

let submitted = 0;
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/done")) {
    submitted++;
    res.end("<title>done</title>published");
    return;
  }
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'");
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html><title>compose</title>
<script>window.fetch = () => { throw new Error("page fetch hijacked"); };</script>
<form action="/done" method="get"><textarea id="editor"></textarea><button id="submit" type="submit">Post</button></form>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/compose`;

const app = await electron.launch({
  executablePath: require(path.join(here, "../node_modules/electron")),
  args: [path.join(here, "../dist/e2e-main.js"), "--no-sandbox"],
  env: { ...process.env, MULTIPOST_USER_DATA: path.join(tmp, "userdata"), E2E_URL: url },
});
const failures = [];
const check = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) failures.push(msg);
};

try {
  const win = await app.firstWindow();
  await win.waitForSelector("text=Add your first account", { timeout: 20000 });
  check(true, "UI loads with empty state");

  // Two accounts on the same site, each with its own partition.
  const ids = await app.evaluate(() => {
    const mp = globalThis.__mp;
    const mk = (label) => {
      const id = `acc-${label}`;
      mp.update((s) => s.accounts.push({ id, accountKey: "x", label, partition: `persist:acc-${id}`, status: "unknown", createdAt: Date.now() }));
      return id;
    };
    return [mk("Brand A"), mk("Brand B")];
  });

  const isolation = await app.evaluate(async ({ session }, ids) => {
    const a = session.fromPartition(`persist:acc-${ids[0]}`);
    const b = session.fromPartition(`persist:acc-${ids[1]}`);
    await a.cookies.set({ url: "https://x.com", name: "auth_token", value: "A" });
    return { a: (await a.cookies.get({ name: "auth_token" })).length, b: (await b.cookies.get({ name: "auth_token" })).length };
  }, ids);
  check(isolation.a === 1 && isolation.b === 0, "cookies are isolated between accounts on the same site");

  await app.evaluate(({}, { ids, imagePath, imageSize }) => {
    globalThis.__mp.startPublish({
      autoPublish: true,
      targets: ids.map((accountId) => ({ accountId, platform: "DYNAMIC_E2E" })),
      draft: {
        contentType: "DYNAMIC",
        title: "",
        content: "Hello from the e2e test",
        digest: "",
        htmlContent: "",
        markdownContent: "",
        tags: [],
        images: [{ path: imagePath, name: "photo one.png", size: imageSize, type: "image/png" }],
        videos: [],
      },
    });
  }, { ids, imagePath, imageSize });

  let jobs = [];
  for (let i = 0; i < 60; i++) {
    jobs = await app.evaluate(() => globalThis.__mp.getState().jobs.map((j) => ({ status: j.status, error: j.error })));
    if (jobs.length && jobs.every((j) => j.status === "done" || j.status === "failed")) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  check(jobs.length === 2 && jobs.every((j) => j.status === "done"), `both jobs finish (${JSON.stringify(jobs)})`);
  await new Promise((r) => setTimeout(r, 1000));
  check(submitted === 2, `auto-submit clicked the publish button on both pages (submitted=${submitted})`);

  // Run once more without auto-submit to inspect the filled page.
  await app.evaluate(({}, { ids, imagePath, imageSize }) => {
    globalThis.__mp.startPublish({
      autoPublish: false,
      targets: [{ accountId: ids[0], platform: "DYNAMIC_E2E" }],
      draft: {
        contentType: "DYNAMIC", title: "", content: "Second run", digest: "", htmlContent: "", markdownContent: "", tags: [],
        images: [{ path: imagePath, name: "photo one.png", size: imageSize, type: "image/png" }], videos: [],
      },
    });
  }, { ids, imagePath, imageSize });
  let result = null;
  for (let i = 0; i < 40 && !result; i++) {
    await new Promise((r) => setTimeout(r, 500));
    result = await app.evaluate(async ({ BrowserWindow }, url) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.webContents.getURL() === url) {
          const r = await w.webContents.executeJavaScript(`[document.body.getAttribute("data-result"), document.querySelector("#editor").value]`);
          if (r[0]) return r;
        }
      }
      return null;
    }, url);
  }
  check(!!result, "publish window found with result");
  if (result) {
    const [res, editor] = result;
    check(res.startsWith(`ok:${imageSize}:`), `local file fetched through CSP from isolated world (${res.slice(0, 20)})`);
    check(!/Electron|multipost/i.test(res), `user agent looks like Chrome (${res.split(":").slice(2).join(":")})`);
    check(editor === "Second run", "editor filled");
  }

  if (shotsDir) {
    fs.mkdirSync(shotsDir, { recursive: true });
    await win.setViewportSize?.({ width: 1360, height: 880 });
    await win.screenshot({ path: path.join(shotsDir, "activity-or-current.png") });
  }
} catch (error) {
  failures.push(String(error));
  console.error(error);
} finally {
  await app.close().catch(() => {});
  server.close();
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nAll e2e checks passed");
