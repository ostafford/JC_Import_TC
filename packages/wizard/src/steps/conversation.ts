import type { IncomingMessage, ServerResponse } from "node:http";
import { generateWebhookSecrets } from "@sch-import/importer/dist/lib.js";
import { escapeHtml, page, parseFormBody } from "@sch-import/relay/dist/lib.js";
import type { WizardState } from "../wizardState.js";

export function renderConversationStep(state: WizardState, error?: string): string {
  const conversations = state.conversations ?? [];
  const options = conversations
    .map(
      (c, i) =>
        `<label class="radio"><input type="radio" name="conversationIndex" value="${i}" ${i === 0 ? "checked" : ""}> ${escapeHtml(
          c.name ?? "(untitled)",
        )} — <code>${escapeHtml(c.conversationId)}</code></label>`,
    )
    .join("\n");

  return page(
    "Setup — pick a conversation",
    `<h1>Step 2 of 6 — link a Connecteam Chat</h1>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<p>Any Schedule Export uploaded to this conversation will trigger an Import. Use a chat containing only the Admins who should be able to do that.</p>
<form method="post" action="/step/conversation">
  ${options}

  <label for="relayWebhookUrl">Relay's public webhook-receiver URL</label>
  <input type="url" id="relayWebhookUrl" name="relayWebhookUrl" placeholder="https://your-tunnel-url/webhooks/connecteam" required>
  <p class="hint">The Relay's current public address, with <code>/webhooks/connecteam</code> appended — from whatever tunnel is running right now. The next step walks you through pasting this into Connecteam's own webhook form.</p>

  <button type="submit">Continue</button>
</form>`,
  );
}

export async function handleConversationStep(req: IncomingMessage, res: ServerResponse, state: WizardState): Promise<void> {
  const conversations = state.conversations ?? [];
  const form = await parseFormBody(req);
  const chosen = conversations[Number(form.conversationIndex)];
  const relayWebhookUrl = form.relayWebhookUrl?.trim();

  if (!chosen || !relayWebhookUrl) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderConversationStep(state, "Pick a conversation and enter the Relay's webhook URL."));
    return;
  }

  const { connecteamWebhookSecret, webhookSharedSecret } = generateWebhookSecrets();

  state.conversationId = chosen.conversationId;
  state.conversationName = chosen.name;
  state.relayWebhookUrl = relayWebhookUrl;
  state.connecteamWebhookSecret = connecteamWebhookSecret;
  state.webhookSharedSecret = webhookSharedSecret;

  res.writeHead(302, { Location: "/step/webhook-verify" });
  res.end();
}
