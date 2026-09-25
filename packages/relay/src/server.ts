import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { handleCallback, handleLogout, handleRequestLink, renderLoginPage, requireSession } from "./auth.js";
import { handleSaveChatLink, renderDashboard } from "./chatLink.js";
import type { RelayConfig } from "./config.js";
import { page } from "./html.js";
import { createMailer } from "./mailer.js";
import { RelayStore } from "./store.js";
import { handleConnecteamWebhook } from "./webhookReceiver.js";
import { handleWizardBootstrap } from "./wizardBootstrap.js";

export function startServer(config: RelayConfig): void {
  console.log(`Relay data file: ${config.dataPath}`);
  let store: RelayStore;
  try {
    store = new RelayStore(config.dataPath);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
  const mailer = createMailer(config);

  const server = createServer((req, res) => {
    void route(req, res, config, store, mailer).catch((err) => {
      console.error("Relay request failed:", err);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  server.listen(config.port, () => {
    console.log(`Relay listening on :${config.port} (${config.baseUrl})`);
  });
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  config: RelayConfig,
  store: RelayStore,
  mailer: ReturnType<typeof createMailer>,
): Promise<void> {
  const url = new URL(req.url ?? "/", config.baseUrl);
  const method = req.method ?? "GET";

  // Public: Connecteam's own webhook call. Never behind a session.
  if (method === "POST" && url.pathname === "/webhooks/connecteam") {
    await handleConnecteamWebhook(req, res, store);
    return;
  }

  // Public but narrow: the local setup wizard's one-time bootstrap, guarded
  // by its own shared-secret + loopback check (see wizardBootstrap.ts) since
  // there's no completed magic-link session on first run.
  if (method === "POST" && url.pathname === "/internal/wizard-bootstrap") {
    await handleWizardBootstrap(req, res, config, store);
    return;
  }

  if (method === "GET" && url.pathname === "/login") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderLoginPage(url.searchParams.get("sent") === "1"));
    return;
  }

  if (method === "POST" && url.pathname === "/auth/request-link") {
    await handleRequestLink(req, res, config, store, mailer);
    return;
  }

  if (method === "GET" && url.pathname === "/auth/callback") {
    handleCallback(req, res, config, store);
    return;
  }

  if (method === "POST" && url.pathname === "/logout") {
    handleLogout(req, res, config, store);
    return;
  }

  // Everything else requires a logged-in Admin.
  const email = requireSession(req, store);
  if (!email) {
    res.writeHead(302, { Location: "/login" });
    res.end();
    return;
  }

  if (method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderDashboard(email, store, url.searchParams.get("saved") === "1"));
    return;
  }

  if (method === "POST" && url.pathname === "/chat-link") {
    await handleSaveChatLink(req, res, store);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
  res.end(page("Not found", "<h1>Not found</h1>"));
}
