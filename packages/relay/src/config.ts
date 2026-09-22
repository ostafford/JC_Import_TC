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
  };
}
