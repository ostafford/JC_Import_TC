import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  asBreakTypeId,
  asConversationId,
  asPublisherId,
  asTimeClockId,
  type BreakTypeId,
  type ConversationId,
  type PublisherId,
  type TimeClockId,
} from "@sch-import/shared";

export interface ImporterConfig {
  apiToken: string;
  baseUrl?: string;
  webhookSharedSecret: string;
  port: number;
  conversationId: ConversationId;
  timeClockId: TimeClockId;
  /** A Custom Publisher ID (Settings -> Feed settings in Connecteam), not a real Employee's user ID. */
  senderId: PublisherId;
  manualBreaksEnabled: boolean;
  unpaidBreakTypeId?: BreakTypeId;
  paidBreakTypeId?: BreakTypeId;
}

/**
 * Written once by `importer setup` (issue 06/08). Deliberately excludes
 * secrets (API token, webhook shared secret) — those stay in .env, never in
 * this file, so it's safe to commit alongside the Importer if desired.
 */
export interface PersistedSetupConfig {
  conversationId: string;
  timeClockId: string;
  senderId: string;
  manualBreaksEnabled: boolean;
  unpaidBreakTypeId?: string;
  paidBreakTypeId?: string;
}

const DEFAULT_CONFIG_PATH = "./importer.config.json";

function loadDotEnvIfPresent(): void {
  try {
    process.loadEnvFile();
  } catch {
    // no .env file present — fine, real environment variables may already be set
  }
}

export function loadImporterConfig(): ImporterConfig {
  loadDotEnvIfPresent();

  const configPath = process.env.IMPORTER_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;
  if (!existsSync(configPath)) {
    throw new Error(`Missing ${configPath} — run \`importer setup\` first.`);
  }
  const persisted = JSON.parse(readFileSync(configPath, "utf8")) as PersistedSetupConfig;

  return {
    apiToken: requireEnv("CONNECTEAM_API_TOKEN"),
    baseUrl: process.env.CONNECTEAM_BASE_URL,
    webhookSharedSecret: requireEnv("WEBHOOK_SHARED_SECRET"),
    port: Number(process.env.PORT ?? 8787),
    conversationId: asConversationId(persisted.conversationId),
    timeClockId: asTimeClockId(persisted.timeClockId),
    senderId: asPublisherId(persisted.senderId),
    manualBreaksEnabled: persisted.manualBreaksEnabled,
    unpaidBreakTypeId: persisted.unpaidBreakTypeId ? asBreakTypeId(persisted.unpaidBreakTypeId) : undefined,
    paidBreakTypeId: persisted.paidBreakTypeId ? asBreakTypeId(persisted.paidBreakTypeId) : undefined,
  };
}

export function persistSetupConfig(config: PersistedSetupConfig, configPath = DEFAULT_CONFIG_PATH): void {
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
