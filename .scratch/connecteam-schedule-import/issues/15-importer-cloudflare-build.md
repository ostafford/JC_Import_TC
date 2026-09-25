Type: task
Status: resolved

## Question

Build the Importer's Cloudflare Worker version, deferred by [issue 14](14-cloudflare-deployment-mechanics.md) pending its own design pass ("Worker vs. Queue-backed processing for reliability").

## Not anticipated by issue 14: a real execution-time ceiling, not a hypothetical one

Porting `packages/importer` was mostly mechanical — `dateTime.ts`, `employeeMatching.ts`, and `importRun.ts` are pure logic with zero Node dependencies and ported unchanged. Two real risks needed empirical verification, not just research:

**`exceljs` under the Workers runtime**: confirmed working via a real Schedule Export file (one of this repo's own root-level samples) parsed correctly through an actual `wrangler dev` request, with `compatibility_flags: ["nodejs_compat"]` enabled — real employee names, dates, resources, and break durations all extracted correctly. No issue.

**Whether a single Worker invocation can safely fit the whole Import Run**: this is where issue 14's deferred question turned out to matter for real, not just as a theoretical concern. Chased down via two rounds of Cloudflare-docs research (not guessed):

1. Cloudflare Workers have **two** execution-extension mechanisms, and both cap out around 30 seconds: `ctx.waitUntil()` extends "up to 30 seconds after the response is sent or the client disconnects" (confirmed quote, developers.cloudflare.com/workers/runtime-apis/context/), and staying inside the request/response cycle avoids a cap only as long as the ORIGINAL CALLER stays connected — but the Relay (the Importer's caller) is itself bound by its own `waitUntil` budget once it has already acked Connecteam, so that path caps out at ~30s too, one level up.
2. Confirmed further (developers.cloudflare.com/workers/runtime-apis/context/, the "waitUntil tasks did not complete... cancelled" warning): when the Relay's `waitUntil` window expires mid-await, its in-flight outbound request to the Importer is torn down with it — this is not a hypothetical, it's documented cancellation behavior.
3. Issue 08's own **already-measured real numbers** — 45 rows → 90 shift segments + 45 breaks = ~140 sequential Connecteam API calls, before counting the batched Employee/Job lookups and the final chat post — sit close enough to that 30-second ceiling that this was never a "large export" edge case. It was a near-term reliability problem for exactly the scale this project has already tested against.

**Resolution**: the Worker's `fetch()` handler now only validates the signature/payload and enqueues to a Cloudflare Queue, acking `202` immediately — genuinely fast, not a long-running task deferred via `waitUntil`. The actual Import Run (download, parse, match, write, chat-post) moved to a `queue()` consumer handler in the same Worker script, confirmed via developers.cloudflare.com/queues/platform/limits/ to have **no connected-client dependency at all** and a wall-clock budget of **up to 15 minutes per invocation** — independent of whatever happens to the Relay or Connecteam's own 10-second webhook-response window. Confirmed available on both Workers Free and Paid plans (Queues itself isn't what forces the Paid-plan requirement — the subrequest cap from issue 14 already does that regardless).

Verified end-to-end locally via `wrangler dev`'s local queue simulation: signature rejection (missing/wrong secret → 401), conversation-ID mismatch (→ 403), and the full producer→consumer path — valid trigger acks `202` in single-digit milliseconds, the queue consumer picks it up separately, downloads and parses the real sample file, and (tested with a deliberately fake API token) correctly surfaces a `ConnecteamAuthError`, attempts the abort-chat-message, and engages Cloudflare's own message retry (`message.retry()`) when that also fails — proving the retry wiring works on a genuine failure without needing a real Connecteam account for this pass.

`tsc --noEmit` and `wrangler deploy --dry-run` both clean. Kept fully dependency-isolated from `@sch-import/shared` (same reasoning as `relay-cloudflare`, issue 14) — `ConnecteamClient` was duplicated and trimmed to only the runtime methods this Worker actually calls (setup-only methods like `listConversations`/`createConversationWebhook` were dropped, not carried over unused).

## Consequence for issue 14

Issue 14's deferred question is now answered concretely, not just "plain Worker, given the subrequest headroom" as might have seemed reasonable from the pricing/limits research alone: **a plain Worker fetch handler is not enough at this project's actual measured scale — a producer/consumer Queue split is required**, not as future-proofing but because the already-measured real numbers sit close to the execution-time ceiling today. `relay-cloudflare` (already deployed) needed no changes — its existing `ctx.waitUntil(forwardTrigger(...))` now completes quickly regardless, since the Importer's `fetch()` handler only validates + enqueues rather than doing the full Import Run before responding.
