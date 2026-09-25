import { handleCallback, handleLogout, handleRequestLink, renderLoginPage, requireSession } from "./auth.js";
import { handleSaveChatLink, renderDashboard } from "./chatLink.js";
import { page } from "./html.js";
import { createMailer } from "./mailer.js";
import { RelayObject } from "./relayObject.js";
import { handleConnecteamWebhook } from "./webhookReceiver.js";

export { RelayObject };

export interface Env {
  RELAY: DurableObjectNamespace<RelayObject>;
}

/**
 * Cloudflare Worker port of the local Relay (`packages/relay`), per issue 14.
 * Same routes and behavior, adapted to the Fetch API and a single Durable
 * Object standing in for `relay.data.json`. No RELAY_BASE_URL config is
 * needed here, unlike the local version — a deployed Worker already knows
 * its own public origin from the incoming request.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const stub = env.RELAY.getByName("singleton");

    try {
      // Public: Connecteam's own webhook call. Never behind a session.
      if (method === "POST" && url.pathname === "/webhooks/connecteam") {
        return await handleConnecteamWebhook(request, stub, ctx);
      }

      if (method === "GET" && url.pathname === "/login") {
        return htmlResponse(200, renderLoginPage(url.searchParams.get("sent") === "1"));
      }

      if (method === "POST" && url.pathname === "/auth/request-link") {
        return await handleRequestLink(request, stub, createMailer(), url.origin);
      }

      if (method === "GET" && url.pathname === "/auth/callback") {
        return await handleCallback(request, stub, url.origin);
      }

      if (method === "POST" && url.pathname === "/logout") {
        return await handleLogout(request, stub, url.origin);
      }

      // Everything else requires a logged-in Admin.
      const email = await requireSession(request, stub);
      if (!email) {
        return new Response(null, { status: 302, headers: { Location: "/login" } });
      }

      if (method === "GET" && url.pathname === "/") {
        return htmlResponse(200, await renderDashboard(email, stub, url.searchParams.get("saved") === "1"));
      }

      if (method === "POST" && url.pathname === "/chat-link") {
        return await handleSaveChatLink(request, stub);
      }

      return htmlResponse(404, page("Not found", "<h1>Not found</h1>"));
    } catch (err) {
      console.error("Relay request failed:", err);
      return new Response(null, { status: 500 });
    }
  },
};

function htmlResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
