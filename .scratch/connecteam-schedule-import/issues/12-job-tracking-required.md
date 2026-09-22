Type: research
Status: resolved

## Question

Not anticipated by any prior ticket: a real write against a real account's Time Clock failed with `"Job ID is required for this time clock"`. Determine what a Job ID actually is in Connecteam's model, how it relates to the Schedule Export's own columns, how to resolve one via the API, and how the Importer should behave when a row's export data doesn't resolve to a real Job.

## Answer

**What a Job is**: a Connecteam "Job" (`GET /jobs/v1/jobs`) is a work-assignment record — title, code, GPS fence, which Employees/groups are assigned to it — scoped to one or more "instances" (a Scheduler or a Time Clock). Some Time Clocks have job tracking enforced; when they do, `POST .../time-activities` rejects a shift write with no `jobId` attached. This is a per-Time-Clock account setting, not something the API exposes a simple boolean for in advance — the only confirmed way to know is that the write itself 400s.

**Mapping to the Schedule Export**: the export's `Resource` column (issue 01's confirmed schema — e.g. `"Chef"`, `"Barista"`, `"Floor Manager"`) is the Job's `title`. Confirmed live against a real account: every distinct `Resource` value in a real export matched an existing Job's `title` exactly, scoped to the Time Clock being written to.

**Resolution strategy**: mirrors [issue 03](03-employee-identity-matching.md)'s Employee-matching shape. Once per Import Run, batch-resolve every distinct non-blank `Resource` value via `GET /jobs/v1/jobs?jobNames=<...>&instanceIds=<timeClockId>` — confirmed live that `jobNames` and `instanceIds` need the same repeated-query-param treatment as `fullNames` (issue 03's addendum), not comma-joined. Matching is case-sensitive per Connecteam's own docs (unlike Employee full names, which are case-insensitive). Unlike Employee matching, no ambiguity/ambiguous-title handling was built — nothing in this account or Connecteam's docs suggested duplicate Job titles on one Time Clock are a real scenario worth the extra complexity, so the first match wins if it ever happens.

**Per-row behavior**: a row with a non-blank `Resource` that doesn't resolve to a real Job is skipped and flagged (new `unmatched-job` reason), never written without a Job silently — same "skip and flag, never guess" policy as issue 04 applies to unmatched Employees. A row with a blank `Resource` writes the shift with no `jobId` at all, which is only safe on a Time Clock that doesn't enforce job tracking; if it does, that write will fail and be caught as a generic `other-write-error` the same way any other unanticipated write failure is (issue 04).

Verified live end-to-end: all 5 distinct `Resource` values in a real export (Chef, Floor Manager, Barista, Cashier, Store Maintanence) resolved to real Jobs, and the resulting shift writes carried the correct `jobId`.
