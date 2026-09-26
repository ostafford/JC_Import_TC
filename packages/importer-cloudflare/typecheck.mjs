#!/usr/bin/env node
// Cloudflare Workers Builds (the "Deploy to Cloudflare" button's CI) runs
// this package's own `build` script before deploying — discovered live
// (2026-09-26) when the button's isolated install failed at exactly this
// step. `tsc --noEmit` type-checks `src/index.ts`, which imports
// `@sch-import/shared` — correctly absent there (an optionalDependency,
// unresolvable from npm since it's a private workspace package never
// published; skipping it there without hard-failing the install is the
// point of that optionalDependency). The deployed Worker doesn't need this
// check to pass — it only needs the committed, pre-bundled
// `release/index.js` (see wrangler.jsonc's `main`). Skip type-checking
// there instead of failing the build; still run it in full wherever the
// real monorepo sibling is actually present (local dev, CI against this
// repo itself).
import { execSync } from "node:child_process";

try {
  execSync("node -e \"require.resolve('@sch-import/shared')\"", { stdio: "ignore" });
} catch {
  console.log(
    "Skipping typecheck — @sch-import/shared isn't resolvable here (expected outside this monorepo, " +
      "e.g. the Deploy to Cloudflare button's isolated install). The deployed Worker only needs the " +
      "committed release/index.js, unaffected.",
  );
  process.exit(0);
}

execSync("tsc --noEmit", { stdio: "inherit" });
