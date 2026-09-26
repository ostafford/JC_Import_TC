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

/** One configured Time Clock this Importer may route an Import Run to (multi-time-clock-routing map). */
export interface TimeClockSetupEntry {
  timeClockId: string;
  name: string;
  manualBreaksEnabled: boolean;
  unpaidBreakTypeId?: string;
  paidBreakTypeId?: string;
}

export interface ResolvedTimeClock {
  timeClockId: TimeClockId;
  name: string;
  manualBreaksEnabled: boolean;
  unpaidBreakTypeId?: BreakTypeId;
  paidBreakTypeId?: BreakTypeId;
}

export interface ImporterConfig {
  apiToken: string;
  baseUrl?: string;
  webhookSharedSecret: string;
  port: number;
  conversationId: ConversationId;
  /** A Custom Publisher ID (Settings -> Feed settings in Connecteam), not a real Employee's user ID. */
  senderId: PublisherId;
  timeClocks: ResolvedTimeClock[];
}

/**
 * Written once by `importer setup` (issue 06/08, extended for multiple Time
 * Clocks by the multi-time-clock-routing map). Deliberately excludes
 * secrets (API token, webhook shared secret) — those stay in .env, never in
 * this file, so it's safe to commit alongside the Importer if desired.
 *
 * Breaking change from the original single-Time-Clock schema — no migration
 * (this project has no client deployments yet); re-run `importer setup`.
 */
export interface PersistedSetupConfig {
  conversationId: string;
  senderId: string;
  timeClocks: TimeClockSetupEntry[];
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
    senderId: asPublisherId(persisted.senderId),
    timeClocks: persisted.timeClocks.map((tc) => ({
      timeClockId: asTimeClockId(tc.timeClockId),
      name: tc.name,
      manualBreaksEnabled: tc.manualBreaksEnabled,
      unpaidBreakTypeId: tc.unpaidBreakTypeId ? asBreakTypeId(tc.unpaidBreakTypeId) : undefined,
      paidBreakTypeId: tc.paidBreakTypeId ? asBreakTypeId(tc.paidBreakTypeId) : undefined,
    })),
  };
}

export function persistSetupConfig(config: PersistedSetupConfig, configPath = DEFAULT_CONFIG_PATH): void {
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

/**
 * Used by `importer setup` to detect an existing config and offer to add a
 * Time Clock rather than always starting over. Deliberately doesn't touch
 * env vars (unlike `loadImporterConfig`) — setup itself is what establishes
 * `.env`, so requiring it here would be circular.
 */
export function loadPersistedConfigIfPresent(configPath = DEFAULT_CONFIG_PATH): PersistedSetupConfig | undefined {
  if (!existsSync(configPath)) return undefined;
  return JSON.parse(readFileSync(configPath, "utf8")) as PersistedSetupConfig;
}

/**
 * Writes secrets into `.env` directly instead of printing them for the Admin
 * to paste in by hand (the wizard's replacement for `setup.ts`'s old
 * console.log-and-copy step). Merges into any existing file in place —
 * replaces matching `KEY=` lines, appends new keys, leaves comments and any
 * hand-added keys (e.g. `CONNECTEAM_BASE_URL`) untouched.
 */
export function writeImporterEnvFile(values: Record<string, string>, path = ".env"): void {
  const existingLines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  const remainingKeys = new Set(Object.keys(values));

  const updatedLines = existingLines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (match && remainingKeys.has(match[1])) {
      const key = match[1];
      remainingKeys.delete(key);
      return `${key}=${values[key]}`;
    }
    return line;
  });

  while (updatedLines.length > 0 && updatedLines[updatedLines.length - 1] === "") {
    updatedLines.pop();
  }
  for (const key of remainingKeys) {
    updatedLines.push(`${key}=${values[key]}`);
  }

  writeFileSync(path, updatedLines.join("\n") + "\n", "utf8");
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
