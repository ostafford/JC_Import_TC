Type: research
Status: resolved

## Question

Does Connecteam's Scheduler data model support defining a break window on a scheduled shift at all (independent of the Time Clock's break concept)? Check the Scheduler API docs (developer.connecteam.com) and shift object schema, not just the export.

If shifts don't carry break data in Connecteam's own model, the Schedule Export can never include it either — meaning the Importer's break data has to come from somewhere else entirely (e.g. a fixed rule the Admin configures, like "shifts over N hours get an M-minute unpaid break"), not from parsing the file. Resolve which of these is true before any break-mapping design proceeds.

## Answer

Connecteam's Scheduler shift object **does** support breaks natively, independent of Time Clock. The developer API's shift create/get schemas (https://developer.connecteam.com/docs/scheduler-create-shifts, https://developer.connecteam.com/docs/scheduler-shifts) include an optional `breaks` array per shift, each entry with `name`, `type` (paid/unpaid), `startTime` (minutes from midnight), and `duration` (minutes); total break duration can't exceed the shift's duration. The Scheduler UI exposes the same via "Add breaks" on a shift (https://help.connecteam.com/en/articles/9051284-schedule-shift-breaks), which states explicitly: "Adding breaks to shifts in the Job Scheduler does not impact breaks in the Time Clock" — confirming it's a distinct concept from Time Clock breaks.

However, the Schedule Export (Excel) file stays confirmed break-free: shift date, start/end time, job, location, notes, assigned user, check-in/complete time+GPS (https://help.connecteam.com/en/articles/6453258-can-i-export-my-team-s-schedule) — no breaks column.

So: breaks exist in Connecteam's own Scheduler model, but not in the exported file this project parses. The Importer can't get break data from the Schedule Export. To honor Scheduler-defined breaks, it would need to call the Scheduler API's shift-get endpoint directly (it already holds the Admin's token) rather than rely on a fixed rule. That API-vs-fixed-rule choice is now the open question, not "mapping mechanics."

Minor gap: the GET-shift `breaks` field wasn't verified against a raw example response, only against docs listing it.

## Correction (from issue 01)

Real Schedule Export samples obtained in [issue 01](01-real-schedule-export-sample.md) show the export **does** carry break data after all, via `Unpaid Breaks` / `Paid Breaks` columns holding an `HH:MM` total duration — contradicting the doc-sourced claim above that the export is break-free. The help center article this was based on was evidently stale or incomplete for the current export format. Real evidence overrides it: the "API-fetch vs. fixed-rule" fork this ticket raised is moot — the export already supplies aggregate break duration per paid/unpaid category. What remains open is which specific configured Break Type to use when an account has more than one per category (no per-break name/type-id in the export) — tracked as [issue 08](08-break-type-selection.md).
