import { escapeHtml, page } from "@sch-import/relay/dist/lib.js";
import type { WizardState } from "../wizardState.js";

export function renderSummaryStep(state: WizardState, relayError: boolean): string {
  const relayNotice = relayError
    ? `<p class="error">Importer config and .env were written, but the Relay didn't accept the Chat Link — check the Relay is running and WIZARD_SETUP_TOKEN matches in both .env files, then use the Relay's own dashboard to paste the Chat Link in by hand.</p>`
    : `<p class="notice">Chat Link saved on the Relay.</p>`;

  const timeClocksList = (state.timeClockResults ?? [])
    .map(
      (tc) =>
        `<li>${escapeHtml(tc.name)} — <code>${escapeHtml(tc.timeClockId)}</code>: ${
          tc.manualBreaksEnabled ? "manual breaks enabled" : "manual breaks disabled"
        }</li>`,
    )
    .join("\n");

  return page(
    "Setup complete",
    `<h1>Setup complete</h1>
${relayNotice}
<ul>
  <li>Conversation: ${escapeHtml(state.conversationName ?? "(untitled)")} — <code>${escapeHtml(state.conversationId ?? "")}</code></li>
  <li>Connecteam webhook points at: <code>${escapeHtml(state.relayWebhookUrl ?? "")}</code></li>
  <li>Custom Publisher ID: <code>${escapeHtml(state.senderId ?? "")}</code></li>
</ul>
<h2>Time Clocks (${(state.timeClockResults ?? []).length})</h2>
<ul>
${timeClocksList}
</ul>
<p>The Importer's <code>importer.config.json</code> and <code>.env</code> are written. Restart the Importer process if it was already running, so it picks up the new config.</p>
<p>Admin login: <code>${escapeHtml(state.adminEmail ?? "")}</code> — use the Relay's own login page to sign in from now on.</p>`,
  );
}
