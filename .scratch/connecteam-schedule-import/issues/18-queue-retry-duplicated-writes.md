Type: task
Status: resolved

## Question

Not anticipated by any prior ticket, and more serious than issues 15–17: a real Import Run against a real Connecteam account crashed partway through (hit the Workers Free plan's 50-subrequest-per-invocation cap — the exact risk issue 15 fact-checked and issue 14 flagged as requiring the Paid plan). Because the queue consumer was configured with `max_retries: 3` and the crash was an uncaught exception, Cloudflare Queues automatically retried the same message **three times in under two minutes**, and each attempt independently re-ran the entire pipeline from row 1 — successfully re-writing the same 23 rows' shifts each time before hitting the same cap again. This produced real, duplicated Time Activities in a live Connecteam account for 23 employee/date combinations, discovered live during Okky's own end-to-end test (2026-09-25), with zero Chat notification of the underlying failure at any point.

## Why this happened

Two independent gaps combined:

1. **The account wasn't yet on the Workers Paid plan** — issue 14 already flagged that real usage needs it (Free plan's subrequest cap doesn't fit real row counts), but nothing enforced this before a real 45-row test ran.
2. **The real defect**: `runImportRun`'s writes are not idempotent — a row's "already written" state is derived only from the Schedule Export file's own Check-In/Complete columns (issue 01), never from a live check against what the Importer itself has already written in this account. Automatically retrying a partially-completed run has no way to skip rows that already succeeded, so a blind retry after a crash duplicates real writes instead of completing the failed ones. This is a code/design fault, not a Cloudflare or Connecteam fault — Cloudflare's queue retried exactly as configured; the configuration itself was wrong for a non-idempotent operation.

Compounding this: `processTrigger`'s try/catch only handled `ConnecteamAuthError` specially: every other failure (including this one) propagated uncaught with no Chat notification at all — violating issue 05's standing rule that Chat is the only interface for this tool and silence is never acceptable. The Admin had no way to know anything had gone wrong short of watching live Worker logs.

## Answer

**`max_retries: 0`** on the queue consumer (`packages/importer-cloudflare/wrangler.jsonc`) — a deliberate choice, not a placeholder. A failed Import Run must surface to the Admin and stop, never silently repeat an operation that isn't safe to repeat. `queue()`'s own catch block now `ack()`s a crashed message explicitly (never retries) since `processTrigger` has already attempted the real notification by the time that catch runs.

**`processTrigger` now wraps the entire pipeline** (previously the attachment download and file parsing sat outside the try/catch entirely, with no failure handling at all) and added `sendImportCrashedToChat` (`chatConfirmation.ts`) for any failure that isn't the already-handled auth-abort case — an honest message naming that some shifts may already be written and that nothing will retry automatically, so the Admin knows to check for duplicates before re-uploading. This is exactly the guidance that was missing live tonight.

**Immediate incident response**: the queue consumer was detached (`wrangler queues consumer remove`) the moment the pattern was recognized, though by then Cloudflare had already exhausted all 3 configured retries in the ~2 minutes before intervention was possible — manual intervention at the retry-count level is too slow to rely on; the fix has to prevent the retry from being configured at all, which is what `max_retries: 0` does. Okky manually deleted the duplicated Time Activities from the real Connecteam account afterward.

**Not fixed here, left as a known gap**: real duplicate protection (checking live against Connecteam, not just the export file's own columns, before every write) would make retries safe again and is the more thorough fix — but is a bigger design question (cost in subrequests, whether it changes the per-row skip logic in issue 03/04) than warranted for tonight's incident response. `max_retries: 0` plus honest Chat notification is the correct minimum bar: never duplicate, always tell the Admin, don't guess at automatic recovery for a payroll-writing pipeline.

## Consequence for issue 14's "which hosting option to show clients" framing

This incident is a concrete argument for local remaining the default, more battle-tested option (verified end-to-end well before the Cloudflare port existed) — not because Cloudflare is unsound, but because it introduced two genuinely new failure surfaces (the subrequest cap, the queue-retry layer) that needed this exact safeguard before being shown to a real client. The Cloudflare Importer should not be presented as ready for real client use until: (a) the Paid plan is confirmed active, and (b) this fix has been re-verified against a real account.
