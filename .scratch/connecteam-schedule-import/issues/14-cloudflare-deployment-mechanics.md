Type: grilling
Status: resolved

## Question

[Issue 13](13-multi-tenant-hosted-operation-model.md) confirmed Cloudflare Workers as a second supported self-hosted deployment target (alongside today's local node+tunnel method), deployed to each adopter's own Cloudflare account — same trust boundary as ADR 0001, just different infrastructure. This ticket decides the concrete mechanics: how the Relay and Importer actually map onto Cloudflare's platform, what a client's deploy flow looks like, and what storage replaces `relay.data.json`.

This also directly addresses the one part of [issue 10](10-tech-stack-and-hosting.md) that stayed unresolved after the local method shipped: a stable public URL with no laptop/tunnel required. A deployed Worker gets a persistent URL by construction — that half of issue 10's open question is answered for free by choosing Cloudflare; this ticket is about doing that well, not about re-litigating whether to.

## Context carried in from issue 10 / durable-objects skill guidance (2026-09-25)

- The `durable-objects` skill's own use-case table lists "multi-tenant SaaS, per-entity storage" as what Durable Objects are for — but that doesn't map cleanly here: each Cloudflare deployment belongs to exactly **one** company (self-hosted per adopter, per ADR 0001/issue 13), so there's no multi-tenancy to shard *within* a single deployment. Whatever replaces `relay.data.json` only ever needs to hold one company's own tiny state (one Chat Link record, magic-link/session tokens) — the storage choice should be evaluated against that, not against DO's typical multi-tenant-coordination pitch.
- Pricing/limits fact-check dispatched (Workers free vs. paid plan, Durable Objects plan requirement, KV/D1 free-tier availability, Worker subrequest limits relevant to the Importer's per-row API call pattern, one-click "Deploy to Cloudflare" flow) — results pending, will be appended here.

## Open sub-questions

1. **Relay/Importer split on Cloudflare — preserve, merge, or make mixable?** ADR 0001's Relay/Importer split exists for a trust reason (Relay never holds the Connecteam token), not a hosting reason. Does the Cloudflare option keep them as two separate Workers (mirroring today's two processes), or does it make sense to let a client mix — e.g. Relay on Cloudflare (public, stable URL, no token) while the Importer stays local (private network, holds the real token) — as a third real deployment shape, not just "both local" or "both Cloudflare"?
2. **Storage for the Relay's state** — pending the pricing/limits research: KV, D1, or Durable Objects for the Chat Link record + session tokens, given there's no real multi-tenancy or strong-consistency need within one deployment.
3. **Does the Importer's per-row write pattern (batched GETs, then one POST per Schedule Export row — 20-200+ sequential outbound calls per Import Run, per issues 03/08/12) fit inside a single Worker invocation**, or does it need Cloudflare Queues/Workflows to stay reliable for a large export? Pending the subrequest-limit research.
4. **Onboarding UX** — a one-click "Deploy to Cloudflare" flow (if it exists and is realistic for a non-technical Admin) vs. documented `wrangler` CLI steps. Directly affects the "show clients the ease of Cloudflare" goal from issue 13.
5. **Does the existing browser-based setup wizard (`packages/wizard`, built pre-issue-10-resolution) need a Cloudflare-aware mode** — e.g. writing Wrangler secrets via the Cloudflare API on the client's behalf — or does Cloudflare deployment stay a separate, more manual flow from the polished local wizard, at least initially?
6. **Cost honesty** — pending the pricing research: is the Cloudflare path actually free for a small company's real usage volume, or does it likely cross into the ~$5/month paid tier (e.g. if Durable Objects turns out to require it)? This directly matters for issue 13's "let the client choose based on cost" framing — the choice should be presented accurately, not assumed free.

## Fact-check: Cloudflare Workers pricing and limits (2026-09-25)

Fetched directly from developers.cloudflare.com rather than relied on from memory:

- **Workers**: Free plan — 100,000 requests/day, 10ms CPU time per invocation, **50 subrequests per invocation**. Paid plan ($5/month minimum) — 10M requests/month included, 30M CPU-ms/month included, CPU time per invocation up to 5 minutes (default 30s), **10,000 subrequests per invocation**. Waiting on `fetch()` calls does not count against CPU time, and there is no general wall-clock cap for HTTP-triggered Workers.
- **Durable Objects**: available on **both** Free and Paid plans (Free plan is SQLite-storage-backend only). Free: 100,000 requests/day, 13,000 GB-s duration/day, 5GB storage, 1,000 req/s soft cap per object.
- **KV**: available on Free plan — 100,000 reads/day, 1,000 writes/day, 1GB storage, resets daily. Eventually consistent (edge propagation delay, historically up to ~60s).
- **D1**: available on Free plan — 5M rows read/day, 100,000 rows written/day, 5GB storage.
- **"Deploy to Cloudflare" button**: real, current (`deploy.workers.cloudflare.com/?url=<repo>`). Clones the source repo into the client's own Cloudflare account, reads the repo's Wrangler config, auto-provisions the declared resources, and deploys — described in Cloudflare's own docs as requiring only "a few clicks."

**The decision-relevant finding**: the Importer's per-row write pattern already exceeds the free plan's subrequest cap at real-world scale — issue 08's actual measured live run was **45 rows → 90 shift segments + 45 breaks = 135 write calls**, before counting batched Employee/Job lookups or the final chat confirmation. That's ~2.7x the free plan's 50-subrequest ceiling from breaks/shifts alone. The Paid plan's 10,000-subrequest ceiling comfortably fits any realistic Import Run.

## Answer

1. **Relay/Importer split is preserved and made mixable.** ADR 0001's split exists for a trust reason (only the Importer ever holds the real Connecteam token), independent of hosting substrate, so it carries over unchanged. Beyond "both local" (today) and "both Cloudflare," the tool also supports a **mixed** shape: Relay on Cloudflare (public, stable URL by construction, never holds the token) while the Importer stays local on the client's own trusted network (holds the real token). This directly serves clients who like Cloudflare's stability for the public-facing piece but are uneasy putting their real API credential in a third party's cloud at all.

2. **Build order: the Relay's Cloudflare version ships first.** It's a simple webhook receiver plus a tiny single-tenant state store — no open technical question blocks it. The Importer's Cloudflare version is deferred; its viability is now well-understood (works fine on the Paid plan, not on Free) but its concrete design (Worker vs. Queue-backed processing for reliability) is left to a future ticket rather than decided here.

3. **Wizard stays local-only for now.** `packages/wizard` (built pre-issue-10-resolution) is not extended to drive Cloudflare deployment in this round. Cloudflare setup is documented manually until that path is proven; making the wizard Cloudflare-aware (e.g. writing Wrangler secrets via the Cloudflare API) is separately-scoped future work if it's ever pursued.

4. **Relay storage: Durable Objects (SQLite-backed), not KV.** Both are free-tier available so cost isn't the deciding factor; DO's immediate consistency avoids a class of subtle bugs KV's eventual-consistency edge propagation could introduce (e.g. a stale read immediately after Chat Link setup completes). One DO instance per deployment is sufficient — there's no multi-tenancy to shard within a single company's own self-hosted deployment (ADR 0001/issue 13), so this isn't the "multi-tenant SaaS" use case the `durable-objects` skill's own guidance describes; it's just the simplest strongly-consistent single-record store available.

5. **Onboarding leads with the "Deploy to Cloudflare" button**, confirmed real and low-friction ("a few clicks," auto-provisions declared resources). `wrangler` CLI steps stay documented underneath as the manual/dev alternative, not removed — both exist, but the button is the headline path shown to clients.

6. **Cost honesty, carried forward into how this gets presented to clients**: the three-way comparison is now **local (free, more technical)**, **Cloudflare with Relay-only / mixed shape (free)**, and **full Cloudflare, both pieces (~$5/month Paid plan, easiest)** — not "Cloudflare is free" as originally assumed in issue 13's framing. The Importer's real measured write volume (135 calls from 45 rows) makes the Paid plan a practical requirement for the full-Cloudflare shape, not an edge case. This should be stated plainly wherever the deployment options are documented for clients, consistent with issue 13's "the tool supports both; it doesn't steer" principle — steering requires accurate numbers, not an assumption that Cloudflare is free.

**Consequence for issue 10**: the local method's core unresolved problem (stable public URL without a laptop staying on) is now fully answered for any client who picks Cloudflare for the Relay — a deployed Worker has a persistent URL by construction, solving exactly what issue 10 flagged as unsolved. Issue 10 should be updated to reflect that its remaining open question is now scoped specifically to clients who want to stay fully local (tunnel stability/URL-persistence remains genuinely unsolved for that path only).

## Build (2026-09-25)

`packages/relay-cloudflare` built and verified: a Worker + `RelayObject` Durable Object (SQLite-backed, one instance per deployment via `getByName("singleton")`) replacing `relay.data.json`, with every local-Relay route ported to the Fetch API and Web Crypto in place of `node:crypto`. The wizard-bootstrap route was dropped entirely — a Cloudflare Relay's first login just claims the admin the same way the local one does without the wizard involved.

**A real constraint surfaced during the build, not anticipated when this ticket was resolved**: Cloudflare's "Deploy to Cloudflare" button (confirmed via its docs) requires a monorepo subdirectory to be "fully isolated... including any dependencies," or the build fails. `relay-cloudflare` originally depended on the sibling `@sch-import/shared` workspace package (for a two-line branded-`ConversationId` helper) — incompatible with the button. Fixed by duplicating that one helper locally (`src/vocabulary.ts`) and dropping the cross-package dependency entirely, so `relay-cloudflare` is the one package in this repo that doesn't share code via workspace imports. This is a real precedent for whenever the Importer's Cloudflare version gets built later: it will need the same treatment for anything it currently imports from `@sch-import/shared` (notably its Connecteam API client, a much bigger surface than one helper function) if it's meant to support the same one-click deploy flow.

Verified end-to-end locally via `wrangler dev` against the real local Durable Object simulation: login flow, single-use magic-link enforcement, Chat Link save/reload, webhook secret validation (wrong secret dropped but still 200-acked so Connecteam doesn't retry; correct secret forwards via `ctx.waitUntil` and still acks fast even when the Importer endpoint is unreachable), and — the actual point of this ticket — **Chat Link and session state both survived a full process restart**. `tsc --noEmit` and `wrangler deploy --dry-run` both clean.

README updated with a "Deploying the Relay to Cloudflare (optional)" section: the real button URL (`https://deploy.workers.cloudflare.com/?url=https://github.com/ostafford/JS_Import_TC/tree/main/packages/relay-cloudflare`, confirmed the repo is public), manual `wrangler deploy` as the fallback, and the CLI-setup-fallback flow for finishing setup (the browser wizard doesn't support a Cloudflare-hosted Relay yet, per this ticket's Q3).
