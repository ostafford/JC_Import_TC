import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { asConversationId, type ConversationId } from "@sch-import/shared";

export interface ChatLink {
  conversationId: ConversationId;
  /** This Admin's own Importer's public webhook-receiver URL (from `importer setup`, issue 06). */
  importerEndpointUrl: string;
  /** Shared secret from `importer setup` — signs every trigger the Relay forwards to the Importer (issue 06). */
  sharedSecret: string;
  /**
   * The `secretKey` given to Connecteam when `importer setup` created the chat
   * webhook — Connecteam echoes it back in every delivery's `x-webhook-secret`
   * header, confirmed via developer.connecteam.com (2026-09-22). Lets the Relay
   * verify an inbound call actually came from Connecteam before acting on it.
   */
  connecteamWebhookSecret: string;
}

interface PersistedState {
  /**
   * Set on the first successful login (issue 06: "whichever Admin's email first
   * sets it up is the one who can log in and manage it" — v1 is single-admin-per-deployment).
   */
  adminEmail?: string;
  chatLink?: ChatLink;
  magicLinks: Record<string, { email: string; expiresAt: number }>;
  sessions: Record<string, { email: string; expiresAt: number }>;
}

function emptyState(): PersistedState {
  return { magicLinks: {}, sessions: {} };
}

/**
 * The Relay's entire data store (map.md: "likely doesn't need a full database" —
 * issue 10 leaves hosting open, but the state itself is just a handful of
 * fields). Single JSON file, matching the Importer's own importer.config.json
 * convention. Never holds a Connecteam token or Schedule Export content (ADR 0001).
 */
export class RelayStore {
  private state: PersistedState;

  constructor(private readonly path: string) {
    this.state = this.load();
  }

  private load(): PersistedState {
    if (!existsSync(this.path)) return emptyState();
    const raw = JSON.parse(readFileSync(this.path, "utf8")) as Partial<PersistedState>;
    return { ...emptyState(), ...raw };
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.state, null, 2) + "\n", "utf8");
  }

  getAdminEmail(): string | undefined {
    return this.state.adminEmail;
  }

  /** True if `email` is allowed to log in: nobody has claimed the account yet, or it's the Admin who did. */
  isAuthorizedEmail(email: string): boolean {
    const admin = this.state.adminEmail;
    return admin === undefined || admin.toLowerCase() === email.toLowerCase();
  }

  private claimAdminEmailIfUnset(email: string): void {
    if (this.state.adminEmail === undefined) {
      this.state.adminEmail = email;
    }
  }

  /**
   * Public entry point for the setup wizard's bootstrap call (which never
   * goes through the magic-link flow) to seed the Admin who can later log in.
   * Same semantics as the private `claimAdminEmailIfUnset` used internally by
   * `redeemMagicLink` — first email wins, already-claimed accounts are a
   * no-op — but persists immediately since there's no other write in the
   * same request to piggyback the save on.
   */
  claimAdminEmail(email: string): void {
    this.claimAdminEmailIfUnset(email);
    this.save();
  }

  getChatLink(): ChatLink | undefined {
    return this.state.chatLink;
  }

  setChatLink(link: ChatLink): void {
    this.state.chatLink = link;
    this.save();
  }

  createMagicLink(email: string, ttlMs: number): string {
    this.gc();
    const token = randomBytes(32).toString("hex");
    this.state.magicLinks[token] = { email, expiresAt: Date.now() + ttlMs };
    this.save();
    return token;
  }

  /** Single-use: valid tokens are consumed on redemption regardless of outcome. */
  redeemMagicLink(token: string): string | undefined {
    const entry = this.state.magicLinks[token];
    delete this.state.magicLinks[token];
    this.save();
    if (!entry || entry.expiresAt < Date.now()) return undefined;
    this.claimAdminEmailIfUnset(entry.email);
    return entry.email;
  }

  createSession(email: string, ttlMs: number): string {
    this.gc();
    const token = randomBytes(32).toString("hex");
    this.state.sessions[token] = { email, expiresAt: Date.now() + ttlMs };
    this.save();
    return token;
  }

  getSessionEmail(token: string): string | undefined {
    const entry = this.state.sessions[token];
    if (!entry || entry.expiresAt < Date.now()) return undefined;
    return entry.email;
  }

  destroySession(token: string): void {
    delete this.state.sessions[token];
    this.save();
  }

  /** Drops expired magic links / sessions so the file doesn't grow unbounded. */
  private gc(): void {
    const now = Date.now();
    for (const [token, entry] of Object.entries(this.state.magicLinks)) {
      if (entry.expiresAt < now) delete this.state.magicLinks[token];
    }
    for (const [token, entry] of Object.entries(this.state.sessions)) {
      if (entry.expiresAt < now) delete this.state.sessions[token];
    }
  }
}

export function chatLinkFromForm(input: {
  conversationId: string;
  importerEndpointUrl: string;
  sharedSecret: string;
  connecteamWebhookSecret: string;
}): ChatLink {
  return {
    conversationId: asConversationId(input.conversationId),
    importerEndpointUrl: input.importerEndpointUrl,
    sharedSecret: input.sharedSecret,
    connecteamWebhookSecret: input.connecteamWebhookSecret,
  };
}
