import { createHmac } from "node:crypto";
import type { ChatLink } from "./store.js";

const SIGNATURE_HEADER = "x-relay-signature";

export interface RelayTriggerPayload {
  conversationId: string;
  messageId: string;
  /**
   * The attachment's direct download URL, as Connecteam's chat webhook
   * delivers it (confirmed via developer.connecteam.com, 2026-09-22) — there
   * is no separate fileId on the wire, unlike issue 06's original guess.
   */
  attachmentUrl: string;
  /**
   * The message's own text, if any (Connecteam's `data.message.content`) —
   * only ever used by the Importer as the multi-Time-Clock fallback signal
   * (multi-time-clock-routing map, issue 05). Still just a pointer/identifier
   * in ADR 0001's sense, not the Schedule Export's content.
   */
  caption?: string;
}

/**
 * Forwards a bare trigger to the Admin's own Importer, signed with the
 * shared secret from `importer setup` (issue 06). Only identifiers/pointers
 * cross this boundary — never file content or a Connecteam token (ADR 0001);
 * a download URL is still just a pointer in that sense, not the content itself.
 *
 * Mirrors the Importer's own verification in webhookServer.ts byte-for-byte:
 * HMAC-SHA256 hex digest of the exact JSON body, same header name.
 */
export async function forwardTrigger(chatLink: ChatLink, payload: RelayTriggerPayload): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", chatLink.sharedSecret).update(body).digest("hex");

  const res = await fetch(chatLink.importerEndpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [SIGNATURE_HEADER]: signature,
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Importer endpoint responded ${res.status} ${res.statusText}`);
  }
}
