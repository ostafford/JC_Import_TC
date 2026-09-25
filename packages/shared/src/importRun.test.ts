import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ConnecteamApiError,
  ConnecteamAuthError,
  asBreakTypeId,
  asExportEmployeeName,
  asJobId,
  asTimeActivityId,
  asTimeClockId,
  asUserId,
} from "./index.js";
import { runImportRun, type ImportWriter } from "./importRun.js";
import type { ScheduleExportRow } from "./scheduleExport.js";

function row(overrides: Partial<ScheduleExportRow> = {}): ScheduleExportRow {
  return {
    rowNumber: 2,
    date: "21/09/2026",
    resource: "Chef",
    employeeName: asExportEmployeeName("Jack Mitchell"),
    shiftTitle: "",
    isDraft: false,
    timezone: "Australia/Melbourne",
    hasRealEntry: false,
    shiftStart: new Date("2026-09-20T23:00:00Z"),
    shiftEnd: new Date("2026-09-21T07:00:00Z"),
    ...overrides,
  };
}

const baseConfig = { timeClockId: asTimeClockId("tc1"), manualBreaksEnabled: false };

test("matched employee, no existing entry -> success", async () => {
  const client: ImportWriter = {
    async listJobsByTitles() {
      return [{ jobId: asJobId("job-chef"), title: "Chef" }];
    },
    async listUsersByFullNames() {
      return [{ userId: asUserId("u1"), firstName: "Jack", lastName: "Mitchell", isArchived: false }];
    },
    async createShiftTimeActivity() {
      return { timeActivityId: asTimeActivityId("ta1") };
    },
    async createBreakTimeActivity() {
      throw new Error("should not be called — manual breaks disabled");
    },
  };

  const outcome = await runImportRun(client, [row()], baseConfig);
  assert.equal(outcome.succeeded, 1);
  assert.equal(outcome.rows[0]!.outcome, "success");
});

test("row already has a real entry -> skipped, no write attempted", async () => {
  const client: ImportWriter = {
    async listJobsByTitles() {
      return [{ jobId: asJobId("job-chef"), title: "Chef" }];
    },
    async listUsersByFullNames() {
      return [{ userId: asUserId("u1"), firstName: "Jack", lastName: "Mitchell", isArchived: false }];
    },
    async createShiftTimeActivity() {
      throw new Error("should not be called");
    },
    async createBreakTimeActivity() {
      throw new Error("should not be called");
    },
  };

  const outcome = await runImportRun(client, [row({ hasRealEntry: true })], baseConfig);
  assert.equal(outcome.succeeded, 0);
  assert.equal(outcome.skippedByReason["already-has-real-entry"], 1);
});

test("unmatched employee -> skipped, run continues", async () => {
  const client: ImportWriter = {
    async listJobsByTitles() {
      return [{ jobId: asJobId("job-chef"), title: "Chef" }];
    },
    async listUsersByFullNames() {
      return [];
    },
    async createShiftTimeActivity() {
      throw new Error("should not be called");
    },
    async createBreakTimeActivity() {
      throw new Error("should not be called");
    },
  };

  const outcome = await runImportRun(client, [row()], baseConfig);
  assert.equal(outcome.skippedByReason["unmatched-employee"], 1);
});

test("row's Resource doesn't match a real Job on this Time Clock -> skipped, no write attempted", async () => {
  const client: ImportWriter = {
    async listJobsByTitles() {
      return []; // "Chef" doesn't resolve to any Job on this Time Clock
    },
    async listUsersByFullNames() {
      return [{ userId: asUserId("u1"), firstName: "Jack", lastName: "Mitchell", isArchived: false }];
    },
    async createShiftTimeActivity() {
      throw new Error("should not be called — job didn't resolve");
    },
    async createBreakTimeActivity() {
      throw new Error("should not be called");
    },
  };

  const outcome = await runImportRun(client, [row()], baseConfig);
  assert.equal(outcome.succeeded, 0);
  assert.equal(outcome.skippedByReason["unmatched-job"], 1);
});

test("row with a blank Resource writes the shift without a jobId", async () => {
  let capturedJobId: string | undefined = "unset";
  const client: ImportWriter = {
    async listJobsByTitles() {
      throw new Error("should not be called — nothing to resolve for a blank Resource");
    },
    async listUsersByFullNames() {
      return [{ userId: asUserId("u1"), firstName: "Jack", lastName: "Mitchell", isArchived: false }];
    },
    async createShiftTimeActivity(input) {
      capturedJobId = input.jobId;
      return { timeActivityId: asTimeActivityId("ta1") };
    },
    async createBreakTimeActivity() {
      throw new Error("should not be called — manual breaks disabled");
    },
  };

  const outcome = await runImportRun(client, [row({ resource: "" })], baseConfig);
  assert.equal(outcome.succeeded, 1);
  assert.equal(capturedJobId, undefined);
});

test("one row's write fails with a locked-day-shaped 422, the rest still run", async () => {
  let calls = 0;
  const client: ImportWriter = {
    async listJobsByTitles() {
      return [{ jobId: asJobId("job-chef"), title: "Chef" }];
    },
    async listUsersByFullNames() {
      return [{ userId: asUserId("u1"), firstName: "Jack", lastName: "Mitchell", isArchived: false }];
    },
    async createShiftTimeActivity() {
      calls++;
      if (calls === 1) throw new ConnecteamApiError("locked", 422, { message: "day is locked" });
      return { timeActivityId: asTimeActivityId("ta2") };
    },
    async createBreakTimeActivity() {
      throw new Error("should not be called — manual breaks disabled");
    },
  };

  const outcome = await runImportRun(client, [row({ rowNumber: 2 }), row({ rowNumber: 3 })], baseConfig);
  assert.equal(outcome.succeeded, 1);
  assert.equal(outcome.skippedByReason["locked-day"], 1);
});

test("a systemic auth error aborts the whole run instead of being caught per-row", async () => {
  const client: ImportWriter = {
    async listJobsByTitles() {
      return [{ jobId: asJobId("job-chef"), title: "Chef" }];
    },
    async listUsersByFullNames() {
      return [{ userId: asUserId("u1"), firstName: "Jack", lastName: "Mitchell", isArchived: false }];
    },
    async createShiftTimeActivity() {
      throw new ConnecteamAuthError("token rejected");
    },
    async createBreakTimeActivity() {
      throw new Error("should not be called");
    },
  };

  await assert.rejects(() => runImportRun(client, [row()], baseConfig), ConnecteamAuthError);
});

test("manual breaks: writes unpaid + paid breaks as a contiguous block placed within the shift", async () => {
  const writtenBreaks: Array<{ breakTypeId: string; start: Date; end: Date }> = [];
  const client: ImportWriter = {
    async listJobsByTitles() {
      return [{ jobId: asJobId("job-chef"), title: "Chef" }];
    },
    async listUsersByFullNames() {
      return [{ userId: asUserId("u1"), firstName: "Jack", lastName: "Mitchell", isArchived: false }];
    },
    async createShiftTimeActivity() {
      return { timeActivityId: asTimeActivityId("shift-1") };
    },
    async createBreakTimeActivity(input) {
      writtenBreaks.push({ breakTypeId: input.breakTypeId, start: input.start.timestamp, end: input.end.timestamp });
      assert.equal(input.start.timezone, "Australia/Melbourne");
      return { timeActivityId: asTimeActivityId("break-1") };
    },
  };

  const r = row({ unpaidBreakMinutes: 45, paidBreakMinutes: 15 });
  const outcome = await runImportRun(client, [r], {
    timeClockId: asTimeClockId("tc1"),
    manualBreaksEnabled: true,
    unpaidBreakTypeId: asBreakTypeId("bt-unpaid"),
    paidBreakTypeId: asBreakTypeId("bt-paid"),
  });

  assert.equal(outcome.succeeded, 1);
  assert.equal(writtenBreaks.length, 2);
  const [unpaid, paid] = writtenBreaks as [(typeof writtenBreaks)[0], (typeof writtenBreaks)[0]];

  assert.equal(unpaid.breakTypeId, "bt-unpaid");
  assert.equal((unpaid.end.getTime() - unpaid.start.getTime()) / 60_000, 45);
  assert.equal(paid.breakTypeId, "bt-paid");
  assert.equal((paid.end.getTime() - paid.start.getTime()) / 60_000, 15);

  // Contiguous, non-overlapping, and fully inside the shift.
  assert.equal(unpaid.end.getTime(), paid.start.getTime());
  assert.ok(unpaid.start.getTime() >= r.shiftStart.getTime());
  assert.ok(paid.end.getTime() <= r.shiftEnd.getTime());
});
