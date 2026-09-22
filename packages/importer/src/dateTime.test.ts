import { test } from "node:test";
import assert from "node:assert/strict";
import { exportLocalTimeToUtc, parseBreakDurationMinutes } from "./dateTime.js";

test("exportLocalTimeToUtc resolves DD/MM/YYYY + hh:mmam/pm + IANA zone to UTC", () => {
  // Melbourne is AEST (UTC+10) in late September, before DST starts in October.
  assert.equal(
    exportLocalTimeToUtc("21/09/2026", "09:00am", "Australia/Melbourne").toISOString(),
    "2026-09-20T23:00:00.000Z",
  );
  assert.equal(
    exportLocalTimeToUtc("21/09/2026", "05:00pm", "Australia/Melbourne").toISOString(),
    "2026-09-21T07:00:00.000Z",
  );
  // Midday boundary: 12:00pm is noon, not midnight.
  assert.equal(exportLocalTimeToUtc("01/01/2026", "12:00pm", "UTC").toISOString(), "2026-01-01T12:00:00.000Z");
  assert.equal(exportLocalTimeToUtc("01/01/2026", "12:00am", "UTC").toISOString(), "2026-01-01T00:00:00.000Z");
});

test("parseBreakDurationMinutes handles HH:MM and blank values", () => {
  assert.equal(parseBreakDurationMinutes("00:45"), 45);
  assert.equal(parseBreakDurationMinutes("01:15"), 75);
  assert.equal(parseBreakDurationMinutes(""), undefined);
  assert.equal(parseBreakDurationMinutes(undefined), undefined);
});
