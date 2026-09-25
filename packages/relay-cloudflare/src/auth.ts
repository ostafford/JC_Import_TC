import { page } from "./html.js";
import { parseCookies } from "./http.js";
import type { Mailer } from "./mailer.js";
import type { RelayObject } from "./relayObject.js";

const SESSION_COOKIE = "relay_session";
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Relay login is magic-link email, no passwords (issue 06). v1 is
 * single-admin-per-deployment: the first successful login claims the
 * account; after that, only that email's requests actually get a link,
 * though the response is identical either way so this endpoint can't be
 * used to probe which email is the Admin.
 */
export async function handleRequestLink(
  request: Request,
  stub: DurableObjectStub<RelayObject>,
  mailer: Mailer,
  origin: string,
): Promise<Response> {
  const form = await request.formData();
  const email = form.get("email")?.toString().trim();

  if (email && isPlausibleEmail(email) && (await stub.isAuthorizedEmail(email))) {
    const token = await stub.createMagicLink(email, MAGIC_LINK_TTL_MS);
    const link = `${origin}/auth/callback?token=${token}`;
    await mailer.sendMagicLink(email, link);
  }

  return redirect("/login?sent=1");
}

export async function handleCallback(
  request: Request,
  stub: DurableObjectStub<RelayObject>,
  origin: string,
): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const email = token ? await stub.redeemMagicLink(token) : undefined;

  if (!email) {
    return htmlResponse(
      400,
      page("Sign-in link invalid", `<h1>This sign-in link is invalid or has expired</h1><p><a href="/login">Request a new one</a>.</p>`),
    );
  }

  if (!(await stub.isAuthorizedEmail(email))) {
    return htmlResponse(403, page("Not authorized", `<h1>This Relay is already linked to a different Admin</h1>`));
  }

  const session = await stub.createSession(email, SESSION_TTL_MS);
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": sessionCookie(session, SESSION_TTL_MS, origin),
    },
  });
}

export async function handleLogout(request: Request, stub: DurableObjectStub<RelayObject>, origin: string): Promise<Response> {
  const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  if (token) await stub.destroySession(token);
  return new Response(null, {
    status: 302,
    headers: { Location: "/login", "Set-Cookie": sessionCookie("", 0, origin) },
  });
}

/** Returns the logged-in Admin's email, or undefined if there's no valid session. */
export async function requireSession(request: Request, stub: DurableObjectStub<RelayObject>): Promise<string | undefined> {
  const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  return token ? await stub.getSessionEmail(token) : undefined;
}

export function renderLoginPage(sent: boolean): string {
  const notice = sent
    ? `<p class="notice">If that email is allowed to sign in, a link is on its way. Check your inbox (and <code>wrangler tail</code>, if no email provider is configured yet).</p>`
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

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function htmlResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/** A deployed Worker is always served over https, so the Secure flag is unconditional (unlike the local Relay, which checks its configured base URL). */
function sessionCookie(value: string, ttlMs: number, origin: string): string {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(ttlMs / 1000)}`,
  ];
  if (origin.startsWith("https://")) attrs.push("Secure");
  return attrs.join("; ");
}

function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
