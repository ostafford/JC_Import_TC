import { ConnecteamAuthError, type ConnecteamClient } from "./connecteam/client.js";
import { parseScheduleExport } from "./scheduleExport.js";
import { runImportRun, type ImportPipelineConfig, type ImportWriter } from "./importRun.js";
import {
  sendImportAbortedToChat,
  sendImportCrashedToChat,
  sendImportResultToChat,
  type ChatConfirmationConfig,
  type ChatSender,
} from "./chatConfirmation.js";
import type { ConversationId } from "./vocabulary.js";

/**
 * The Relay's bare trigger, forwarded to an Importer after it sees a
 * Schedule Export uploaded (ADR 0001) — never file content or a token.
 */
export interface RelayTriggerPayload {
  conversationId: string;
  messageId: string;
  attachmentUrl: string;
}

export type RelayTriggerVerificationFailure = "bad-signature" | "malformed-payload" | "wrong-conversation";

export type RelayTriggerVerification =
  | { ok: true; payload: RelayTriggerPayload }
  | { ok: false; reason: RelayTriggerVerificationFailure };

/**
 * Verifies a Relay trigger was actually signed by the Relay with the shared
 * secret from `importer setup`, and that it's addressed to this Importer's
 * conversation. Returns a semantic reason, not an HTTP status — mapping a
 * reason to a status code is each deployment's own transport concern.
 *
 * Uses only Web Crypto (`crypto.subtle`), so this runs identically on the
 * local Importer (Node 20+) and the Cloudflare Workers Importer — no
 * signature-verification adapter needed for either.
 */
export async function verifyRelayTrigger(
  rawBody: ArrayBuffer | ArrayBufferView,
  signatureHeader: string | null | undefined,
  secret: string,
  expectedConversationId: ConversationId,
): Promise<RelayTriggerVerification> {
  const bytes = ArrayBuffer.isView(rawBody)
    ? new Uint8Array(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength)
    : new Uint8Array(rawBody);

  if (!signatureHeader || !(await isValidSignature(bytes, signatureHeader, secret))) {
    return { ok: false, reason: "bad-signature" };
  }

  const payload = parsePayload(bytes);
  if (!payload) {
    return { ok: false, reason: "malformed-payload" };
  }

  if (payload.conversationId !== expectedConversationId) {
    return { ok: false, reason: "wrong-conversation" };
  }

  return { ok: true, payload };
}

/** Everything `processImportTrigger` (and the `runImportRun`/Chat-notify calls inside it) needs from a ConnecteamClient. */
export type ImportTriggerClient = ImportWriter & ChatSender & Pick<ConnecteamClient, "downloadAttachment">;

/**
 * Turns one verified Relay trigger into a full Import Run: downloads the
 * Schedule Export, runs it, and always notifies Chat — success, a systemic
 * auth abort, or a crash (ADR 0002: no automatic retry, so the Admin must be
 * told directly). Never rejects: both deployments used to catch this
 * themselves and log an identical last-resort line, so owning that here
 * means neither caller needs a catch — the Cloudflare Queue consumer in
 * particular can always ack without one.
 */
export async function processImportTrigger(
  client: ImportTriggerClient,
  config: ImportPipelineConfig,
  chatConfig: ChatConfirmationConfig,
  payload: RelayTriggerPayload,
): Promise<void> {
  try {
    const fileContent = await client.downloadAttachment(payload.attachmentUrl);
    const rows = await parseScheduleExport(fileContent);

    const outcome = await runImportRun(client, rows, config);
    // Logged before the chat post so a downstream failure there (e.g. the
    // attachment upload) doesn't leave this Import Run's outcome unrecoverable.
    console.log("Import Run outcome:", JSON.stringify(outcome));
    await sendImportResultToChat(client, chatConfig, outcome);
  } catch (err) {
    if (err instanceof ConnecteamAuthError) {
      await sendImportAbortedToChat(client, chatConfig, err.message).catch((notifyErr) =>
        console.error("Also failed to notify Chat about the abort:", notifyErr),
      );
      return;
    }

    console.error("Import Run crashed (no retry — see Chat for the Admin-facing notice):", err);
    const detail = err instanceof Error ? err.message : String(err);
    await sendImportCrashedToChat(client, chatConfig, detail).catch((notifyErr) =>
      console.error("Also failed to notify Chat about the crash:", notifyErr),
    );
  }
}

async function isValidSignature(bytes: Uint8Array, signatureHeader: string, secret: string): Promise<boolean> {
  const expected = await hmacSha256Hex(secret, bytes);
  return timingSafeEqualStr(expected, signatureHeader);
}

async function hmacSha256Hex(secret: string, message: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, message);
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Web Crypto has no timingSafeEqual — compare every byte without short-circuiting. */
function timingSafeEqualStr(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i]! ^ bBytes[i]!;
  return diff === 0;
}

function parsePayload(bytes: Uint8Array): RelayTriggerPayload | undefined {
  try {
    const json = JSON.parse(new TextDecoder().decode(bytes));
    if (
      typeof json?.conversationId === "string" &&
      typeof json?.messageId === "string" &&
      typeof json?.attachmentUrl === "string"
    ) {
      return json as RelayTriggerPayload;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
