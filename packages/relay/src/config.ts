import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export interface RelayConfig {
  port: number;
  /** Public origin the Relay is reachable at — used to build magic-link URLs and the cookie's Secure flag. */
  baseUrl: string;
  dataPath: string;
  magicLinkTtlMs: number;
  sessionTtlMs: number;
  /** Unset means the console mailer is used (logs the magic link instead of emailing it) — fine for local/dev use. */
  smtp?: SmtpConfig;
  /**
   * Shared secret the setup wizard's `/internal/wizard-bootstrap` route
   * checks before accepting a Chat Link on the Relay's behalf, bypassing the
   * normal magic-link session gate (there's no completed login yet on first
   * run). Unset means that route always rejects — Phase A wires this by hand
   * into both processes' `.env`; a later launcher will generate one fresh
   * per run instead.
   */
  wizardSetupToken?: string;
}

function loadDotEnvIfPresent(): void {
  try {
    process.loadEnvFile();
  } catch {
    // no .env file present — fine, real environment variables may already be set
  }
}

export function loadRelayConfig(): RelayConfig {
  loadDotEnvIfPresent();

  const baseUrl = (process.env.RELAY_BASE_URL ?? "http://localhost:8788").replace(/\/+$/, "");
  const smtpHost = process.env.SMTP_HOST;
  const smtp: SmtpConfig | undefined = smtpHost
    ? {
        host: smtpHost,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === "true",
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
        from: process.env.SMTP_FROM ?? `relay@${new URL(baseUrl).hostname}`,
      }
    : undefined;

  return {
    port: Number(process.env.PORT ?? 8788),
    baseUrl,
    dataPath: process.env.RELAY_DATA_PATH ?? "./relay.data.json",
    magicLinkTtlMs: 15 * 60 * 1000,
    sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
    smtp,
    wizardSetupToken: process.env.WIZARD_SETUP_TOKEN,
  };
}

/**
 * Writes values into `.env` directly — used so far only by the setup wizard,
 * which needs the Relay's `RELAY_BASE_URL` and (later, Phase B) a Cloudflare
 * tunnel token written without a human copy-pasting them. Merges into any
 * existing file in place, matching `writeImporterEnvFile`'s behavior in
 * `packages/importer/src/config.ts`.
 */
export function writeRelayEnvFile(values: Record<string, string>, path = ".env"): void {
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
