import type { IncomingMessage, ServerResponse } from "node:http";
import type { RelayConfig } from "./config.js";
import { page } from "./html.js";
import { parseCookies, parseFormBody } from "./http.js";
import type { Mailer } from "./mailer.js";
import type { RelayStore } from "./store.js";

const SESSION_COOKIE = "relay_session";

/**
 * Relay login is magic-link email, no passwords (issue 06). v1 is
 * single-admin-per-deployment: the first successful login claims the
 * account (RelayStore.redeemMagicLink); after that, only that email's
 * requests actually get a link, though the response is identical either way
 * so this endpoint can't be used to probe which email is the Admin.
 */
export async function handleRequestLink(
  req: IncomingMessage,
  res: ServerResponse,
  config: RelayConfig,
  store: RelayStore,
  mailer: Mailer,
): Promise<void> {
  const form = await parseFormBody(req);
  const email = form.email?.trim();

  if (email && isPlausibleEmail(email) && store.isAuthorizedEmail(email)) {
    const token = store.createMagicLink(email, config.magicLinkTtlMs);
    const link = `${config.baseUrl}/auth/callback?token=${token}`;
    await mailer.sendMagicLink(email, link);
  }

  redirect(res, "/login?sent=1");
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}

export function handleCallback(req: IncomingMessage, res: ServerResponse, config: RelayConfig, store: RelayStore): void {
  const url = new URL(req.url ?? "", config.baseUrl);
  const token = url.searchParams.get("token");
  const email = token ? store.redeemMagicLink(token) : undefined;

  if (!email) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page("Sign-in link invalid", `<h1>This sign-in link is invalid or has expired</h1><p><a href="/login">Request a new one</a>.</p>`));
    return;
  }

  if (!store.isAuthorizedEmail(email)) {
    res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page("Not authorized", `<h1>This Relay is already linked to a different Admin</h1>`));
    return;
  }

  const session = store.createSession(email, config.sessionTtlMs);
  res.writeHead(302, {
    Location: "/",
    "Set-Cookie": sessionCookie(config, session, config.sessionTtlMs),
  });
  res.end();
}

export function handleLogout(req: IncomingMessage, res: ServerResponse, config: RelayConfig, store: RelayStore): void {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) store.destroySession(token);
  res.writeHead(302, { Location: "/login", "Set-Cookie": sessionCookie(config, "", 0) });
  res.end();
}

/** Returns the logged-in Admin's email, or undefined if there's no valid session. */
export function requireSession(req: IncomingMessage, store: RelayStore): string | undefined {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  return token ? store.getSessionEmail(token) : undefined;
}

export function renderLoginPage(sent: boolean): string {
  const notice = sent
    ? `<p class="notice">If that email is allowed to sign in, a link is on its way. Check your inbox (and the Relay's server logs, if SMTP isn't configured yet).</p>`
    : "";
  return page(
    "Sign in — Relay",
    `<h1>Sign in to the Relay</h1>
${notice}
<form method="post" action="/auth/request-link">
  <label for="email">Email</label>
  <input type="email" id="email" name="email" required autofocus>
  <button type="submit">Send sign-in link</button>
</form>
<p class="hint">No password — we'll email you a one-time link instead.</p>`,
  );
}

function sessionCookie(config: RelayConfig, value: string, ttlMs: number): string {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(ttlMs / 1000)}`,
  ];
  if (config.baseUrl.startsWith("https://")) attrs.push("Secure");
  return attrs.join("; ");
}

function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
