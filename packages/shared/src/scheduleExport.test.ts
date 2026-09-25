import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScheduleExport } from "./scheduleExport.js";

// Real exports obtained in issue 01 — kept at the repo root as fixtures.
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const NO_BREAK_FILE = join(REPO_ROOT, "Schedule-Export 2026-09-21 to 2026-09-27_without_break.xlsx");
const ADDED_BREAK_FILE = join(REPO_ROOT, "Schedule-Export 2026-09-21 to 2026-09-27_added_break.xlsx");

test("parses the no-break sample: 45 rows, all draft, no breaks, no real entries yet", async () => {
  const rows = await parseScheduleExport(await readFile(NO_BREAK_FILE));

  assert.equal(rows.length, 45);
  assert.ok(rows.every((r) => r.isDraft));
  assert.ok(rows.every((r) => r.unpaidBreakMinutes === undefined));
  assert.ok(rows.every((r) => r.paidBreakMinutes === undefined));
  assert.ok(rows.every((r) => !r.hasRealEntry));

  const first = rows[0]!;
  assert.equal(first.date, "21/09/2026");
  assert.equal(first.employeeName, "Jack Mitchell");
  assert.equal(first.resource, "Chef");
  // 21/09/2026 09:00am Australia/Melbourne (AEST, UTC+10 in September) -> 2026-09-20T23:00:00Z
  assert.equal(first.shiftStart.toISOString(), "2026-09-20T23:00:00.000Z");
  assert.equal(first.shiftEnd.toISOString(), "2026-09-21T07:00:00.000Z");
});

test("parses the added-break sample: published, every row carries a 45m unpaid break", async () => {
  const rows = await parseScheduleExport(await readFile(ADDED_BREAK_FILE));

  assert.equal(rows.length, 45);
  assert.ok(rows.every((r) => !r.isDraft));
  // In this sample the Admin applied the break to every shift, not just one —
  // confirms the parser reads the real per-row value rather than assuming a
  // single outlier.
  assert.ok(rows.every((r) => r.unpaidBreakMinutes === 45));
  assert.ok(rows.every((r) => r.paidBreakMinutes === undefined));
});
