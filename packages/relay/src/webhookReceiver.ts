import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { forwardTrigger, type RelayTriggerPayload } from "./forwarder.js";
import { readBody } from "./http.js";
import type { RelayStore } from "./store.js";

const CONNECTEAM_SECRET_HEADER = "x-webhook-secret";

/**
 * Receives Connecteam's Chat webhook (`featureType: "chat"`, scoped to the
 * linked conversation via `entityId` at creation time, issue 06). Confirmed
 * shape via developer.connecteam.com's Chat webhook guide (2026-09-22):
 * `{requestId, company, activityType, eventTimestamp, eventType, data: {message: {...}}}`.
 * Only `message_created` events carrying a file attachment turn into a trigger.
 *
 * Acks fast, forwards after — Connecteam's own docs say it waits up to 10s
 * for a response and retries non-2xx deliveries, so responding immediately
 * avoids both the timeout and needless retries.
 */
export async function handleConnecteamWebhook(req: IncomingMessage, res: ServerResponse, store: RelayStore): Promise<void> {
  const raw = await readBody(req);
  const secretHeader = req.headers[CONNECTEAM_SECRET_HEADER];

  let event: unknown;
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    res.writeHead(400).end();
    return;
  }

  res.writeHead(200).end();

  const chatLink = store.getChatLink();
  if (!chatLink) return;
  if (typeof secretHeader !== "string" || !isValidSecret(secretHeader, chatLink.connecteamWebhookSecret)) {
    console.warn("[relay] Connecteam webhook call with missing/invalid x-webhook-secret — dropped");
    return;
  }

  const parsed = parseMessageCreatedEvent(event);
  if (!parsed) return;
  if (parsed.conversationId !== chatLink.conversationId) return;

  try {
    await forwardTrigger(chatLink, parsed);
  } catch (err) {
    console.error("Failed to forward trigger to Importer:", err);
  }
}

function isValidSecret(header: string, expected: string): boolean {
  const headerBuf = Buffer.from(header, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (headerBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(headerBuf, expectedBuf);
}

/**
 * Only `message_created` events with a real (non-system) attachment, sent by
 * an actual Connecteam user, become a trigger.
 *
 * The `senderType === "user"` check is load-bearing, not defensive: the
 * Importer posts its own result message (with a CSV report attached) back
 * into this same monitored conversation, and Connecteam's webhook fires for
 * that message_created event too — with no built-in way to tell "the tool's
 * own output" apart from "an Admin's new upload" other than who sent it.
 * Discovered live (2026-09-22): without this check, the Importer's own
 * confirmation message re-triggers itself, downloading its own CSV report as
 * if it were a new Schedule Export and crashing trying to parse it as .xlsx.
 * A plain text message, a system message (member added, etc.), or any other
 * event type is also ignored.
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

  const content = message.content;
  const caption = typeof content === "string" && content.trim().length > 0 ? content : undefined;

  return { conversationId, messageId, attachmentUrl, caption };
}
