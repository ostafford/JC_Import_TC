import type { ChatConversation, ConnecteamClient, ManualBreaksConfig, TimeClock } from "@sch-import/shared";
import type { TimeClockSetupEntry } from "@sch-import/importer/dist/lib.js";

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
  senderId?: string;
  /**
   * Time Clocks picked in the multi-select, not yet asked about their Break
   * Types — walked one at a time across separate HTTP requests by
   * `advanceTimeClockQueue` (multi-time-clock-routing map, Phase 2), the same
   * per-Time-Clock loop the CLI runs synchronously in one process.
   */
  timeClockQueue?: TimeClock[];
  /** The one Time Clock currently awaiting a Break Type picker (breaks enabled, popped off the queue). */
  currentTimeClock?: TimeClock;
  currentBreaksConfig?: ManualBreaksConfig;
  /** Every Time Clock fully configured so far, in the order picked. */
  timeClockResults?: TimeClockSetupEntry[];
  adminEmail?: string;
}

export function createWizardState(): WizardState {
  return {};
}
