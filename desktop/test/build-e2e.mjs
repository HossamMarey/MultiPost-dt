import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoSrc = path.resolve(here, "../../src");
await esbuild.build({
  entryPoints: [path.join(here, "e2e-entry.ts")],
  outfile: path.join(here, "../dist/e2e-main.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  nodePaths: [path.join(here, "../node_modules")],
  tsconfigRaw: { compilerOptions: { jsx: "react-jsx" } },
  plugins: [
    {
      name: "tilde",
      setup(build) {
        build.onResolve({ filter: /^~/ }, (args) =>
          build.resolve(`./${args.path.slice(1)}`, { resolveDir: repoSrc, kind: args.kind, importer: args.importer }),
        );
      },
    },
  ],
  logLevel: "warning",
});
