Type: task
Status: resolved

## Question

Obtain one or more real Schedule Export files from a live Connecteam account (e.g. a test/demo account), covering: a shift with a break, a shift without one, and at least two different Employees/jobs. Record the exact column headers and how each Employee is identified in the export (full name string, employee ID number, email, etc.) — the public help center article names column categories but not the exact format.

This unblocks [issue 03](03-employee-identity-matching.md) (how export rows should be matched to Connecteam Employees).

## Answer

Two real exports obtained (`.xlsx`, single sheet "All Employees"), 21–27 Sep 2026, one with a Scheduler break added, one without.

**Columns (23, A–W)**: `Date, Start, End, Timezone, Availability status, Resource, Users, Address, Note, Note has attachments, Shift tags, Shift title, Draft, Unpaid Breaks, Paid Breaks, Last Status, Tasks, Check In, Check In Note, Check In GPS, Complete, Complete Note, Complete GPS`.

**Employee identity**: `Users` holds a plain full-name string (e.g. "Jack Mitchell") — no employee ID, no email. Confirms issue 03 needs a real disambiguation strategy; the export alone can't tell two same-named Employees apart.

**Breaks — corrects issue 02's resolved answer**: the export *does* carry break data, via `Unpaid Breaks` / `Paid Breaks` columns, each an `HH:MM` total duration (e.g. `00:45`). This directly contradicts the doc-sourced conclusion in issue 02 that the export has no breaks column — real evidence overrides it (see correction appended to issue 02). It's an aggregate total per paid/unpaid category though, not the full `breaks` array — no per-break name, start time, or Break-Type reference. Tells the Importer *how much* break time and whether paid/unpaid, not *which* configured Break Type to use if the account has more than one type per category. New ticket: [issue 08](08-break-type-selection.md).

**Date/time format**: `DD/MM/YYYY` (e.g. `21/09/2026`), 12-hour `hh:mmam/pm` (e.g. `09:00am`), explicit per-row `Timezone` (e.g. `Australia/Melbourne`).

**No stable shift/row ID**: nothing identifies a row uniquely beyond its own data. Collision risk if an Employee has two same-day shifts with matching job+time; also means no cheap key to dedupe against if the same file is processed twice.

**New finding for issue 04**: `Check In`/`Check In GPS`/`Complete`/`Complete GPS` are present and were empty here (future shifts, nothing clocked yet) — for a past/current shift these would presumably be populated if the Employee has already clocked real time. The export itself may be enough to implement the "skip if a real entry already exists" rule from A7, without a separate API lookup.

**Draft status**: the no-break export had `Draft = Yes` on every row (unpublished); the added-break export had `Draft = No` (published). Draft shifts still exported either way — suggests export doesn't require publishing, but this wasn't a deliberate isolated test, so treat as an observation not a confirmed rule.

**Assets**: [`Schedule-Export 2026-09-21 to 2026-09-27_without_break.xlsx`](../../../Schedule-Export%202026-09-21%20to%202026-09-27_without_break.xlsx), [`Schedule-Export 2026-09-21 to 2026-09-27_added_break.xlsx`](../../../Schedule-Export%202026-09-21%20to%202026-09-27_added_break.xlsx)
