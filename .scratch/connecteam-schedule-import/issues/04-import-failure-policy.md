Type: grilling
Status: resolved

## Question

What should the Importer do when a row in an Import can't be written — an Employee it can't match, a locked/approved timesheet day (the API rejects the write), or any other per-row failure? Options include: abort the whole Import Run, skip the row and continue, or stop-and-report. Also decide what "success" means for a partially-failed Import Run, and what the Admin needs to see about it.

## Answer

**Run-level policy**: partial-success-by-default, uniformly, for every per-row failure type — unmatched/ambiguous/archived Employee (issue 03), locked timesheet day, "already has a real entry" (per the GET pre-check from issue 04's own research pass), and any other per-row write rejection (e.g. `422` validation error). One bad row never blocks the rest of the Import Run.

Employee-matching failures should be rare in practice, since export names come straight from Connecteam's own Employee records — but that doesn't remove the need for this policy: locked-day and already-has-a-real-entry failures are expected, normal occurrences, not edge cases.

**Locked timesheet day**: skip the row, flag it distinctly from an unmatched-Employee failure (different fix — someone must unlock that pay period in Connecteam; re-running the Import won't help). The flag must name the specific Employee whose timesheet day is locked and advise the Admin to reopen it. Signal for [issue 05](05-chat-confirmation.md): at minimum, locked-day failures should be reported back into Chat, not just logged silently — issue 05 decides the full mechanism.

**Abort threshold**: none for ordinary per-row failures — always attempt every remaining row regardless of prior failures. Abort the whole Import Run immediately only on a systemic, non-row-specific error (e.g. an authentication/authorization failure from the API itself), since continuing would just repeat the same failure on every row.

**Import Run outcome record**: total rows attempted, succeeded count, skipped count broken down by reason (unmatched / ambiguous / archived Employee, already-has-real-entry, locked day, other write error), and a per-row list of `{date, employee name as given, outcome, reason}`.
