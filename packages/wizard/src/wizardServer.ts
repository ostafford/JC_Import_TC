import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { page } from "@sch-import/relay/dist/lib.js";
import { handleBreakTypesStep, renderBreakTypesStep } from "./steps/breakTypes.js";
import { handleConversationStep, renderConversationStep } from "./steps/conversation.js";
import { handleRelayLinkStep, renderRelayLinkStep } from "./steps/relayLink.js";
import { renderSummaryStep } from "./steps/summary.js";
import { handleTimeClockStep, renderTimeClockStep } from "./steps/timeClock.js";
import { handleTokenStep, renderTokenStep } from "./steps/token.js";
import { handleWebhookVerifyStep, renderWebhookVerifyStep } from "./steps/webhookVerify.js";
import type { WizardConfig } from "./wizardConfig.js";
import { createWizardState, type WizardState } from "./wizardState.js";

/**
 * Replaces `importer setup`'s `readline` prompts and the Relay's separate
 * manual "paste 4 fields into a form" step with one browser-based flow. Binds
 * explicitly to 127.0.0.1 — this process transiently holds the real
 * Connecteam API token in memory (see `wizardState.ts`), the same
 * never-expose-it-publicly requirement the Importer itself follows.
 */
export function startWizardServer(config: WizardConfig): void {
  const state = createWizardState();

  const server = createServer((req, res) => {
    void route(req, res, config, state).catch((err) => {
      console.error("Wizard request failed:", err);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  server.listen(config.port, "127.0.0.1", () => {
    console.log(`Setup wizard listening on http://127.0.0.1:${config.port}`);
  });
}

async function route(req: IncomingMessage, res: ServerResponse, config: WizardConfig, state: WizardState): Promise<void> {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${config.port}`);
  const method = req.method ?? "GET";

  if (method === "GET" && url.pathname === "/") {
    res.writeHead(302, { Location: "/step/token" });
    res.end();
    return;
  }

  if (method === "GET" && url.pathname === "/step/token") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderTokenStep());
    return;
  }
  if (method === "POST" && url.pathname === "/step/token") {
    await handleTokenStep(req, res, state, process.env.CONNECTEAM_BASE_URL);
    return;
  }

  if (method === "GET" && url.pathname === "/step/conversation") {
    if (!state.client) return redirectTo(res, "/step/token");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderConversationStep(state));
    return;
  }
  if (method === "POST" && url.pathname === "/step/conversation") {
    if (!state.client) return redirectTo(res, "/step/token");
    await handleConversationStep(req, res, state);
    return;
  }

  if (method === "GET" && url.pathname === "/step/webhook-verify") {
    if (!state.conversationId) return redirectTo(res, "/step/conversation");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderWebhookVerifyStep(state));
    return;
  }
  if (method === "POST" && url.pathname === "/step/webhook-verify") {
    if (!state.conversationId) return redirectTo(res, "/step/conversation");
    await handleWebhookVerifyStep(req, res, state);
    return;
  }

  if (method === "GET" && url.pathname === "/step/time-clock") {
    if (!state.webhookVerified) return redirectTo(res, "/step/webhook-verify");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderTimeClockStep());
    return;
  }
  if (method === "POST" && url.pathname === "/step/time-clock") {
    if (!state.webhookVerified) return redirectTo(res, "/step/webhook-verify");
    await handleTimeClockStep(req, res, state);
    return;
  }

  if (method === "GET" && url.pathname === "/step/break-types") {
    if (!state.breaksConfig) return redirectTo(res, "/step/time-clock");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderBreakTypesStep(state));
    return;
  }
  if (method === "POST" && url.pathname === "/step/break-types") {
    if (!state.breaksConfig) return redirectTo(res, "/step/time-clock");
    await handleBreakTypesStep(req, res, state);
    return;
  }

  if (method === "GET" && url.pathname === "/step/relay-link") {
    if (!state.timeClockId) return redirectTo(res, "/step/time-clock");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderRelayLinkStep());
    return;
  }
  if (method === "POST" && url.pathname === "/step/relay-link") {
    if (!state.timeClockId) return redirectTo(res, "/step/time-clock");
    await handleRelayLinkStep(req, res, state, config);
    return;
  }

  if (method === "GET" && url.pathname === "/step/summary") {
    if (!state.adminEmail) return redirectTo(res, "/step/token");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderSummaryStep(state, url.searchParams.get("relayError") === "1"));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
  res.end(page("Not found", "<h1>Not found</h1>"));
}

function redirectTo(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}
