// Unit tests for the shared composing logic (no Electron needed): node test/unit.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mp-unit-")), "shared.mjs");
await esbuild.build({
  stdin: {
    contents: `export * from "./src/shared/compose"; export * from "./src/shared/platform-rules";`,
    resolveDir: path.join(here, ".."),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  logLevel: "error",
});
const m = await import(pathToFileURL(out).href);

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`PASS ${name}`);
};

const draft = (over = {}) => ({
  contentType: "DYNAMIC",
  title: "",
  content: "Main",
  digest: "",
  htmlContent: "",
  markdownContent: "",
  tags: ["one", "two", "three", "four"],
  images: [],
  videos: [],
  ...over,
});
const ctx = (over = {}) => ({
  platform: "DYNAMIC_X",
  account: { id: "a1", label: "Brand" },
  siteLabel: "X",
  groups: [],
  now: new Date(2026, 0, 2, 9, 5),
  ...over,
});

test("account override beats platform override beats main text", () => {
  const d = draft({
    overrides: { "platform:DYNAMIC_X": { content: "P", title: "PT" }, "account:a1": { content: "A" } },
  });
  const r = m.resolveContent(d, ctx());
  assert.equal(r.content, "A");
  assert.equal(r.title, "PT");
  assert.equal(m.resolveContent(d, ctx({ account: { id: "a2", label: "Other" } })).content, "P");
});

test("empty override fields fall back to the main text", () => {
  const d = draft({ overrides: { "platform:DYNAMIC_X": { content: "   ", tags: [] } } });
  const r = m.resolveContent(d, ctx());
  assert.equal(r.content, "Main");
  assert.deepEqual(r.tags, ["one", "two", "three", "four"]);
});

test("group footers and hashtags are added once, with template variables", () => {
  const groups = [
    { id: "g1", name: "G1", color: "", accountIds: ["a1"], createdAt: 0, footer: "by {account} on {site} {date} {time}", hashtags: ["#grp", "one"] },
    { id: "g2", name: "G2", color: "", accountIds: ["a1"], createdAt: 0, footer: "by {account} on {site} {date} {time}" },
  ];
  const r = m.resolveContent(draft(), ctx({ groups }));
  assert.equal(r.content, "Main\n\nby Brand on X 2026-01-02 09:05");
  assert.deepEqual(r.tags, ["one", "two", "three", "four", "grp"]);
});

test("{date}/{time} use the account's timezone", () => {
  const now = new Date(Date.UTC(2026, 0, 2, 23, 30));
  assert.equal(m.fillTemplate("{date} {time}", ctx({ now, account: { id: "a", label: "A", timezone: "Asia/Tokyo" } })), "2026-01-03 08:30");
});

test("YouTube description counts UTF-8 bytes", () => {
  const issues = m.checkPost("VIDEO_YOUTUBE", { type: "VIDEO", title: "t", content: "字".repeat(1700), tags: [], images: [], videos: [] });
  assert.ok(issues.some((i) => i.code === "textTooLong" && i.vars.n === 5100));
});

test("unknown braces are left alone", () => {
  assert.equal(m.fillTemplate("{price} {account}", ctx()), "{price} Brand");
});

test("vary hashtags shuffles deterministically per account", () => {
  const d = draft({ varyTags: true });
  const a = m.resolveContent(d, ctx()).tags;
  const again = m.resolveContent(d, ctx()).tags;
  const b = m.resolveContent(d, ctx({ account: { id: "zz-other", label: "B" } })).tags;
  assert.deepEqual(a, again);
  assert.deepEqual([...a].sort(), ["four", "one", "three", "two"]);
  assert.notDeepEqual(a, b);
});

test("X counts title + text + hashtags against 280 graphemes", () => {
  const issues = m.checkPost("DYNAMIC_X", {
    type: "DYNAMIC", title: "", content: "x".repeat(270), tags: ["abcdefghij"], images: [], videos: [],
  });
  assert.ok(issues.some((i) => i.code === "textTooLong" && i.vars.n === 282));
  // X weights emoji and CJK as 2 and every link as 23.
  assert.equal(m.xWeightedLength("😀".repeat(140)), 280);
  assert.equal(m.xWeightedLength("中文"), 4);
  assert.equal(m.xWeightedLength(`see https://example.com/${"x".repeat(200)}`), 4 + 23);
  const cjk = m.checkPost("DYNAMIC_X", { type: "DYNAMIC", title: "", content: "字".repeat(150), tags: [], images: [], videos: [] });
  assert.ok(cjk.some((i) => i.code === "textTooLong" && i.level === "warn"), "X limit is a warning (Premium allows more)");
  const bsky = m.checkPost("DYNAMIC_BLUESKY", { type: "DYNAMIC", title: "", content: "b".repeat(301), tags: [], images: [], videos: [] });
  assert.ok(bsky.some((i) => i.code === "textTooLong" && i.level === "error"), "Bluesky limit is hard");
});

test("Instagram needs media, YouTube needs a title, Bilibili tag limits", () => {
  assert.ok(m.checkPost("DYNAMIC_INSTAGRAM", { type: "DYNAMIC", title: "", content: "hi", tags: [], images: [], videos: [] }).some((i) => i.code === "needsMedia"));
  assert.ok(m.checkPost("VIDEO_YOUTUBE", { type: "VIDEO", title: " ", content: "", tags: [], images: [], videos: [] }).some((i) => i.code === "titleRequired"));
  const tags = Array.from({ length: 11 }, (_, i) => `t${i}`);
  const b = m.checkPost("VIDEO_BILIBILI", { type: "VIDEO", title: "t", content: "", tags: [...tags, "x".repeat(21)], images: [], videos: [] });
  assert.ok(b.some((i) => i.code === "tooManyTags"));
  assert.ok(b.some((i) => i.code === "tagTooLong"));
});

test("video length, orientation and cover aspect checks use media metadata", () => {
  const v = { path: "v", name: "v", size: 1, type: "video/mp4", width: 1920, height: 1080, durationSec: 200 };
  const issues = m.checkPost("DYNAMIC_X", { type: "DYNAMIC", title: "", content: "", tags: [], images: [], videos: [v] });
  assert.ok(issues.some((i) => i.code === "videoTooLong"));
  assert.ok(m.checkPost("VIDEO_DOUYIN", { type: "VIDEO", title: "", content: "", tags: [], images: [], videos: [v] }).some((i) => i.code === "preferVertical"));
  const cover = { path: "c", name: "c", size: 1, type: "image/png", width: 1000, height: 1000 };
  assert.ok(m.checkPost("VIDEO_YOUTUBE", { type: "VIDEO", title: "t", content: "", tags: [], images: [], videos: [], cover }).some((i) => i.code === "coverAspect"));
});

test("unknown platforms only get generic checks", () => {
  assert.deepEqual(m.checkPost("DYNAMIC_SOMETHING_NEW", { type: "DYNAMIC", title: "", content: "z".repeat(99999), tags: [], images: [], videos: [] }), []);
  assert.ok(m.checkPost("ARTICLE_NEW", { type: "ARTICLE", title: "", content: "", tags: [], images: [], videos: [] }).some((i) => i.code === "titleRequired"));
});

console.log(`\nAll ${passed} unit tests passed`);
