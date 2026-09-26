import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  ConnecteamClient,
  processImportTrigger,
  verifyRelayTrigger,
  type RelayTriggerVerificationFailure,
} from "@sch-import/shared";
import type { ImporterConfig } from "./config.js";

const SIGNATURE_HEADER = "x-relay-signature";

/**
 * Receives the Relay's bare trigger — conversationId/messageId/attachmentUrl
 * only, never file content or a token (ADR 0001) — verifies it was actually
 * signed by the Relay with the shared secret from `importer setup`, then
 * hands it to `processImportTrigger` to do all the real work. Responds 202
 * immediately: Chat is the confirmation channel (issue 05), not the HTTP
 * response.
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

  const verification = await verifyRelayTrigger(
    rawBody,
    typeof signature === "string" ? signature : undefined,
    config.webhookSharedSecret,
    config.conversationId,
  );

  if (!verification.ok) {
    res.writeHead(statusForFailure(verification.reason)).end();
    return;
  }

  res.writeHead(202).end();

  // Fire-and-forget: processImportTrigger always notifies Chat itself and
  // never rejects (issue 18), so there's nothing left for this call site to
  // catch.
  void processImportTrigger(
    client,
    { timeClocks: config.timeClocks },
    { conversationId: config.conversationId, senderId: config.senderId },
    verification.payload,
  );
}

function statusForFailure(reason: RelayTriggerVerificationFailure): number {
  switch (reason) {
    case "bad-signature":
      return 401;
    case "malformed-payload":
      return 400;
    case "wrong-conversation":
      return 403;
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
