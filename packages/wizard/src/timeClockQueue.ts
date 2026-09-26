import type { ConnecteamClient } from "@sch-import/shared";
import type { WizardState } from "./wizardState.js";

export type QueueAdvanceResult = "needs-break-picker" | "done";

/**
 * Walks `state.timeClockQueue` front-to-back, auto-completing any Time Clock
 * with manual breaks disabled (nothing to pick — matches the CLI's own
 * skip-and-continue behaviour), and stopping at the first one that needs a
 * Break Type picker. Mirrors `packages/importer/src/setup.ts`'s per-Time-Clock
 * loop, just spread across separate HTTP requests instead of one synchronous
 * `for` loop — called once after the multi-select step, then again after
 * every Break Type picker submission, until the queue empties.
 */
export async function advanceTimeClockQueue(client: ConnecteamClient, state: WizardState): Promise<QueueAdvanceResult> {
  const queue = state.timeClockQueue ?? [];
  state.timeClockResults ??= [];

  while (queue.length > 0) {
    const tc = queue[0]!;
    const breaksConfig = await client.getManualBreaksConfig(tc.timeClockId);

    if (!breaksConfig.areManualBreaksEnabled) {
      queue.shift();
      state.timeClockResults.push({ timeClockId: tc.timeClockId, name: tc.name, manualBreaksEnabled: false });
      continue;
    }

    queue.shift();
    state.currentTimeClock = tc;
    state.currentBreaksConfig = breaksConfig;
    return "needs-break-picker";
  }

  state.currentTimeClock = undefined;
  state.currentBreaksConfig = undefined;
  return "done";
}
