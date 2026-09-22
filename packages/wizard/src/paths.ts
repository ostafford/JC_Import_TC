import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * The wizard writes directly into the colocated Importer package's config
 * files (no live Importer process to notify, unlike the Relay — see
 * `wizardBootstrap.ts` in packages/relay for why that side goes through an
 * HTTP call instead). Computed once, here, from this file's own location so
 * every step module gets the same absolute paths regardless of the
 * process's CWD or how deeply nested the calling file is.
 *
 * This file must stay a direct child of `src/` (mirrored 1:1 into `dist/` by
 * the project's `rootDir`/`outDir` convention) — the "../../importer" below
 * assumes exactly two levels up from `dist/paths.js` to `packages/`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const importerDir = resolve(here, "../../importer");

export const importerConfigPath = resolve(importerDir, "importer.config.json");
export const importerEnvPath = resolve(importerDir, ".env");
