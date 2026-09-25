import { hmacSha256Hex, timingSafeEqualStr } from "./crypto.js";
import type { ChatLink, RelayObject } from "./relayObject.js";

const CONNECTEAM_SECRET_HEADER = "x-webhook-secret";
const SIGNATURE_HEADER = "x-relay-signature";

export interface RelayTriggerPayload {
  conversationId: string;
  messageId: string;
  /** The attachment's direct download URL, as Connecteam's chat webhook delivers it — no separate fileId on the wire (issue 06). */
  attachmentUrl: string;
}

/**
 * Receives Connecteam's Chat webhook (`featureType: "chat"`, scoped to the
 * linked conversation via `entityId` at creation time, issue 06). Only
 * `message_created` events carrying a file attachment, sent by a real user,
 * turn into a trigger.
 *
 * Acks fast, forwards after — Connecteam waits up to 10s for a response and
 * retries non-2xx deliveries. On Workers, "after" means `ctx.waitUntil`, not
 * just returning early the way the local Relay's Node process can: the
 * platform may otherwise tear the invocation down before the forward
 * completes once the Response has been returned.
 */
export async function handleConnecteamWebhook(
  request: Request,
  stub: DurableObjectStub<RelayObject>,
  ctx: ExecutionContext,
): Promise<Response> {
  const raw = await request.text();
  const secretHeader = request.headers.get(CONNECTEAM_SECRET_HEADER);

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }

  const chatLink = await stub.getChatLink();
  if (!chatLink) {
    console.warn("[relay] Connecteam webhook call received, but no Chat Link is saved yet — dropped");
    return new Response(null, { status: 200 });
  }

  if (!secretHeader || !timingSafeEqualStr(secretHeader, chatLink.connecteamWebhookSecret)) {
    console.warn("[relay] Connecteam webhook call with missing/invalid x-webhook-secret — dropped");
    return new Response(null, { status: 200 });
  }

  const parsed = parseMessageCreatedEvent(event);
  if (!parsed) {
    console.log("[relay] Webhook call ignored (not a real user's file-upload message):", summarizeEvent(event));
    return new Response(null, { status: 200 });
  }

  if (parsed.conversationId !== chatLink.conversationId) {
    console.warn(
      `[relay] Webhook call for conversation ${parsed.conversationId}, but this Relay is linked to ${chatLink.conversationId} — dropped`,
    );
    return new Response(null, { status: 200 });
  }

  console.log(`[relay] Forwarding trigger to Importer for message ${parsed.messageId}`);
  ctx.waitUntil(
    forwardTrigger(chatLink, parsed)
      .then(() => console.log("[relay] Importer accepted the trigger"))
      .catch((err) => console.error("[relay] Failed to forward trigger to Importer:", err)),
  );

  return new Response(null, { status: 200 });
}

/**
 * Forwards a bare trigger to the Admin's own Importer, signed with the
 * shared secret from `importer setup` (issue 06). Only identifiers/pointers
 * cross this boundary — never file content or a Connecteam token (ADR 0001).
 *
 * Mirrors the Importer's own verification byte-for-byte: HMAC-SHA256 hex
 * digest of the exact JSON body, same header name.
 */
async function forwardTrigger(chatLink: ChatLink, payload: RelayTriggerPayload): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = await hmacSha256Hex(chatLink.sharedSecret, body);

  console.log(`[relay] Calling Importer at: ${JSON.stringify(chatLink.importerEndpointUrl)}`);
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

/**
 * The `senderType === "user"` check is load-bearing, not defensive: the
 * Importer posts its own result message back into this same monitored
 * conversation, and Connecteam's webhook fires for that message_created event
 * too. Without this check, the Importer's own confirmation message
 * re-triggers itself (issue 06's live addendum).
 */
function parseMessageCreatedEvent(event: unknown): RelayTriggerPayload | undefined {
  if (typeof event !== "object" || event === null) return undefined;
  const envelope = event as Record<string, unknown>;
  if (envelope.eventType !== "message_created") return undefined;

  const data = envelope.data as Record<string, unknown> | undefined;
  const message = data?.message as Record<string, unknown> | undefined;
  if (!message || message.isSystem === true) return undefined;
  if (message.senderType !== "user") return undefined;

  const conversationId = message.conversationId;
  const messageId = message.id;
  const attachments = message.attachments;
  if (typeof conversationId !== "string" || typeof messageId !== "string" || !Array.isArray(attachments)) {
    return undefined;
  }

  const firstAttachment = attachments[0] as Record<string, unknown> | undefined;
  const attachmentUrl = firstAttachment?.url;
  if (typeof attachmentUrl !== "string") return undefined;

  return { conversationId, messageId, attachmentUrl };
}

/** A compact, non-sensitive shape summary for the "why was this ignored?" log line — never the raw event body. */
function summarizeEvent(event: unknown): Record<string, unknown> {
  if (typeof event !== "object" || event === null) return { shape: "not an object" };
  const envelope = event as Record<string, unknown>;
  const message = (envelope.data as Record<string, unknown> | undefined)?.message as Record<string, unknown> | undefined;
  return {
    eventType: envelope.eventType,
    hasMessage: message !== undefined,
    isSystem: message?.isSystem,
    senderType: message?.senderType,
    attachmentCount: Array.isArray(message?.attachments) ? (message!.attachments as unknown[]).length : 0,
  };
}
