import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { saveChatLinkFromValues } from "./chatLink.js";
import type { RelayConfig } from "./config.js";
import { readBody } from "./http.js";
import type { RelayStore } from "./store.js";

const WIZARD_TOKEN_HEADER = "x-wizard-setup-token";

/**
 * One-time bootstrap route the local setup wizard calls instead of the
 * session-gated `/chat-link` form, since first run has no completed
 * magic-link login yet. Deliberately narrow: shared-secret header (checked
 * with `timingSafeEqual`, same pattern as the Connecteam webhook receiver's
 * `isValidSecret`) plus a loopback-only check, so this can't be reached from
 * anywhere but the wizard running on the same machine during the same setup
 * session.
 */
export async function handleWizardBootstrap(
  req: IncomingMessage,
  res: ServerResponse,
  config: RelayConfig,
  store: RelayStore,
): Promise<void> {
  if (!isLoopback(req.socket.remoteAddress)) {
    res.writeHead(403).end();
    return;
  }

  const tokenHeader = req.headers[WIZARD_TOKEN_HEADER];
  if (!config.wizardSetupToken || typeof tokenHeader !== "string" || !isValidToken(tokenHeader, config.wizardSetupToken)) {
    res.writeHead(403).end();
    return;
  }

  const raw = await readBody(req);
  let body: unknown;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    res.writeHead(400).end();
    return;
  }

  const values = body as Record<string, unknown>;
  const adminEmail = typeof values.adminEmail === "string" ? values.adminEmail.trim() : undefined;
  if (!adminEmail) {
    res.writeHead(400).end(JSON.stringify({ ok: false, reason: "adminEmail is required" }));
    return;
  }

  const result = saveChatLinkFromValues(store, {
    conversationId: asString(values.conversationId),
    importerEndpointUrl: asString(values.importerEndpointUrl),
    sharedSecret: asString(values.sharedSecret),
    connecteamWebhookSecret: asString(values.connecteamWebhookSecret),
  });

  if (!result.ok) {
    res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify(result));
    return;
  }

  store.claimAdminEmail(adminEmail);

  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function isValidToken(header: string, expected: string): boolean {
  const headerBuf = Buffer.from(header, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (headerBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(headerBuf, expectedBuf);
}

function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
