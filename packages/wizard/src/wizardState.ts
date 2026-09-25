import type { ChatConversation, ConnecteamClient, ManualBreaksConfig, TimeClock } from "@sch-import/shared";

/**
 * Single in-memory state object for one wizard run — no persistence, no
 * session/cookie machinery. This is deliberately simpler than the Relay's
 * `RelayStore`: the wizard is a single-Admin, single-machine, single-process
 * setup flow, not something that needs to survive a restart or serve
 * multiple concurrent users.
 */
export interface WizardState {
  apiToken?: string;
  client?: ConnecteamClient;
  conversations?: ChatConversation[];
  timeClocks?: TimeClock[];
  conversationId?: string;
  conversationName?: string;
  relayWebhookUrl?: string;
  connecteamWebhookSecret?: string;
  webhookSharedSecret?: string;
  webhookVerified?: boolean;
  timeClockId?: string;
  senderId?: string;
  breaksConfig?: ManualBreaksConfig;
  unpaidBreakTypeId?: string;
  paidBreakTypeId?: string;
  adminEmail?: string;
}

export function createWizardState(): WizardState {
  return {};
}
