import { DurableObject } from "cloudflare:workers";
import { randomToken } from "./crypto.js";
import type { Env } from "./index.js";
import { asConversationId, type ConversationId } from "./vocabulary.js";

export interface ChatLink {
  conversationId: ConversationId;
  /** This Admin's own Importer's public webhook-receiver URL (from `importer setup`, issue 06). */
  importerEndpointUrl: string;
  /** Shared secret from `importer setup` — signs every trigger the Relay forwards to the Importer (issue 06). */
  sharedSecret: string;
  /** The `secretKey` Connecteam echoes back as `x-webhook-secret` on every delivery (issue 06). */
  connecteamWebhookSecret: string;
}

interface ChatLinkRow extends Record<string, SqlStorageValue> {
  conversation_id: string;
  importer_endpoint_url: string;
  shared_secret: string;
  connecteam_webhook_secret: string;
}

/**
 * Cloudflare replacement for the local Relay's `relay.data.json` (issue 14).
 * One instance per deployment, addressed by a fixed name (`index.ts`'s
 * `getByName("singleton")`) — there's no multi-tenancy to shard within a
 * single company's own self-hosted Relay (ADR 0001/issue 13), so this is
 * just the simplest strongly-consistent single-record store available, not
 * the multi-tenant-coordination use case Durable Objects are usually pitched
 * for. SQLite-backed storage (free-tier viable, issue 14's fact-check).
 */
export class RelayObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS admin (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        email TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_link (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        conversation_id TEXT NOT NULL,
        importer_endpoint_url TEXT NOT NULL,
        shared_secret TEXT NOT NULL,
        connecteam_webhook_secret TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS magic_links (
        token TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
  }

  getAdminEmail(): string | undefined {
    const row = this.ctx.storage.sql.exec<{ email: string }>("SELECT email FROM admin WHERE id = 1").toArray()[0];
    return row?.email;
  }

  /** True if `email` is allowed to log in: nobody has claimed the account yet, or it's the Admin who did. */
  isAuthorizedEmail(email: string): boolean {
    const admin = this.getAdminEmail();
    return admin === undefined || admin.toLowerCase() === email.toLowerCase();
  }

  private claimAdminEmailIfUnset(email: string): void {
    if (this.getAdminEmail() === undefined) {
      this.ctx.storage.sql.exec("INSERT OR REPLACE INTO admin (id, email) VALUES (1, ?)", email);
    }
  }

  claimAdminEmail(email: string): void {
    this.claimAdminEmailIfUnset(email);
  }

  getChatLink(): ChatLink | undefined {
    const row = this.ctx.storage.sql.exec<ChatLinkRow>("SELECT * FROM chat_link WHERE id = 1").toArray()[0];
    if (!row) return undefined;
    return {
      conversationId: asConversationId(row.conversation_id),
      importerEndpointUrl: row.importer_endpoint_url,
      sharedSecret: row.shared_secret,
      connecteamWebhookSecret: row.connecteam_webhook_secret,
    };
  }

  setChatLink(link: ChatLink): void {
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO chat_link (id, conversation_id, importer_endpoint_url, shared_secret, connecteam_webhook_secret)
       VALUES (1, ?, ?, ?, ?)`,
      link.conversationId,
      link.importerEndpointUrl,
      link.sharedSecret,
      link.connecteamWebhookSecret,
    );
  }

  createMagicLink(email: string, ttlMs: number): string {
    this.gc();
    const token = randomToken();
    this.ctx.storage.sql.exec(
      "INSERT INTO magic_links (token, email, expires_at) VALUES (?, ?, ?)",
      token,
      email,
      Date.now() + ttlMs,
    );
    return token;
  }

  /** Single-use: valid tokens are consumed on redemption regardless of outcome. */
  redeemMagicLink(token: string): string | undefined {
    const row = this.ctx.storage.sql
      .exec<{ email: string; expires_at: number }>("SELECT email, expires_at FROM magic_links WHERE token = ?", token)
      .toArray()[0];
    this.ctx.storage.sql.exec("DELETE FROM magic_links WHERE token = ?", token);
    if (!row || row.expires_at < Date.now()) return undefined;
    this.claimAdminEmailIfUnset(row.email);
    return row.email;
  }

  createSession(email: string, ttlMs: number): string {
    this.gc();
    const token = randomToken();
    this.ctx.storage.sql.exec(
      "INSERT INTO sessions (token, email, expires_at) VALUES (?, ?, ?)",
      token,
      email,
      Date.now() + ttlMs,
    );
    return token;
  }

  getSessionEmail(token: string): string | undefined {
    const row = this.ctx.storage.sql
      .exec<{ email: string; expires_at: number }>("SELECT email, expires_at FROM sessions WHERE token = ?", token)
      .toArray()[0];
    if (!row || row.expires_at < Date.now()) return undefined;
    return row.email;
  }

  destroySession(token: string): void {
    this.ctx.storage.sql.exec("DELETE FROM sessions WHERE token = ?", token);
  }

  /** Drops expired magic links / sessions so the table doesn't grow unbounded. */
  private gc(): void {
    const now = Date.now();
    this.ctx.storage.sql.exec("DELETE FROM magic_links WHERE expires_at < ?", now);
    this.ctx.storage.sql.exec("DELETE FROM sessions WHERE expires_at < ?", now);
  }
}
