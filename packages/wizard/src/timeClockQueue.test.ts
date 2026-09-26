import { test } from "node:test";
import assert from "node:assert/strict";
import type { ConnecteamClient, ManualBreaksConfig, TimeClock } from "@sch-import/shared";
import { advanceTimeClockQueue } from "./timeClockQueue.js";
import type { WizardState } from "./wizardState.js";

function tc(id: string, name: string): TimeClock {
  return { timeClockId: id as TimeClock["timeClockId"], name, isArchived: false };
}

function clientWith(breaksById: Record<string, ManualBreaksConfig>): Pick<ConnecteamClient, "getManualBreaksConfig"> {
  return {
    async getManualBreaksConfig(timeClockId) {
      return breaksById[timeClockId as unknown as string]!;
    },
  };
}

const ENABLED: ManualBreaksConfig = { areManualBreaksEnabled: true, breakTypes: [] };
const DISABLED: ManualBreaksConfig = { areManualBreaksEnabled: false, breakTypes: [] };

test("all selected Time Clocks have breaks disabled -> done immediately, all auto-completed", async () => {
  const state: WizardState = { timeClockQueue: [tc("a", "A"), tc("b", "B")] };
  const client = clientWith({ a: DISABLED, b: DISABLED });

  const result = await advanceTimeClockQueue(client as ConnecteamClient, state);

  assert.equal(result, "done");
  assert.equal(state.currentTimeClock, undefined);
  assert.deepEqual(state.timeClockResults, [
    { timeClockId: "a", name: "A", manualBreaksEnabled: false },
    { timeClockId: "b", name: "B", manualBreaksEnabled: false },
  ]);
  assert.equal(state.timeClockQueue!.length, 0);
});

test("first Time Clock has breaks enabled -> stops immediately, needs a picker", async () => {
  const state: WizardState = { timeClockQueue: [tc("a", "A"), tc("b", "B")] };
  const client = clientWith({ a: ENABLED, b: DISABLED });

  const result = await advanceTimeClockQueue(client as ConnecteamClient, state);

  assert.equal(result, "needs-break-picker");
  assert.equal(state.currentTimeClock?.timeClockId, "a");
  assert.equal(state.currentBreaksConfig, ENABLED);
  assert.deepEqual(state.timeClockResults, []);
  // "a" popped off the queue even though it's not yet in results — it's being configured now.
  assert.deepEqual(state.timeClockQueue!.map((t) => t.timeClockId), ["b"]);
});

test("disabled Time Clocks are skipped and auto-completed before stopping at the first enabled one", async () => {
  const state: WizardState = { timeClockQueue: [tc("a", "A"), tc("b", "B"), tc("c", "C")] };
  const client = clientWith({ a: DISABLED, b: DISABLED, c: ENABLED });

  const result = await advanceTimeClockQueue(client as ConnecteamClient, state);

  assert.equal(result, "needs-break-picker");
  assert.equal(state.currentTimeClock?.timeClockId, "c");
  assert.deepEqual(state.timeClockResults, [
    { timeClockId: "a", name: "A", manualBreaksEnabled: false },
    { timeClockId: "b", name: "B", manualBreaksEnabled: false },
  ]);
  assert.equal(state.timeClockQueue!.length, 0);
});

test("calling again after a Break Type picker's result is pushed continues through the remaining queue", async () => {
  const state: WizardState = { timeClockQueue: [tc("a", "A"), tc("b", "B")] };
  const client = clientWith({ a: ENABLED, b: DISABLED });

  await advanceTimeClockQueue(client as ConnecteamClient, state);
  // Simulates handleBreakTypesStep pushing the completed entry for "a" after the picker is submitted.
  state.timeClockResults!.push({ timeClockId: "a", name: "A", manualBreaksEnabled: true, unpaidBreakTypeId: "u1" });

  const result = await advanceTimeClockQueue(client as ConnecteamClient, state);

  assert.equal(result, "done");
  assert.equal(state.timeClockResults!.length, 2);
  assert.equal(state.timeClockResults![1]!.timeClockId, "b");
});
