/**
 * Library surface for other local packages (the setup wizard) that need to
 * drive Importer setup programmatically instead of through the CLI's
 * `readline` prompts. Not used by `cli.ts` itself — that still imports
 * directly from `./config.js` / `./setup.js`.
 */
export type { ImporterConfig, PersistedSetupConfig } from "./config.js";
export { loadImporterConfig, persistSetupConfig, writeImporterEnvFile } from "./config.js";
export { buildPersistedConfig, generateWebhookSecrets, validateBreakTypeSelection } from "./setupSteps.js";
