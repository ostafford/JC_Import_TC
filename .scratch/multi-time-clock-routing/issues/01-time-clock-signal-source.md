Type: task
Status: resolved

## Question

What actually, reliably identifies which Connecteam Time Clock a given Schedule Export upload belongs to, resolved entirely from the upload itself (no live chat back-and-forth)? Chase in this priority order, live against a real multi-location Connecteam account (or a demo account configured with 2+ Time Clocks and 2+ Schedules) — do not guess from docs alone, this project's own history (issue 01 of the original map) is exactly a case where docs weren't good enough:

1. **Content-based inference** — does the Schedule Export's own data reliably distinguish locations? The known 23-column schema (original map's issue 01) has no dedicated location column, but check whether `Address` correlates 1:1 with a location/Time Clock in a real export, and whether the export or its default filename carries any trace of which Connecteam Schedule it came from (Schedule name, Schedule ID, or similar) — a Schedule can itself be associated with one or more Time Clocks, per the user's own account.
2. **Caption convention** — confirmed technically possible (developer.connecteam.com/docs/chat-webhook documents a `content` field alongside `attachments` in the same `message_created` event), but not confirmed that the Connecteam mobile/web app actually lets a user type a caption alongside a file attachment in one message. Verify live.
3. **Filename convention** — Admin renames the exported file per a convention before uploading. Lowest priority: relies entirely on Admin discipline and is the easiest to get wrong.

Also confirm: does the chosen signal survive re-processing the same upload (idempotency, matching the original map's issue 04 side-effect)?

This ticket blocks the Time Clock Mapping's shape and setup/reconfiguration UX (see map's "Not yet specified").

## Answer

Ruled out, confirmed live/via docs, not guessed:
- The Schedule Export's 23-column schema has no location/Schedule identifier (original map's issue 01). Its `Address` column exists but was blank in both real samples on hand — inconclusive on its own, not a confirmed signal.
- Connecteam's Scheduler API docs document no Schedule↔Time-Clock association.
- Fetched Connecteam's live OpenAPI spec directly: the `User` object has no Time-Clock field at all (rules out "infer from which Employee" via the Users endpoint). It does carry `customFields` and `smartGroupsIds`, either of which *could* carry a location signal if a specific client's account happens to be configured that way — but that's account-specific and unconfirmed, not a general mechanism.
- The `TimeClock` object itself is minimal (`id`, `name`, `isArchived`) — no reverse link to users/jobs/schedules.

**Primary mechanism, confirmed live and empirically verified against the demo account (which genuinely has 4 real Time Clocks — MYOB, Job Clock (archived), Xero v1, Xero v2)**: a Job's `instanceIds` (issue 12 of the original map) is a real, structural, already-used link between an entity the Schedule Export already names (`Resource` → Job, via existing Job matching) and a Time Clock. Verified end-to-end: created two throwaway Jobs, each `instanceIds`-scoped to a different real Time Clock (`19481524` / Xero v1, `19481537` / Xero v2); `GET /jobs/v1/jobs?jobNames=...` **without** an `instanceIds` filter returned both jobs, each with its own correct `instanceIds` array — meaning the Importer can resolve which Time Clock a Job belongs to by querying its name alone, with no pre-known Time Clock. Both jobs cleaned up afterward (`DELETE /jobs/v1/jobs/{jobId}`, confirmed soft-deleted, `isDeleted: true`, no longer returned by name).

**Recommendation**: make Job→`instanceIds` resolution the **primary** Time Clock Signal source — the Schedule Export's existing `Resource` column, resolved through Job matching the Importer already does (issue 12), with zero new upload convention and zero Admin behavior change. It also sidesteps the "Jobs/Time Clocks keep changing" concern raised while charting this map (Q4): there's no snapshot to go stale, since it's queried live every Import Run rather than configured once at setup.

**This only works cleanly if every Job referenced in one Schedule Export resolves to the same single Time Clock.** It depends on the *client's own* Connecteam configuration — each location's Jobs need to be Time-Clock-exclusive (e.g. a "Chef" Job per café, not one shared "Chef" Job spanning every location's `instanceIds`). The user's own account can have Jobs assigned to multiple Time Clocks (confirmed while charting this map, Q4) — when that's the case for a given Job, or when a file's resolved Jobs don't all agree on one Time Clock, this signal is ambiguous and a fallback is needed. Caption-based signalling (`data.message.content`, confirmed to sit alongside `attachments` in the same webhook event — see the earlier chat-webhook research) remains the leading fallback candidate, but is now explicitly secondary, not primary. New ticket: [issue 05](05-fallback-signal-when-job-resolution-is-ambiguous.md).

