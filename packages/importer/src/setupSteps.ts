import { randomBytes } from "node:crypto";
import type { ManualBreakType } from "@sch-import/shared";
import type { PersistedSetupConfig } from "./config.js";

/**
 * The business logic behind `importer setup` (issue 06/08), pulled out of
 * `setup.ts`'s `readline` prompts so the browser-based wizard can call the
 * exact same sequence instead of reimplementing it against form values.
 */
export function generateWebhookSecrets(): { connecteamWebhookSecret: string; webhookSharedSecret: string } {
  return {
    connecteamWebhookSecret: randomBytes(32).toString("hex"),
    webhookSharedSecret: randomBytes(32).toString("hex"),
  };
}

/** Looks a Break Type up by its real id (the wizard renders pickers keyed by id, not array index). */
export function validateBreakTypeSelection(types: ManualBreakType[], chosenId: string): ManualBreakType {
  const chosen = types.find((t) => t.id === chosenId);
  if (!chosen) throw new Error("Invalid Break Type selection");
  return chosen;
}

export function buildPersistedConfig(input: {
  conversationId: string;
  timeClockId: string;
  senderId: string;
  manualBreaksEnabled: boolean;
  unpaidBreakTypeId?: string;
  paidBreakTypeId?: string;
}): PersistedSetupConfig {
  return { ...input };
}
