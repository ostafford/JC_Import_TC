Type: grilling
Status: resolved

## Question

[Issue 05](05-fallback-signal-when-job-resolution-is-ambiguous.md) settled the resolution order: try Job `instanceIds` first (issue 01) — authoritative when unambiguous — and only when that fails to yield exactly one Time Clock, fall back to matching the upload's caption text against a Time Clock's real name. This ticket covers what happens when **both** stages fail to produce exactly one Time Clock: Job resolution disagreed or spanned multiple Time Clocks, and either no caption was given or it didn't match any Time Clock name.

The original map's issue 04 established a general "never guess, skip and flag to Chat" policy for per-row failures (unmatched Employee, locked day, etc.); confirm whether Time Clock resolution failure should abort the *entire* Import Run before any row is processed (since every row in one Schedule Export presumably targets the same single Time Clock) rather than being a per-row skip-and-flag like Employee/Job matching failures are. Also settle what the Chat notification should say (issue 05 of the original map's pattern: brief text, cap ~500 chars, detail in an attachment only where there's per-row detail to attach — there may not be here) — and whether the message should list the Time Clock names the Admin could have used in a caption, to make self-service recovery obvious on the next attempt.

## Answer

**Abort the whole Import Run before processing any row**, rather than a per-row skip-and-flag. This is close to structurally forced, not really an open design choice: every Time Activity write is scoped by `timeClockId` in its own URL path (`/time-clock/v1/time-clocks/{id}/time-activities`), so there is no write to even attempt without one resolved first. It's also safe to simply ask the Admin to re-upload — nothing gets written before this check runs, so a fresh upload starts a brand new Import Run, not a retry of a partially-completed one; no conflict with [ADR 0002](../../../docs/adr/0002-no-automatic-retry-for-non-idempotent-writes.md)'s concern.

**Chat notification: brief, non-technical, plus the list of this Importer's configured Time Clock names.** A short failure line (e.g. "Couldn't tell which Time Clock this schedule belongs to") followed by the Time Clock names the Admin could type as a caption on re-upload — enough for self-service recovery without exposing Job/`instanceIds` mechanics to a non-technical Admin. One message covers both failure shapes (no Job matched anything, or matched Jobs disagreed) — the fix is identical either way ("add a caption naming one of these Time Clocks and re-upload"), so no separate message variants needed.

