import { escapeHtml, maskSecret, page } from "./html.js";
import type { RelayObject } from "./relayObject.js";
import { asConversationId } from "./vocabulary.js";

/**
 * The Chat Link form (issue 06): the Admin pastes four values produced by
 * their own `importer setup` run — conversationId, their Importer's public
 * webhook endpoint, the shared secret that signs Relay→Importer triggers, and
 * the secretKey Connecteam echoes back on each webhook delivery so the Relay
 * can verify Connecteam→Relay calls too. This is the entire state the Relay
 * holds per company (ADR 0001) — no token, no Schedule Export content.
 */
export async function renderDashboard(email: string, stub: DurableObjectStub<RelayObject>, saved: boolean): Promise<string> {
  const link = await stub.getChatLink();
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

export async function handleSaveChatLink(request: Request, stub: DurableObjectStub<RelayObject>): Promise<Response> {
  const form = await request.formData();
  const result = await saveChatLinkFromValues(stub, {
    conversationId: form.get("conversationId")?.toString().trim(),
    importerEndpointUrl: form.get("importerEndpointUrl")?.toString().trim(),
    sharedSecret: form.get("sharedSecret")?.toString().trim(),
    connecteamWebhookSecret: form.get("connecteamWebhookSecret")?.toString().trim(),
  });

  if (!result.ok) {
    return new Response(page("Invalid Chat Link", `<h1>That Chat Link is missing or invalid</h1><p><a href="/">Go back</a>.</p>`), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return new Response(null, { status: 302, headers: { Location: "/?saved=1" } });
}

/**
 * Validates and saves a Chat Link from raw (possibly blank/missing) values.
 * Blank secret fields keep whatever's already saved, matching the form's
 * "leave blank to keep the current secret" behavior.
 */
export async function saveChatLinkFromValues(
  stub: DurableObjectStub<RelayObject>,
  values: {
    conversationId?: string;
    importerEndpointUrl?: string;
    sharedSecret?: string;
    connecteamWebhookSecret?: string;
  },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const conversationId = values.conversationId;
  const importerEndpointUrl = values.importerEndpointUrl;

  const existing = await stub.getChatLink();
  const sharedSecret = values.sharedSecret || existing?.sharedSecret;
  const connecteamWebhookSecret = values.connecteamWebhookSecret || existing?.connecteamWebhookSecret;

  if (
    !conversationId ||
    !importerEndpointUrl ||
    !sharedSecret ||
    !connecteamWebhookSecret ||
    !isValidHttpUrl(importerEndpointUrl)
  ) {
    return { ok: false, reason: "Chat Link is missing required fields or has an invalid endpoint URL" };
  }

  await stub.setChatLink({
    conversationId: asConversationId(conversationId),
    importerEndpointUrl,
    sharedSecret,
    connecteamWebhookSecret,
  });
  return { ok: true };
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
