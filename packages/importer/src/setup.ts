import { createInterface } from "node:readline/promises";
import { ConnecteamClient, type ManualBreakType } from "@sch-import/shared";
import { persistSetupConfig } from "./config.js";
import { buildPersistedConfig, generateWebhookSecrets } from "./setupSteps.js";

/**
 * The one-time `importer setup` step (issue 06 + issue 08). Runs with the
 * Admin's own token because finding a conversation's ID, scoping a webhook to
 * it, and reading manual-break config all require a token the Relay never
 * holds (ADR 0001). Produces everything the Admin needs to paste into the
 * Relay's Chat Link form, plus this Importer's own local config/secret.
 */
export async function runSetup(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // no .env yet — fine, this step can prompt for the token directly
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const apiToken = process.env.CONNECTEAM_API_TOKEN ?? (await rl.question("Connecteam API token: "));
    const client = new ConnecteamClient({ apiToken, baseUrl: process.env.CONNECTEAM_BASE_URL });

    console.log("\nFetching your Connecteam conversations...");
    const conversations = await client.listConversations();
    if (conversations.length === 0) throw new Error("No conversations returned — nothing to link.");
    conversations.forEach((c, i) => console.log(`  [${i}] ${c.name ?? "(untitled)"} — ${c.conversationId}`));
    const chosen = conversations[Number(await rl.question("\nPick the conversation to link (index): "))];
    if (!chosen) throw new Error("Invalid selection");

    const relayWebhookUrl = await rl.question("Relay's public webhook-receiver URL: ");
    const { connecteamWebhookSecret, webhookSharedSecret } = generateWebhookSecrets();
    console.log("Creating a webhook scoped to this conversation...");
    await client.createConversationWebhook(chosen.conversationId, relayWebhookUrl, connecteamWebhookSecret);

    console.log("\nFetching your Connecteam time clocks...");
    const timeClocks = await client.listTimeClocks();
    if (timeClocks.length === 0) throw new Error("No time clocks returned — nothing to write Time Activities to.");
    timeClocks.forEach((tc, i) => console.log(`  [${i}] ${tc.name}${tc.isArchived ? " (archived)" : ""}`));
    const chosenTimeClock = timeClocks[Number(await rl.question("\nPick the Time Clock to write to (index): "))];
    if (!chosenTimeClock) throw new Error("Invalid selection");
    const timeClockId = chosenTimeClock.timeClockId;
    console.log(
      "\nChat confirmations post as a Custom Publisher, not as you — Connecteam's Chat API requires it " +
        "(confirmed 2026-09-22, corrects this project's original assumption). If you haven't already, create " +
        "one now: Connecteam admin -> Settings -> Feed settings -> Custom Publishers -> Add Custom Publisher, " +
        "then note its integer Publisher ID.",
    );
    const senderId = await rl.question("Custom Publisher ID (used as this Importer's chat sender): ");

    console.log("\nReading manual break configuration...");
    const breaksConfig = await client.getManualBreaksConfig(timeClockId);

    let unpaidBreakTypeId: string | undefined;
    let paidBreakTypeId: string | undefined;

    if (!breaksConfig.areManualBreaksEnabled) {
      console.log("Manual breaks are disabled for this account — break-writing will be skipped entirely.");
    } else {
      unpaidBreakTypeId = await pickBreakType(rl, "unpaid", breaksConfig.breakTypes.filter((b) => !b.isPaid));
      paidBreakTypeId = await pickBreakType(rl, "paid", breaksConfig.breakTypes.filter((b) => b.isPaid));
    }

    persistSetupConfig(
      buildPersistedConfig({
        conversationId: chosen.conversationId,
        timeClockId,
        senderId,
        manualBreaksEnabled: breaksConfig.areManualBreaksEnabled,
        unpaidBreakTypeId,
        paidBreakTypeId,
      }),
    );

    console.log("\nSetup complete — importer.config.json written with:");
    console.log(`  conversationId:      ${chosen.conversationId}`);
    console.log(`  timeClockId:         ${timeClockId}`);
    console.log(`  senderId:            ${senderId}`);
    console.log(`  manualBreaksEnabled: ${breaksConfig.areManualBreaksEnabled}`);
    if (unpaidBreakTypeId) console.log(`  unpaidBreakTypeId:   ${unpaidBreakTypeId}`);
    if (paidBreakTypeId) console.log(`  paidBreakTypeId:     ${paidBreakTypeId}`);

    console.log("\nIf running the Importer locally: add this to its .env (never commit it):");
    console.log(`  WEBHOOK_SHARED_SECRET=${webhookSharedSecret}`);

    console.log(
      "\nIf deploying the Importer to Cloudflare instead: every value printed above becomes a Worker var, " +
        "and WEBHOOK_SHARED_SECRET (plus your Connecteam API token) becomes a Worker secret — see README.md's " +
        '"Deploying to Cloudflare" section for exactly where each one goes.',
    );

    console.log("\nEither way, paste these into the Relay's Chat Link form:");
    console.log(`  Conversation ID:          ${chosen.conversationId}`);
    console.log("  Importer endpoint URL:    <this Importer's own public webhook URL>");
    console.log(`  Shared secret:            ${webhookSharedSecret}`);
    console.log(`  Connecteam webhook secret: ${connecteamWebhookSecret}`);
  } finally {
    rl.close();
  }
}

async function pickBreakType(
  rl: ReturnType<typeof createInterface>,
  category: "unpaid" | "paid",
  types: ManualBreakType[],
): Promise<string> {
  if (types.length === 0) {
    throw new Error(`No ${category} Break Types configured in Connecteam — configure one first, then re-run setup.`);
  }
  console.log(`\nPick a default ${category} Break Type (its label only — actual duration always comes from the export):`);
  types.forEach((t, i) => console.log(`  [${i}] ${t.name} (default ${t.duration}m)`));
  const chosen = types[Number(await rl.question(`Default ${category} Break Type (index): `))];
  if (!chosen) throw new Error("Invalid selection");
  return chosen.id;
}
