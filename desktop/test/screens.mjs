// Captures screenshots of every view with seeded demo data (for design review).
// Run: node build.mjs && xvfb-run -a node test/screens.mjs <outDir>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(process.argv[2] || "screens");
const theme = process.env.THEME || "light";
fs.mkdirSync(outDir, { recursive: true });

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "multipost-shots-"));
const now = Date.now();
const acc = (id, accountKey, label, status, username) => ({
  id, accountKey, label, partition: `persist:acc-${id}`, status, createdAt: now,
  ...(username ? { profile: { username, checkedAt: now - 300000 } } : {}),
});
const accounts = [
  acc("a1", "x", "Brand – Global", "logged-in", "acme"),
  acc("a2", "x", "Brand – Support", "logged-in", "acme_help"),
  acc("a3", "bilibili", "官方号", "logged-in", "Acme官方"),
  acc("a4", "rednote", "小红书 主号", "logged-out"),
  acc("a5", "weibo", "微博 主号", "unknown"),
  acc("a6", "linkedin", "Company page", "unknown"),
  acc("a7", "threads", "Founder", "unknown"),
  acc("a8", "douyin", "抖音 主号", "logged-in", "acme_dy"),
];
const groups = [
  { id: "g1", name: "International", color: "#6366f1", accountIds: ["a1", "a2", "a6", "a7"], createdAt: now },
  { id: "g2", name: "China", color: "#ef4444", accountIds: ["a3", "a4", "a5", "a8"], createdAt: now },
  { id: "g3", name: "Launch day", color: "#10b981", accountIds: ["a1", "a3", "a6"], createdAt: now },
];
const jobs = [
  { id: "j1", runId: "r1", accountId: "a1", accountLabel: "Brand – Global", platform: "DYNAMIC_X", platformName: "X", status: "done", attempts: 1 },
  { id: "j2", runId: "r1", accountId: "a2", accountLabel: "Brand – Support", platform: "DYNAMIC_X", platformName: "X", status: "done", attempts: 1 },
  { id: "j3", runId: "r1", accountId: "a3", accountLabel: "官方号", platform: "DYNAMIC_BILIBILI", platformName: "Bilibili", status: "failed", error: "Not signed in — redirected to passport.bilibili.com. Sign in to this account and retry.", attempts: 1 },
  { id: "j4", runId: "r1", accountId: "a6", accountLabel: "Company page", platform: "DYNAMIC_LINKEDIN", platformName: "LinkedIn", status: "injecting", attempts: 1 },
  { id: "j5", runId: "r1", accountId: "a7", accountLabel: "Founder", platform: "DYNAMIC_THREADS", platformName: "Threads", status: "queued", attempts: 0 },
];
fs.writeFileSync(
  path.join(userData, "multipost-data.json"),
  JSON.stringify({
    groups, accounts, jobs,
    runs: [{ id: "r1", createdAt: now - 60000, title: "We just shipped v2 🚀", contentType: "DYNAMIC", jobIds: jobs.map((j) => j.id) }],
    settings: { concurrency: 3, autoPublish: false, closeWindowsOnSuccess: false, showPublishWindows: true, pageTimeoutSec: 60, language: "en", theme },
  }),
);

const app = await electron.launch({
  executablePath: require(path.join(here, "../node_modules/electron")),
  args: [path.join(here, "../dist/main.js"), "--no-sandbox"],
  env: { ...process.env, MULTIPOST_USER_DATA: userData },
});
const win = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  w.setContentSize(1360, 860);
});
await win.waitForTimeout(1200);
// Seed a draft (state lives in localStorage).
await win.evaluate(() => {
  localStorage.setItem("multipost.draft.v1", JSON.stringify({
    contentType: "DYNAMIC", title: "", digest: "", htmlContent: "", markdownContent: "", tags: ["launch", "productivity"],
    content: "We just shipped v2 🚀\n\nScheduling, groups and a brand-new editor. Try it today and tell us what you think!",
    images: [], videos: [],
  }));
  localStorage.setItem("multipost.targets.v1", JSON.stringify({ DYNAMIC: ["a1:DYNAMIC_X", "a2:DYNAMIC_X", "a3:DYNAMIC_BILIBILI", "a6:DYNAMIC_LINKEDIN"] }));
});
await win.reload();
await win.waitForTimeout(1500);
const shot = async (name) => {
  await win.waitForTimeout(600);
  await win.screenshot({ path: path.join(outDir, `${theme}-${name}.png`) });
  console.log("saved", name);
};
await shot("compose");
await win.getByRole("button", { name: "Accounts", exact: true }).click();
await shot("accounts");
await win.getByRole("button", { name: /International/ }).click();
await shot("group");
await win.getByRole("button", { name: "Add account" }).first().click();
await shot("add-account");
await win.keyboard.press("Escape");
await win.getByRole("button", { name: "Activity", exact: true }).click();
await shot("activity");
await win.getByRole("button", { name: "Settings", exact: true }).click();
await shot("settings");
await app.close();
