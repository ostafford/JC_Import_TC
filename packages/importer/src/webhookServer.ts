import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ConnecteamAuthError, ConnecteamClient } from "@sch-import/shared";
import { sendImportAbortedToChat, sendImportResultToChat } from "./chatConfirmation.js";
import type { ImporterConfig } from "./config.js";
import { runImportRun } from "./importRun.js";
import { parseScheduleExport } from "./scheduleExport.js";

const SIGNATURE_HEADER = "x-relay-signature";

interface RelayTriggerPayload {
  conversationId: string;
  messageId: string;
  /** The attachment's direct download URL, as Connecteam's chat webhook delivers it — there is no separate fileId. */
  attachmentUrl: string;
}

/**
 * Receives the Relay's bare trigger — conversationId/messageId/attachmentUrl
 * only, never file content or a token (ADR 0001) — verifies it was actually signed
 * by the Relay with the shared secret from `importer setup`, then does all
 * the real work itself. Responds 202 immediately: Chat is the confirmation
 * channel (issue 05), not the HTTP response.
 */
export function startWebhookServer(config: ImporterConfig): void {
  const client = new ConnecteamClient({ apiToken: config.apiToken, baseUrl: config.baseUrl });

  const server = createServer((req, res) => {
    void handleRequest(req, res, client, config);
  });

  server.listen(config.port, () => {
    console.log(`Importer webhook server listening on :${config.port}`);
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  client: ConnecteamClient,
  config: ImporterConfig,
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }

  const rawBody = await readBody(req);
  const signature = req.headers[SIGNATURE_HEADER];

  if (typeof signature !== "string" || !isValidSignature(rawBody, signature, config.webhookSharedSecret)) {
    res.writeHead(401).end();
    return;
  }

  const payload = parsePayload(rawBody);
  if (!payload) {
    res.writeHead(400).end();
    return;
  }

  if (payload.conversationId !== config.conversationId) {
    res.writeHead(403).end();
    return;
  }

  res.writeHead(202).end();

  processTrigger(client, config, payload).catch((err) => {
    console.error("Import Run crashed:", err);
  });
}

async function processTrigger(
  client: ConnecteamClient,
  config: ImporterConfig,
  payload: RelayTriggerPayload,
): Promise<void> {
  const chatConfig = { conversationId: config.conversationId, senderId: config.senderId };

  const fileContent = await client.downloadAttachment(payload.attachmentUrl);
  const rows = await parseScheduleExport(fileContent);

  try {
    const outcome = await runImportRun(client, rows, {
      timeClockId: config.timeClockId,
      manualBreaksEnabled: config.manualBreaksEnabled,
      unpaidBreakTypeId: config.unpaidBreakTypeId,
      paidBreakTypeId: config.paidBreakTypeId,
    });
    // Logged before the chat post so a downstream failure there (e.g. the
    // attachment upload) doesn't leave this Import Run's outcome unrecoverable.
    console.log("Import Run outcome:", JSON.stringify(outcome));
    await sendImportResultToChat(client, chatConfig, outcome);
  } catch (err) {
    if (err instanceof ConnecteamAuthError) {
      await sendImportAbortedToChat(client, chatConfig, err.message);
      return;
    }
    throw err;
  }
}

function parsePayload(rawBody: Buffer): RelayTriggerPayload | undefined {
  try {
    const json = JSON.parse(rawBody.toString("utf8"));
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

function isValidSignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signatureHeader, "utf8");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
