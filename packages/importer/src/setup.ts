import { createInterface } from "node:readline/promises";
import { ConnecteamClient, type ManualBreakType, type TimeClock } from "@sch-import/shared";
import { loadPersistedConfigIfPresent, persistSetupConfig, type PersistedSetupConfig, type TimeClockSetupEntry } from "./config.js";
import { buildPersistedConfig, generateWebhookSecrets } from "./setupSteps.js";
import { color, heading, muted, success, warn } from "./cliColor.js";

type Rl = ReturnType<typeof createInterface>;

/**
 * The one-time `importer setup` step (issue 06 + issue 08), extended for
 * multiple Time Clocks by the multi-time-clock-routing map. Runs with the
 * Admin's own token because finding a conversation's ID, scoping a webhook to
 * it, and reading manual-break config all require a token the Relay never
 * holds (ADR 0001). Produces everything the Admin needs to paste into the
 * Relay's Chat Link form, plus this Importer's own local config/secret.
 *
 * If `importer.config.json` already exists, offers to add a Time Clock
 * instead of always redoing the conversation/webhook/Custom-Publisher setup
 * — validated live via a prototype (branch `prototype/setup-ux-multi-timeclock`).
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

    const existing = loadPersistedConfigIfPresent();
    if (existing) {
      await runOnExistingConfig(rl, client, existing);
    } else {
      await runFromScratch(rl, client);
    }
  } finally {
    rl.close();
  }
}

/**
 * Adding a Time Clock deliberately never touches the conversation, webhook,
 * or Custom Publisher — those live on the Relay's Chat Link form already and
 * recreating the webhook here would mint a new secret that invalidates it.
 * "Reconfigure everything" is the explicit escape hatch when that's really
 * what's wanted.
 */
async function runOnExistingConfig(rl: Rl, client: ConnecteamClient, existing: PersistedSetupConfig): Promise<void> {
  heading("Existing importer.config.json found");
  console.log("Already configured for:");
  existing.timeClocks.forEach((tc, i) => console.log(`  ${color.magenta(`[${i}]`)} ${tc.name}`));

  const choice = (
    await rl.question(
      `\n${color.bold("[a]")} Add one more Time Clock   ${color.bold("[b]")} Reconfigure everything from scratch   ${color.bold("[c]")} Cancel\n> `,
    )
  )
    .trim()
    .toLowerCase();

  if (choice === "c") {
    warn("Cancelled — config unchanged.");
    return;
  }
  if (choice === "b") {
    await runFromScratch(rl, client);
    return;
  }

  heading("Fetching your Connecteam time clocks...");
  const timeClocks = await client.listTimeClocks();
  const alreadyConfigured = new Set(existing.timeClocks.map((tc) => tc.timeClockId));
  const available = timeClocks.filter((tc) => !alreadyConfigured.has(tc.timeClockId) && !tc.isArchived);
  if (available.length === 0) {
    warn("Every Time Clock on this account is already configured (or archived) — nothing to add.");
    return;
  }
  available.forEach((tc, i) => console.log(`  ${color.magenta(`[${i}]`)} ${tc.name}`));
  const picked = available[Number(await rl.question("\nAdd which Time Clock (index): "))];
  if (!picked) throw new Error("Invalid selection");

  const entry = await configureBreaksForTimeClock(rl, client, picked);
  const timeClocks2 = [...existing.timeClocks, entry];
  persistSetupConfig(
    buildPersistedConfig({ conversationId: existing.conversationId, senderId: existing.senderId, timeClocks: timeClocks2 }),
  );

  success(`\n✓ Added ${picked.name} — this Importer now routes across ${timeClocks2.length} Time Clock(s).`);
  printTimeClocksSummary(timeClocks2);
}

async function runFromScratch(rl: Rl, client: ConnecteamClient): Promise<void> {
  heading("Fetching your Connecteam conversations...");
  const conversations = await client.listConversations();
  if (conversations.length === 0) throw new Error("No conversations returned — nothing to link.");
  conversations.forEach((c, i) =>
    console.log(`  ${color.magenta(`[${i}]`)} ${c.name ?? "(untitled)"} — ${color.dim(c.conversationId)}`),
  );
  const chosen = conversations[Number(await rl.question("\nPick the conversation to link (index): "))];
  if (!chosen) throw new Error("Invalid selection");

  const relayWebhookUrl = await rl.question("Relay's public webhook-receiver URL: ");
  const { connecteamWebhookSecret, webhookSharedSecret } = generateWebhookSecrets();
  muted("Creating a webhook scoped to this conversation...");
  await client.createConversationWebhook(chosen.conversationId, relayWebhookUrl, connecteamWebhookSecret);

  heading("Fetching your Connecteam time clocks...");
  const timeClocks = await client.listTimeClocks();
  if (timeClocks.length === 0) throw new Error("No time clocks returned — nothing to write Time Activities to.");
  timeClocks.forEach((tc, i) =>
    console.log(`  ${color.magenta(`[${i}]`)} ${tc.name}${tc.isArchived ? color.dim(" (archived)") : ""}`),
  );
  const rawIndices = await rl.question(
    "\nPick every Time Clock this Importer should route Import Runs across (comma-separated indices, e.g. 0,1): ",
  );
  const chosenTimeClocks = rawIndices
    .split(",")
    .map((s) => Number(s.trim()))
    .map((i) => timeClocks[i])
    .filter((tc): tc is TimeClock => Boolean(tc));
  if (chosenTimeClocks.length === 0) throw new Error("Pick at least one Time Clock.");

  console.log(
    "\nChat confirmations post as a Custom Publisher, not as you — Connecteam's Chat API requires it " +
      "(confirmed 2026-09-22, corrects this project's original assumption). If you haven't already, create " +
      "one now: Connecteam admin -> Settings -> Feed settings -> Custom Publishers -> Add Custom Publisher, " +
      "then note its integer Publisher ID.",
  );
  const senderId = await rl.question("Custom Publisher ID (used as this Importer's chat sender): ");

  const entries: TimeClockSetupEntry[] = [];
  for (const tc of chosenTimeClocks) {
    heading(`=== ${tc.name} ===`);
    entries.push(await configureBreaksForTimeClock(rl, client, tc));
  }

  persistSetupConfig(buildPersistedConfig({ conversationId: chosen.conversationId, senderId, timeClocks: entries }));

  heading("Setup complete");
  printTimeClocksSummary(entries);

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
}

async function configureBreaksForTimeClock(rl: Rl, client: ConnecteamClient, tc: TimeClock): Promise<TimeClockSetupEntry> {
  muted(`\n  Reading manual break configuration for ${color.bold(tc.name)}...`);
  const breaksConfig = await client.getManualBreaksConfig(tc.timeClockId);

  if (!breaksConfig.areManualBreaksEnabled) {
    warn(`  ⚠ Manual breaks are disabled for ${color.bold(tc.name)} — break-writing will be skipped for this Time Clock only.`);
    return { timeClockId: tc.timeClockId, name: tc.name, manualBreaksEnabled: false };
  }

  const unpaidBreakTypeId = await pickBreakType(
    rl,
    tc.name,
    "unpaid",
    breaksConfig.breakTypes.filter((b) => !b.isPaid),
  );
  const paidBreakTypeId = await pickBreakType(
    rl,
    tc.name,
    "paid",
    breaksConfig.breakTypes.filter((b) => b.isPaid),
  );
  success(`  ✓ ${tc.name} configured`);

  return { timeClockId: tc.timeClockId, name: tc.name, manualBreaksEnabled: true, unpaidBreakTypeId, paidBreakTypeId };
}

/**
 * Not every Time Clock with manual breaks enabled has both a paid and an
 * unpaid Break Type configured (discovered live, 2026-09-26, running the
 * multi-Time-Clock setup flow against a real account — "Xero v1" here has
 * only an unpaid one). Originally a hard error, matching the assumption a
 * single-Time-Clock setup could get away with; multiplied across several
 * Time Clocks in one run, aborting the whole setup over one missing
 * category threw away every Time Clock already configured that run. The
 * pipeline (`importRun.ts`'s `writeRow`) already treats a missing Break
 * Type ID as "skip that category for this Time Clock" — this just stops
 * fighting that and does the same at setup time: warn, skip, keep going.
 */
async function pickBreakType(
  rl: Rl,
  timeClockName: string,
  category: "unpaid" | "paid",
  types: ManualBreakType[],
): Promise<string | undefined> {
  if (types.length === 0) {
    warn(`  ⚠ No ${category} Break Types configured for ${timeClockName} — ${category} breaks will be skipped for this Time Clock only.`);
    return undefined;
  }
  console.log(`  Pick a default ${color.bold(category)} Break Type for ${color.bold(timeClockName)}:`);
  types.forEach((t, i) => console.log(`    ${color.magenta(`[${i}]`)} ${t.name} ${color.dim(`(default ${t.duration}m)`)}`));
  const chosen = types[Number(await rl.question(`  Default ${category} Break Type (index): `))];
  if (!chosen) throw new Error("Invalid selection");
  return chosen.id;
}

function printTimeClocksSummary(entries: TimeClockSetupEntry[]): void {
  console.log(`\nimporter.config.json written with ${color.bold(String(entries.length))} Time Clock(s):\n`);
  for (const e of entries) {
    console.log(`  ${color.bold(color.cyan("●"))} ${color.bold(e.name)} ${color.dim(`(${e.timeClockId})`)}`);
    if (e.manualBreaksEnabled) {
      console.log(`      unpaidBreakTypeId: ${e.unpaidBreakTypeId ?? color.yellow("(none — unpaid breaks skipped)")}`);
      console.log(`      paidBreakTypeId:   ${e.paidBreakTypeId ?? color.yellow("(none — paid breaks skipped)")}`);
    } else {
      console.log(`      ${color.yellow("breaks disabled — break-writing skipped")}`);
    }
  }
}
