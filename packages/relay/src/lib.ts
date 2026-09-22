/**
 * Library surface for other local packages (the setup wizard) that need to
 * reuse Relay types/config/HTML-shell helpers without reaching into internal
 * files. Not used by `index.ts` itself — that still imports directly.
 */
export type { ChatLink } from "./store.js";
export { chatLinkFromForm, RelayStore } from "./store.js";
export type { RelayConfig } from "./config.js";
export { loadRelayConfig, writeRelayEnvFile } from "./config.js";
export { escapeHtml, page } from "./html.js";
export { parseFormBody, readBody } from "./http.js";
