import type { IncomingMessage, ServerResponse } from "node:http";
import { buildPersistedConfig, persistSetupConfig, writeImporterEnvFile } from "@sch-import/importer/dist/lib.js";
import { escapeHtml, page, parseFormBody } from "@sch-import/relay/dist/lib.js";
import { importerConfigPath, importerEnvPath } from "../paths.js";
import type { WizardConfig } from "../wizardConfig.js";
import type { WizardState } from "../wizardState.js";

export function renderRelayLinkStep(error?: string): string {
  return page(
    "Setup — Admin email",
    `<h1>Step 6 of 6 — link the Relay to this Importer</h1>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<p>This is a separate address from the Relay's own URL entered earlier — it's where <em>this Importer</em> receives the trigger the Relay forwards, so it needs to be reachable from the Relay too (today, that means its own running tunnel).</p>
<form method="post" action="/step/relay-link">
  <label for="importerEndpointUrl">This Importer's public webhook endpoint URL</label>
  <input type="url" id="importerEndpointUrl" name="importerEndpointUrl" placeholder="https://your-other-tunnel-url/trigger" required>

  <label for="adminEmail">Your email</label>
  <input type="email" id="adminEmail" name="adminEmail" required>
  <p class="hint">Becomes the Admin who can log into the Relay's dashboard later (magic-link, no password).</p>

  <button type="submit">Finish setup</button>
</form>`,
  );
}

export async function handleRelayLinkStep(
  req: IncomingMessage,
  res: ServerResponse,
  state: WizardState,
  wizardConfig: WizardConfig,
): Promise<void> {
  const form = await parseFormBody(req);
  const adminEmail = form.adminEmail?.trim();
  const importerEndpointUrl = form.importerEndpointUrl?.trim();

  if (!adminEmail || !importerEndpointUrl) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderRelayLinkStep("Enter both this Importer's endpoint URL and your email."));
    return;
  }

  // Write the Importer's own config/secrets first — purely local, can't fail
  // because of anything the Relay does.
  persistSetupConfig(
    buildPersistedConfig({
      conversationId: state.conversationId!,
      senderId: state.senderId!,
      timeClocks: state.timeClockResults!,
    }),
    importerConfigPath,
  );
  writeImporterEnvFile(
    { CONNECTEAM_API_TOKEN: state.apiToken!, WEBHOOK_SHARED_SECRET: state.webhookSharedSecret! },
    importerEnvPath,
  );

  // Then bootstrap the Relay over loopback — this is the piece that reaches
  // the *running* Relay process directly, avoiding the stale-in-memory-state
  // problem a direct relay.data.json write from this process would have.
  let bootstrapOk: boolean;
  try {
    const response = await fetch(wizardConfig.relayBootstrapUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-wizard-setup-token": wizardConfig.wizardSetupToken },
      body: JSON.stringify({
        adminEmail,
        conversationId: state.conversationId,
        importerEndpointUrl,
        sharedSecret: state.webhookSharedSecret,
        connecteamWebhookSecret: state.connecteamWebhookSecret,
      }),
    });
    bootstrapOk = response.ok;
  } catch {
    bootstrapOk = false;
  }

  state.adminEmail = adminEmail;

  res.writeHead(302, { Location: bootstrapOk ? "/step/summary" : "/step/summary?relayError=1" });
  res.end();
}
