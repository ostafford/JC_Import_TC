import type { IncomingMessage, ServerResponse } from "node:http";
import { escapeHtml, page } from "@sch-import/relay/dist/lib.js";
import type { WizardState } from "../wizardState.js";

/**
 * Deliberately manual (issue 06's 2026-09-23 addendum): the Admin creates
 * this webhook themselves in Connecteam's own UI instead of the wizard
 * creating it via API. Not a workaround for the UI-visibility quirk that
 * addendum documents — a trust/visibility choice: a client can see and
 * understand the object they're connecting, instead of it existing only as
 * an invisible API side effect. This step gives the exact values to enter,
 * then verifies the result via a read-only API call rather than taking it on
 * faith.
 */
export function renderWebhookVerifyStep(state: WizardState, error?: string): string {
  return page(
    "Setup — create the webhook in Connecteam",
    `<style>table.values { border-collapse: collapse; margin: 1rem 0; } table.values th, table.values td { text-align: left; padding: 0.35rem 0.75rem 0.35rem 0; border-bottom: 1px solid #eee; } table.values th { color: #666; font-weight: 600; white-space: nowrap; }</style>
<h1>Step 3 of 6 — create the webhook yourself</h1>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<p>In Connecteam: click your name (top right) -&gt; Integrations -&gt; Webhooks -&gt; Add webhook. Enter exactly:</p>
<table class="values">
  <tr><th>Name</th><td><code>Schedule Export chat trigger</code></td></tr>
  <tr><th>Endpoint URL</th><td><code>${escapeHtml(state.relayWebhookUrl ?? "")}</code></td></tr>
  <tr><th>Secret key</th><td><code>${escapeHtml(state.connecteamWebhookSecret ?? "")}</code></td></tr>
  <tr><th>Feature</th><td><code>Chat</code></td></tr>
  <tr><th>Event Type</th><td><code>message_created</code></td></tr>
</table>
<p class="hint">The Feature dropdown scopes by conversation separately — make sure it's linked to <strong>${escapeHtml(
      state.conversationName ?? "(untitled)",
    )}</strong> (<code>${escapeHtml(state.conversationId ?? "")}</code>), the conversation picked in the previous step.</p>
<p class="hint">Verifying can confirm the webhook exists and points at the right conversation/URL, but not that the secret key was copied correctly — that only gets proven by the first real Schedule Export upload, since Connecteam never returns a saved secret back to us.</p>
<form method="post" action="/step/webhook-verify">
  <button type="submit">I've added it — verify</button>
</form>`,
  );
}

export async function handleWebhookVerifyStep(req: IncomingMessage, res: ServerResponse, state: WizardState): Promise<void> {
  let webhooks;
  try {
    webhooks = await state.client!.listWebhooks();
  } catch {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderWebhookVerifyStep(state, "Couldn't read your webhooks from Connecteam — try again in a moment."));
    return;
  }

  const found = webhooks.some(
    (w) =>
      !w.isDisabled &&
      w.entityId === state.conversationId &&
      w.featureType === "chat" &&
      w.eventTypes.includes("message_created") &&
      w.url === state.relayWebhookUrl,
  );

  if (!found) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      renderWebhookVerifyStep(
        state,
        "No matching webhook found yet — double-check the conversation, Feature, Event Type, and that the Endpoint URL matches exactly, then verify again.",
      ),
    );
    return;
  }

  state.webhookVerified = true;

  res.writeHead(302, { Location: "/step/time-clock" });
  res.end();
}
