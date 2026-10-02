// End-to-end checks of the publishing pipeline against local pages (strict CSP, redirects, crashes).
// Run: npm run e2e   (needs a display; on Linux use xvfb-run -a npm run e2e)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const electronPath = require(path.join(here, "../node_modules/electron"));
const mainScript = path.join(here, "../dist/e2e-main.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "multipost-e2e-"));
const userData = path.join(tmp, "userdata");
const imagePath = path.join(tmp, "photo one.png");
fs.copyFileSync(path.join(here, "../build/icon.png"), imagePath);
const imageSize = fs.statSync(imagePath).size;

let submitted = 0;
let lastSecChUa = "";
let lastAcceptLanguage = "";
let port = 0;
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/done")) {
    submitted++;
    res.end("<title>done</title>published");
    return;
  }
  if (req.url.startsWith("/needs-login")) {
    // Like a real site: an unauthenticated publish page bounces to a login page on another host.
    res.writeHead(302, { Location: `http://localhost:${port}/passport/login` });
    res.end();
    return;
  }
  if (req.url.startsWith("/scripted")) {
    res.setHeader("Content-Type", "text/html");
    res.end("<title>scripted</title><script>window.__pageScriptRan = true;</script><p>home</p>");
    return;
  }
  if (req.url.startsWith("/passport")) {
    res.end("<title>login</title>please sign in");
    return;
  }
  if (req.url.startsWith("/i/api/graphql/")) {
    // Mimics X's CreateTweet answer (success) or its error shape (?reject=1).
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        req.url.includes("reject=1")
          ? { errors: [{ message: "Status is a duplicate." }] }
          : { data: { create_tweet: { tweet_results: { result: { rest_id: "1234567890" } } } } },
      ),
    );
    return;
  }
  lastSecChUa = req.headers["sec-ch-ua"] ?? lastSecChUa;
  lastAcceptLanguage = req.headers["accept-language"] ?? lastAcceptLanguage;
  const reject = req.url.startsWith("/compose-reject");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'");
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html><title>compose</title>
<script>window.fetch = () => { throw new Error("page fetch hijacked"); };</script>
<textarea id="editor"></textarea><button id="submit" type="button">Post</button>
<script>
document.getElementById("submit").addEventListener("click", () => {
  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/i/api/graphql/abc123/CreateTweet${reject ? "?reject=1" : ""}");
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.onload = () => { setTimeout(() => { location.href = "/done"; }, 300); };
  xhr.send(JSON.stringify({ text: document.getElementById("editor").value }));
});
</script>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
port = server.address().port;
const url = `http://127.0.0.1:${port}/compose`;
// A port that was free a moment ago: connecting to it is refused (a transient network error).
const downUrl = await new Promise((resolve) => {
  const tmpServer = http.createServer();
  tmpServer.listen(0, "127.0.0.1", () => {
    const p = tmpServer.address().port;
    tmpServer.close(() => resolve(`http://127.0.0.1:${p}/compose`));
  });
});

const app = await electron.launch({
  executablePath: electronPath,
  args: [mainScript, "--no-sandbox"],
  env: { ...process.env, MULTIPOST_USER_DATA: userData, E2E_URL: url, E2E_DOWN_URL: downUrl },
});
const failures = [];
const check = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) failures.push(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const draft = (content) => ({
  contentType: "DYNAMIC",
  title: "",
  content,
  digest: "",
  htmlContent: "",
  markdownContent: "",
  tags: [],
  images: [{ path: imagePath, name: "photo one.png", size: imageSize, type: "image/png" }],
  videos: [],
});
const publish = (targets, autoPublish, content) =>
  app.evaluate(({}, args) => globalThis.__mp.startPublish(args), { targets, autoPublish, draft: draft(content) });
const jobsOf = (runId) =>
  app.evaluate(({}, runId) => {
    const s = globalThis.__mp.getState();
    return s.jobs.filter((j) => j.runId === runId).map((j) => ({ id: j.id, status: j.status, error: j.error, attempts: j.attempts, verification: j.verification }));
  }, runId);
async function waitJobs(runId, done, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  let jobs = [];
  while (Date.now() < end) {
    jobs = await jobsOf(runId);
    if (done(jobs)) return jobs;
    await sleep(300);
  }
  return jobs;
}
const finished = (jobs) => jobs.length > 0 && jobs.every((j) => !["queued", "loading", "injecting"].includes(j.status));

try {
  const win = await app.firstWindow();
  await win.waitForSelector("text=Add your first account", { timeout: 20000 });
  check(true, "UI loads with empty state");

  const ids = await app.evaluate(() => {
    const mp = globalThis.__mp;
    const mk = (label) => {
      const id = `acc-${label.replace(/\W/g, "")}`;
      mp.update((s) => s.accounts.push({ id, accountKey: "x", label, partition: `persist:acc-${id}`, status: "unknown", createdAt: Date.now() }));
      return id;
    };
    return [mk("Brand A"), mk("Brand B")];
  });

  // 1. Session isolation
  const isolation = await app.evaluate(async ({ session }, ids) => {
    const a = session.fromPartition(`persist:acc-${ids[0]}`);
    const b = session.fromPartition(`persist:acc-${ids[1]}`);
    await a.cookies.set({ url: "https://x.com", name: "auth_token", value: "A" });
    return { a: (await a.cookies.get({ name: "auth_token" })).length, b: (await b.cookies.get({ name: "auth_token" })).length };
  }, ids);
  check(isolation.a === 1 && isolation.b === 0, "cookies are isolated between accounts on the same site");

  // 2. Auto-submit to two accounts in parallel
  let run = await publish(ids.map((accountId) => ({ accountId, platform: "DYNAMIC_E2E" })), true, "Hello from the e2e test");
  let jobs = await waitJobs(run, finished);
  check(jobs.length === 2 && jobs.every((j) => j.status === "done"), `both jobs finish (${JSON.stringify(jobs.map((j) => j.status))})`);
  await sleep(800);
  check(submitted === 2, `auto-submit clicked the publish button on both pages (submitted=${submitted})`);

  // 3. Review mode: page filled, file fetched through CSP from the isolated world, Chrome-like identity
  run = await publish([{ accountId: ids[0], platform: "DYNAMIC_E2E" }], false, "Second run");
  jobs = await waitJobs(run, finished);
  const result = await app.evaluate(async ({ BrowserWindow }, url) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents.getURL() === url) {
        const r = await w.webContents.executeJavaScript(
          `[document.body.getAttribute("data-result"), document.querySelector("#editor").value, JSON.stringify(navigator.userAgentData && navigator.userAgentData.brands)]`,
        );
        if (r[0]?.startsWith("ok")) return r;
      }
    }
    return null;
  }, url);
  check(!!result && jobs[0]?.status === "done", "review-mode job fills the page");
  if (result) {
    const [res, editor, brands] = result;
    const ua = res.split(":").slice(2).join(":");
    check(res.startsWith(`ok:${imageSize}:`), "local file fetched through the page CSP from the isolated world");
    check(!/Electron|multipost/i.test(ua) && /Chrome\/\d+\.0\.0\.0 /.test(ua), `user agent is a reduced Chrome UA (${ua})`);
    check(editor === "Second run", "editor filled");
    check(/Google Chrome/.test(brands ?? ""), `navigator.userAgentData reports Google Chrome (${brands})`);
  }
  check(!lastSecChUa || /Google Chrome/.test(lastSecChUa), `Sec-CH-UA header carries the Google Chrome brand (${lastSecChUa || "not sent"})`);

  // 4. Redirect to a login page fails the job and marks the account signed out
  run = await publish([{ accountId: ids[1], platform: "DYNAMIC_E2E_LOGIN" }], true, "Login check");
  jobs = await waitJobs(run, finished);
  const status = await app.evaluate(({}, id) => globalThis.__mp.getState().accounts.find((a) => a.id === id).status, ids[1]);
  check(jobs[0]?.status === "failed" && /sign in/i.test(jobs[0]?.error ?? ""), `login redirect fails the job (${jobs[0]?.status}: ${jobs[0]?.error})`);
  check(status === "logged-out", "login redirect marks the account as signed out");

  // 5. A renderer crash during publishing fails the job instead of leaving it running or "done"
  run = await publish([{ accountId: ids[0], platform: "DYNAMIC_E2E_HANG" }], true, "Crash check");
  await waitJobs(run, (j) => j[0]?.status === "injecting");
  await sleep(500);
  await app.evaluate(({ BrowserWindow }, url) => {
    for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL() === url && w.getTitle().includes("DYNAMIC_E2E_HANG")) w.webContents.forcefullyCrashRenderer();
  }, url);
  jobs = await waitJobs(run, finished, 15000);
  check(jobs[0]?.status === "failed" && /crash/i.test(jobs[0]?.error ?? ""), `renderer crash fails the job (${jobs[0]?.status}: ${jobs[0]?.error})`);

  // 6. Window cap: with 1 window allowed and a review window open, the next job waits
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.getURL().startsWith("file:")) w.destroy(); // close every publish window
    globalThis.__mp.update((s) => {
      s.settings.maxOpenWindows = 1;
      s.settings.concurrency = 3;
    });
  });
  const runA = await publish([{ accountId: ids[0], platform: "DYNAMIC_E2E" }], false, "Cap A");
  await waitJobs(runA, finished);
  const runB = await publish([{ accountId: ids[1], platform: "DYNAMIC_E2E" }], false, "Cap B");
  await sleep(1500);
  const waiting = await jobsOf(runB);
  check(waiting[0]?.status === "queued", `second job waits while the window limit is reached (${waiting[0]?.status})`);
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.getURL().startsWith("file:")) w.close();
  });
  jobs = await waitJobs(runB, finished);
  check(jobs[0]?.status === "done", `queued job starts once a window is closed (${jobs[0]?.status})`);

  // 7. Sign-in check windows run no page scripts, but the app's own injected code still runs
  const scriptless = await app.evaluate(async ({}, url) => {
    const mp = globalThis.__mp;
    const account = mp.getState().accounts[0];
    const win = await mp.createAccountWindow(account, { title: "detect", show: false, webSecurity: false });
    const unmark = mp.markScriptless(win.webContents.id);
    await win.loadURL(url.replace("/compose", "/scripted"));
    const r = await win.webContents.executeJavaScript("[window.__pageScriptRan === true, 1 + 1]");
    unmark();
    win.destroy();
    return r;
  }, url);
  check(scriptless[0] === false && scriptless[1] === 2, `page scripts blocked in sign-in checks, app code still runs (${scriptless})`);

  // 8. Proxy passwords are encrypted on disk (or at least never written in clear when encryption is available)
  const enc = await app.evaluate(({ safeStorage }, id) => {
    const mp = globalThis.__mp;
    mp.update((s) => {
      s.accounts.find((a) => a.id === id).proxy = "http://alice:S3cretPass@127.0.0.1:9";
    });
    mp.flush();
    return safeStorage.isEncryptionAvailable();
  }, ids[1]);
  const onDisk = fs.readFileSync(path.join(userData, "multipost-data.json"), "utf8");
  const uiProxy = await app.evaluate(({}, id) => globalThis.__mp.publicState().accounts.find((a) => a.id === id).proxy, ids[1]);
  check(!uiProxy.includes("S3cretPass") && uiProxy.includes("alice:"), `proxy password masked for the UI (${uiProxy})`);
  check(!enc || !onDisk.includes("S3cretPass"), `proxy password not stored in clear (encryption available: ${enc})`);
  await app.evaluate(({}, id) => {
    globalThis.__mp.update((s) => {
      s.accounts.find((a) => a.id === id).proxy = undefined;
    });
  }, ids[1]);

  // 9. A website in an account window cannot drive the app (no bridge, and IPC rejects other senders)
  const bridge = await app.evaluate(async ({ BrowserWindow }, url) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.webContents.getURL().startsWith("file:"));
    if (!w) return "no-window";
    return w.webContents.executeJavaScript("typeof window.multipost + ':' + typeof window.require + ':' + typeof window.process");
  }, url);
  check(bridge === "no-window" || bridge === "undefined:undefined:undefined", `account pages get no app bridge (${bridge})`);

  // Reset what the window-cap test changed.
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.getURL().startsWith("file:")) w.destroy();
    globalThis.__mp.update((s) => {
      s.settings.maxOpenWindows = 8;
    });
  });

  // 10. Confirmation from the platform's own answer: published + link, and rejection
  const verified = await app.evaluate(({}) =>
    globalThis.__mp.getState().jobs.filter((j) => j.platform === "DYNAMIC_E2E" && j.autoPublish).map((j) => [j.verification, j.postUrl]),
  );
  check(
    verified.length >= 2 && verified.every(([v, u]) => v === "published" && u === "https://x.com/i/web/status/1234567890"),
    `auto-submitted posts confirmed with a link (${JSON.stringify(verified[0])})`,
  );
  const dupGuard = await app.evaluate(({}) => {
    const mp = globalThis.__mp;
    const job = mp.getState().jobs.find((j) => j.verification === "published");
    try {
      mp.retryJob(job.id);
      return "retried";
    } catch (e) {
      return String(e.message);
    }
  });
  check(/duplicate/i.test(dupGuard), `retry refused for a confirmed post (${dupGuard})`);
  run = await publish([{ accountId: ids[0], platform: "DYNAMIC_E2E_REJECT" }], true, "Duplicate");
  jobs = await waitJobs(run, (j) => j[0]?.status === "failed" || j[0]?.verification === "rejected", 20000);
  const rej = (await app.evaluate(({}, r) => globalThis.__mp.getState().jobs.find((j) => j.runId === r), run));
  check(rej?.status === "failed" && /duplicate/i.test(rej?.error ?? ""), `platform rejection fails the job (${rej?.status}: ${rej?.error})`);

  // 11. Per-account text: platform override + account override + group footer + template variables
  await app.evaluate(({}, ids) => {
    globalThis.__mp.update((s) => {
      s.groups.push({ id: "g-e2e", name: "E2E", color: "#6366f1", accountIds: [ids[0], ids[1]], createdAt: Date.now(), footer: "-- sent by {account}", hashtags: ["grouptag"] });
    });
  }, ids);
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.getURL().startsWith("file:")) w.destroy();
  });
  const customRun = await app.evaluate(({}, { ids, imagePath, imageSize }) =>
    globalThis.__mp.startPublish({
      autoPublish: false,
      targets: ids.map((accountId) => ({ accountId, platform: "DYNAMIC_E2E" })),
      draft: {
        contentType: "DYNAMIC", title: "", content: "Main text", digest: "", htmlContent: "", markdownContent: "", tags: [],
        images: [{ path: imagePath, name: "photo one.png", size: imageSize, type: "image/png" }], videos: [],
        overrides: {
          "platform:DYNAMIC_E2E": { content: "Hello from {account}" },
          [`account:${ids[1]}`]: { content: "Special text for B" },
        },
      },
    }), { ids, imagePath, imageSize });
  await waitJobs(customRun, finished);
  const editors = await app.evaluate(async ({ BrowserWindow }) => {
    const out = [];
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents.getURL().startsWith("file:")) continue;
      out.push(await w.webContents.executeJavaScript('document.querySelector("#editor") ? document.querySelector("#editor").value : ""'));
    }
    return out.sort();
  });
  check(
    editors.includes("Hello from Brand A\n\n-- sent by Brand A") && editors.includes("Special text for B\n\n-- sent by Brand B"),
    `per-platform/per-account text with group footer (${JSON.stringify(editors)})`,
  );

  // 12. Pre-publish check: ready page vs. login redirect
  const reports = await app.evaluate(({}, ids) =>
    globalThis.__mp.preflight([
      { accountId: ids[0], platform: "DYNAMIC_E2E" },
      { accountId: ids[0], platform: "DYNAMIC_E2E_LOGIN" },
    ]), ids);
  const byPlatform = Object.fromEntries(reports.map((r) => [r.platform, r.result]));
  check(byPlatform.DYNAMIC_E2E === "ok" && byPlatform.DYNAMIC_E2E_LOGIN === "signed-out", `target check (${JSON.stringify(byPlatform)})`);

  // 13. Network failure on load: retried automatically (nothing was submitted)
  run = await publish([{ accountId: ids[0], platform: "DYNAMIC_E2E_DOWN" }], true, "Retry");
  jobs = await waitJobs(run, (j) => j[0]?.status === "queued" && j[0]?.attempts >= 1, 15000);
  const retrying = await app.evaluate(({}, r) => globalThis.__mp.getState().jobs.find((j) => j.runId === r), run);
  check(retrying?.status === "queued" && !!retrying?.retryAt && /Retrying/.test(retrying?.error ?? ""), `network failure scheduled for retry (${retrying?.status}, ${retrying?.error})`);
  await app.evaluate(({}, id) => globalThis.__mp.cancelJob(id), retrying?.id);

  // 14. Per-account timezone and language reach the pages
  await app.evaluate(({}, id) => {
    globalThis.__mp.update((s) => {
      const a = s.accounts.find((x) => x.id === id);
      a.timezone = "Asia/Tokyo";
      a.locale = "ja-JP";
    });
  }, ids[1]);
  const tz = await app.evaluate(async ({}, { id, url }) => {
    const mp = globalThis.__mp;
    const account = mp.getState().accounts.find((a) => a.id === id);
    const win = await mp.createAccountWindow(account, { title: "tz", show: false });
    await win.loadURL(url);
    const r = await win.webContents.executeJavaScript("Intl.DateTimeFormat().resolvedOptions().timeZone + '|' + new Date().getTimezoneOffset()");
    win.destroy();
    return r;
  }, { id: ids[1], url });
  check(tz === "Asia/Tokyo|-540", `account timezone applied to pages (${tz})`);
  check(/^ja-JP/.test(lastAcceptLanguage), `account language sent as Accept-Language (${lastAcceptLanguage})`);

  // 15. A second app instance must exit without touching the data file
  await sleep(600); // let the debounced save land
  const before = fs.readFileSync(path.join(userData, "multipost-data.json"), "utf8");
  const second = spawnSync(electronPath, [mainScript, "--no-sandbox"], {
    env: { ...process.env, MULTIPOST_USER_DATA: userData, E2E_URL: url },
    timeout: 20000,
  });
  const after = fs.readFileSync(path.join(userData, "multipost-data.json"), "utf8");
  check(second.status === 0 && JSON.parse(after).accounts.length === 2 && before.length > 0, `second instance exits and leaves data intact (exit ${second.status})`);
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
