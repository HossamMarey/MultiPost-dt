// Builds the desktop app into dist/. The extension's platform code (../src) is bundled in unchanged.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoSrc = path.resolve(here, "../src");
const out = path.join(here, "dist");
const watch = process.argv.includes("--watch");

// Resolves the extension's "~foo/bar" imports (Plasmo alias for src/foo/bar).
const tildeAlias = {
  name: "tilde-alias",
  setup(build) {
    build.onResolve({ filter: /^~/ }, (args) =>
      build.resolve(`./${args.path.slice(1)}`, { resolveDir: repoSrc, kind: args.kind, importer: args.importer }),
    );
  },
};

const common = {
  bundle: true,
  logLevel: "warning",
  plugins: [tildeAlias],
  nodePaths: [path.join(here, "node_modules")],
  // Ignore the extension's tsconfig (it extends Plasmo's, which isn't installed here).
  tsconfigRaw: { compilerOptions: { jsx: "react-jsx", useDefineForClassFields: true } },
  // Never minify or rename: the inject functions are sent to pages via Function.prototype.toString().
  minify: false,
  keepNames: false,
  sourcemap: false,
  legalComments: "none",
};

async function buildToString(options) {
  const result = await esbuild.build({ ...common, ...options, write: false });
  return result.outputFiles[0].text;
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "renderer"), { recursive: true });

// MAIN-world helper content script, embedded into the page preload.
const helperCode = await buildToString({
  entryPoints: [path.join(repoSrc, "contents/helper.ts")],
  format: "iife",
  platform: "browser",
  target: "es2022",
});

await Promise.all([
  esbuild.build({
    ...common,
    entryPoints: { main: path.join(here, "src/main/index.ts") },
    outdir: out,
    platform: "node",
    format: "cjs",
    target: "node22",
    // Runtime dependency shipped in node_modules (see package.json "dependencies").
    external: ["electron", "electron-updater"],
    loader: { ".json": "json" },
  }),
  esbuild.build({
    ...common,
    entryPoints: { "app-preload": path.join(here, "src/preload/app-preload.ts") },
    outdir: out,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
  }),
  esbuild.build({
    ...common,
    entryPoints: { "page-preload": path.join(here, "src/preload/page-preload.ts") },
    outdir: out,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    define: { __HELPER_CODE__: JSON.stringify(helperCode) },
  }),
  esbuild.build({
    ...common,
    entryPoints: { "account-getters": path.join(here, "src/main/account-getters.entry.ts") },
    outdir: out,
    platform: "browser",
    format: "iife",
    target: "es2022",
  }),
  esbuild.build({
    ...common,
    entryPoints: { app: path.join(here, "src/renderer/main.tsx") },
    outdir: path.join(out, "renderer"),
    platform: "browser",
    format: "iife",
    target: "chrome120",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".png": "dataurl", ".svg": "dataurl" },
  }),
]);

execFileSync(
  process.execPath,
  [
    path.join(here, "node_modules/tailwindcss/lib/cli.js"),
    "-c",
    path.join(here, "tailwind.config.js"),
    "-i",
    path.join(here, "src/renderer/styles.css"),
    "-o",
    path.join(out, "renderer/app.css"),
    "--minify",
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);

fs.copyFileSync(path.join(here, "src/renderer/index.html"), path.join(out, "renderer/index.html"));
fs.copyFileSync(path.join(here, "build/icon.png"), path.join(out, "icon.png"));

console.log("Built desktop app into", path.relative(process.cwd(), out) || ".");
if (watch) console.log("(watch mode is not implemented; re-run the build)");
