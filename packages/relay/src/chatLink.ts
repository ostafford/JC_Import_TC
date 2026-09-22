import type { IncomingMessage, ServerResponse } from "node:http";
import { escapeHtml, maskSecret, page } from "./html.js";
import { parseFormBody } from "./http.js";
import { chatLinkFromForm, type RelayStore } from "./store.js";

/**
 * The Chat Link form (issue 06): the Admin pastes four values produced by
 * their own `importer setup` run — conversationId, their Importer's public
 * webhook endpoint, the shared secret that signs Relay→Importer triggers, and
 * the secretKey Connecteam echoes back on each webhook delivery so the Relay
 * can verify Connecteam→Relay calls too. This is the entire state the Relay
 * holds per company (ADR 0001) — no token, no Schedule Export content.
 */
export function renderDashboard(email: string, store: RelayStore, saved: boolean): string {
  const link = store.getChatLink();
  const notice = saved ? `<p class="notice">Chat Link saved.</p>` : "";

  return page(
    "Chat Link — Relay",
    `<div class="top">
  <h1>Chat Link</h1>
  <form class="inline" method="post" action="/logout"><button class="link" type="submit">Log out (${escapeHtml(email)})</button></form>
</div>
${notice}
<p class="status">${
      link
        ? `Linked to conversation <code>${escapeHtml(link.conversationId)}</code>.`
        : "Not linked yet — paste the values from <code>importer setup</code> below."
    }</p>
<form method="post" action="/chat-link">
  <label for="conversationId">Connecteam conversation ID</label>
  <input type="text" id="conversationId" name="conversationId" value="${escapeHtml(link?.conversationId ?? "")}" required>

  <label for="importerEndpointUrl">Importer webhook endpoint URL</label>
  <input type="url" id="importerEndpointUrl" name="importerEndpointUrl" value="${escapeHtml(link?.importerEndpointUrl ?? "")}" required>

  <label for="sharedSecret">Shared secret</label>
  <input type="password" id="sharedSecret" name="sharedSecret" placeholder="${
    link ? escapeHtml(maskSecret(link.sharedSecret)) : ""
  }" ${link ? "" : "required"}>
  <p class="hint">${link ? "Leave blank to keep the current secret." : ""} Never share this — it's what lets the Relay prove trigger calls to your Importer are genuine.</p>

  <label for="connecteamWebhookSecret">Connecteam webhook secret</label>
  <input type="password" id="connecteamWebhookSecret" name="connecteamWebhookSecret" placeholder="${
    link ? escapeHtml(maskSecret(link.connecteamWebhookSecret)) : ""
  }" ${link ? "" : "required"}>
  <p class="hint">${link ? "Leave blank to keep the current secret." : ""} The secretKey you gave \`importer setup\` when it created the Connecteam webhook — lets the Relay verify calls really came from Connecteam.</p>

  <button type="submit">Save Chat Link</button>
</form>`,
  );
}

export async function handleSaveChatLink(req: IncomingMessage, res: ServerResponse, store: RelayStore): Promise<void> {
  const form = await parseFormBody(req);
  const conversationId = form.conversationId?.trim();
  const importerEndpointUrl = form.importerEndpointUrl?.trim();
  const sharedSecretInput = form.sharedSecret?.trim();
  const connecteamWebhookSecretInput = form.connecteamWebhookSecret?.trim();

  const existing = store.getChatLink();
  const sharedSecret = sharedSecretInput || existing?.sharedSecret;
  const connecteamWebhookSecret = connecteamWebhookSecretInput || existing?.connecteamWebhookSecret;

  if (
    !conversationId ||
    !importerEndpointUrl ||
    !sharedSecret ||
    !connecteamWebhookSecret ||
    !isValidHttpUrl(importerEndpointUrl)
  ) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page("Invalid Chat Link", `<h1>That Chat Link is missing or invalid</h1><p><a href="/">Go back</a>.</p>`));
    return;
  }

  store.setChatLink(chatLinkFromForm({ conversationId, importerEndpointUrl, sharedSecret, connecteamWebhookSecret }));

  res.writeHead(302, { Location: "/?saved=1" });
  res.end();
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
