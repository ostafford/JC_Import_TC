import { test } from "node:test";
import assert from "node:assert/strict";
import { asJobId, asTimeClockId, type TimeClockId } from "./vocabulary.js";
import { resolveTimeClockForRun, type JobLookup, type TimeClockOption } from "./timeClockResolution.js";

const NORTH = { timeClockId: asTimeClockId("tc-north"), name: "Xero v1 (North Cafe)" };
const SOUTH = { timeClockId: asTimeClockId("tc-south"), name: "Xero v2 (South Cafe)" };
const CONFIGURED: TimeClockOption[] = [NORTH, SOUTH];

function jobLookup(byTitle: Record<string, TimeClockId[]>): JobLookup {
  return {
    async listJobsAcrossTimeClocksByTitles(titles) {
      return titles
        .filter((t) => t in byTitle)
        .map((t) => ({ jobId: asJobId(`job-${t}`), title: t, instanceIds: byTitle[t]! }));
    },
  };
}

test("every row's Job agrees on one configured Time Clock -> resolved via Jobs", async () => {
  const client = jobLookup({ Chef: [NORTH.timeClockId], Barista: [NORTH.timeClockId] });
  const result = await resolveTimeClockForRun(client, ["Chef", "Barista", "Chef"], CONFIGURED, undefined);
  assert.deepEqual(result, { kind: "resolved", timeClockId: NORTH.timeClockId });
});

test("a Job shared across configured Time Clocks alone is ambiguous, falls to caption", async () => {
  const client = jobLookup({ Chef: [NORTH.timeClockId, SOUTH.timeClockId] });
  const result = await resolveTimeClockForRun(client, ["Chef"], CONFIGURED, "Xero v2 (South Cafe)");
  assert.deepEqual(result, { kind: "resolved", timeClockId: SOUTH.timeClockId });
});

test("two rows' Jobs disagree on Time Clock -> unresolved via Jobs, no caption given -> unresolved overall", async () => {
  const client = jobLookup({ Chef: [NORTH.timeClockId], Cashier: [SOUTH.timeClockId] });
  const result = await resolveTimeClockForRun(client, ["Chef", "Cashier"], CONFIGURED, undefined);
  assert.deepEqual(result, { kind: "unresolved" });
});

test("no Resource values at all (every row blank) -> falls straight to caption", async () => {
  const client = jobLookup({});
  const result = await resolveTimeClockForRun(client, ["", "  "], CONFIGURED, "xero v1 (north cafe)");
  assert.deepEqual(result, { kind: "resolved", timeClockId: NORTH.timeClockId });
});

test("no Job matches, caption doesn't match any configured Time Clock name -> unresolved", async () => {
  const client = jobLookup({});
  const result = await resolveTimeClockForRun(client, ["Chef"], CONFIGURED, "Some Other Clock");
  assert.deepEqual(result, { kind: "unresolved" });
});

test("a Job's instanceIds pointing at an unconfigured Time Clock is ignored, not treated as a match", async () => {
  const client = jobLookup({ Chef: [asTimeClockId("tc-not-configured")] });
  const result = await resolveTimeClockForRun(client, ["Chef"], CONFIGURED, undefined);
  assert.deepEqual(result, { kind: "unresolved" });
});

test("caption match is case-insensitive and trimmed", async () => {
  const client = jobLookup({});
  const result = await resolveTimeClockForRun(client, [], CONFIGURED, "  XERO V2 (SOUTH CAFE)  ");
  assert.deepEqual(result, { kind: "resolved", timeClockId: SOUTH.timeClockId });
});

test("caption matches as a substring, not just an exact equal — the natural phrasing that broke live", async () => {
  const client = jobLookup({});
  const result = await resolveTimeClockForRun(client, [], CONFIGURED, "please import to Xero v2 (South Cafe) thanks");
  assert.deepEqual(result, { kind: "resolved", timeClockId: SOUTH.timeClockId });
});

test("Job resolves cleanly but caption names a different Time Clock -> conflict, not silently overridden", async () => {
  const client = jobLookup({ Chef: [NORTH.timeClockId] });
  const result = await resolveTimeClockForRun(client, ["Chef"], CONFIGURED, "please add to Xero v2 (South Cafe)");
  assert.deepEqual(result, {
    kind: "conflict",
    jobResolvedTimeClockId: NORTH.timeClockId,
    captionResolvedTimeClockId: SOUTH.timeClockId,
  });
});

test("Job resolves cleanly and caption agrees with it -> resolved, no conflict", async () => {
  const client = jobLookup({ Chef: [NORTH.timeClockId] });
  const result = await resolveTimeClockForRun(client, ["Chef"], CONFIGURED, "add to Xero v1 (North Cafe)");
  assert.deepEqual(result, { kind: "resolved", timeClockId: NORTH.timeClockId });
});

test("caption containing more than one configured Time Clock's name stays ambiguous", async () => {
  const client = jobLookup({});
  const result = await resolveTimeClockForRun(
    client,
    [],
    CONFIGURED,
    "not sure if this is Xero v1 (North Cafe) or Xero v2 (South Cafe)",
  );
  assert.deepEqual(result, { kind: "unresolved" });
});
