Type: grilling
Status: resolved

## Question

The Schedule Export gives the Importer a total break duration per paid/unpaid category (e.g. "Unpaid Breaks: 00:45"), but Connecteam's Time Activities API requires each break to reference a specific, pre-configured Break Type ID (not just a paid/unpaid flag) — see [CONTEXT.md](../../CONTEXT.md). Decide what the Importer should do when the Admin's account has more than one Break Type configured within the same paid/unpaid category (e.g. two different unpaid break types of different lengths): auto-select by matching duration, require the Admin to pre-map a default Break Type per category during Chat Link setup, skip writing the break and flag it, or something else.

## Answer

**Selection**: the `importer setup` step (issue 06) always asks the Admin to pick a default Break Type for each category — one for unpaid, one for paid — via a picker built from `GET /time-clock/v1/time-clocks/{timeClockId}/manual-breaks` (confirmed: returns `id`, `name`, `isPaid`, `duration` per configured type). This runs the same way whether the account has 1 or 5 Break Types per category — no conditional "auto-detect the sole one" branch to build or explain.

**Why this doesn't cost accuracy**: a break's actual written duration comes from the `start`/`end` timestamps the Importer sets, not from the chosen Break Type's own configured `duration`. So whichever default is picked, the Importer still writes the real duration from the Schedule Export — the Break Type choice only affects the break's name/label, never the paid/unpaid duration recorded for payroll.

**At write time**: for each non-empty `Unpaid Breaks` / `Paid Breaks` value on a row, write a separate break Time Activity referencing the Admin's configured default Break Type ID for that category, with `start`/`end` set to the real duration, following the documented two-call sequence (create the shift first, then the break with `isSplitShiftOnManualBreak: true`).

**Account-level gate**: the setup step also reads `areManualBreaksEnabled` from the same endpoint — if false, break-writing is skipped entirely for that account, with a note to the Admin, rather than hitting Connecteam's `"manual breaks are disabled for the given time clock"` error on every write.

## Addendum from live implementation (2026-09-22)

**Correction to how a break's duration actually gets written.** This ticket's original answer said breaks are written "with `start`/`end` set to the real duration" — that phrasing turned out to paper over a real gap. Confirmed against developer.connecteam.com's Time Activities guide and live: Create Time Activities requires an actual `start`/`end` (`{timestamp, timezone}`) per break — there is no `durationMinutes` field on the wire at all. The premise that the export never gives a break its own start time (issue 01) is still true and still stands; what's corrected is what the Importer does about it. Since no real break start time exists, the Importer now **derives** a placement: every requested break for a row is laid out as one contiguous block, centered within the shift. Total worked/break time comes out exactly right either way (verified live: an 8-hour shift with a 45-minute break split into two segments summing to 7h15m + the 45-minute break, correctly) — only the specific clock-time placement of the break within the shift is invented, not the duration.

**Correction to `isSplitShiftOnManualBreak` and the shift↔break relationship.** It's a **top-level** field on the whole Create Time Activities request, not a per-break field, and a break is never linked to "its" shift by an explicit ID (this ticket's original design assumed a `shiftTimeActivityId` reference existed — it doesn't). Splitting is purely by time-window overlap against whatever shift(s) already exist in the Time Clock at the moment the break is created — which is why shift creation and break creation must stay two separate, ordered API calls (shift first), exactly as this ticket already recommended, just for a different underlying reason than assumed.

**New, unrelated requirement this session also found**: some Time Clocks enforce job tracking and reject a shift write without a `jobId` — see the new [issue 12](12-job-tracking-required.md). Not something this ticket anticipated or needs to handle, but relevant to anyone implementing the write path from this ticket's design.

Verified live end-to-end against a real account and a real Time Clock with job tracking enforced: 45 rows in, 90 shift segments + 45 breaks correctly written and visible via `GET .../time-activities`.
