export interface WizardConfig {
  port: number;
  relayBaseUrl: string;
  relayBootstrapUrl: string;
  wizardSetupToken: string;
}

function loadDotEnvIfPresent(): void {
  try {
    process.loadEnvFile();
  } catch {
    // no .env file present — fine, real environment variables may already be set
  }
}

export function loadWizardConfig(): WizardConfig {
  loadDotEnvIfPresent();

  const relayBaseUrl = (process.env.RELAY_BASE_URL ?? "http://localhost:8788").replace(/\/+$/, "");
  const wizardSetupToken = process.env.WIZARD_SETUP_TOKEN;
  if (!wizardSetupToken) {
    throw new Error(
      "Missing WIZARD_SETUP_TOKEN — set the same value in packages/wizard/.env and packages/relay/.env " +
        "(Phase A: set by hand; a later launcher will generate this fresh per run instead).",
    );
  }

  return {
    port: Number(process.env.PORT ?? 8789),
    relayBaseUrl,
    relayBootstrapUrl: `${relayBaseUrl}/internal/wizard-bootstrap`,
    wizardSetupToken,
  };
}
