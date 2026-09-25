Type: grilling
Status: resolved

## Question

Decide whether this project should grow a second operating model — the Admin (now: Okky) hosting a Cloudflare-based instance centrally on their own Cloudflare account, used to demo the Connecteam Schedule → Timesheet Import use case to prospective clients and potentially to run it on an ongoing basis for real clients who paste in their own Connecteam API key — alongside (not replacing) today's self-hosted-per-deployer model (ADR 0001).

This directly reopens three decisions currently marked resolved, and needs to land somewhere concrete relative to each of them:

- **ADR 0001** ("Relay never touches customer data") — its whole premise is that no third party, including the project's author, ever holds another company's Connecteam credentials. A centrally-hosted instance holding real clients' API keys is exactly the shape ADR 0001 exists to rule out.
- **Issue 07's ToS approval** — given on the premise that every deployment runs entirely under one company's own token, with "no point where a third party sits between two companies' data." That premise stops being true the moment Okky operates an instance holding other companies' keys.
- **Issue 09's license reasoning** — MIT was chosen partly because the "someone runs a modified version as a service for others" scenario was moot. It would no longer be moot.

## Context from conversation (2026-09-24)

Okky's stated goal: use Connecteam API access more broadly to solve various client "use cases" (this Import tool being one instance), and wants a Cloudflare-hosted path to both demo the concept and potentially operate it for clients, in addition to keeping the local/self-hosted version alive as an option.

When asked directly to choose between three shapes — (A) each client deploys their own Cloudflare Worker with their own key (no ADR 0001/ToS conflict, same trust model as today, just different infra), (B) Okky hosts a demo instance under Okky's own test Connecteam account only (no real client keys, no conflict), (C) Okky hosts centrally and stores real clients' keys (the shape ADR 0001/issue 07 exist to prevent) — Okky answered **a hybrid of B and C**: build/demo it under Okky's own account, but with an eye toward also running it for real clients' real keys, framed as a general capability for addressing client use cases beyond just this one Import tool.

Okky then asked directly whether a hosted model can guarantee neither Okky nor other clients can ever see a given client's stored API token. Answer given and treated as settled input to this ticket, not something to re-derive:

- **Cross-tenant isolation (other clients never see each other's keys)**: fully achievable with standard practice — per-tenant envelope encryption, storage isolated per tenant (e.g. one Cloudflare Durable Object per tenant, unaddressable by others).
- **Operator (Okky) never able to see a client's key, even in principle**: **not achievable** as long as Okky's own infrastructure is the thing that decrypts the key and calls the Connecteam API on the client's behalf — that decryption happens inside code Okky wrote and controls, so whoever controls deploys always retains the technical capability to read it. This is the same limit every SaaS holding third-party API keys operates under (Zapier, Make, n8n Cloud, etc. all claim "encrypted at rest + access-controlled," never "we cannot see it"). True zero-knowledge only exists in the self-hosted model, where the key never leaves the client's own infrastructure at all.

## Open sub-questions for this ticket to resolve

1. Does the map's destination (currently: a self-hosted-only tool, per ADR 0001) expand to explicitly include a centrally-hosted-for-real-clients mode, or does "Cloudflare" stay scoped to (A)/(B) only — i.e. a deployable-by-the-client Worker template, and/or a demo instance under Okky's own account — with (C) ruled out or deferred as a distinct, separately-scoped product?
2. If (C) is pursued at all: what does Okky actually tell a client about what protection they're getting, given "operator can't see it" is not a true claim? Is "encrypted at rest, isolated per tenant, access-controlled, never logged" an acceptable and honestly-worded guarantee to offer, or does the gap between that and what Okky initially wanted to promise change whether this is worth building?
3. Does pursuing (C) require redoing issue 07's ToS conversation with Connecteam specifically for a multi-tenant hosted shape, before any client's real key is ever accepted?
4. Does this change issue 09's license/publishing decision (MIT, passive distribution) — e.g. does a hosted-for-clients offering need different terms (a DPA/ToS of its own with clients) separate from the open-source repo's license?
5. Is this ticket scoped to *this* Import project specifically, or is Okky really describing a reusable pattern (a Cloudflare-hosted, multi-tenant-credential-holding platform) that this Import tool would just be the first instance of? That affects how much of this should be decided here vs. in a separate map entirely.

## Answer

**Shape (C) — Okky operating central infrastructure holding real clients' Connecteam API keys — is excluded, permanently, not just deferred.** Fact-checked against Connecteam's actual current Terms of Service (https://connecteam.com/terms-conditions/, Section 14 "API" — no separate Developer/API Terms or partner/OAuth tier exists anywhere; confirmed by direct fetch of both the ToS and developer.connecteam.com):

> "You may only access and use our API for Customer's internal business purposes... You shall not (a) modify or create a derivative work of any part of the API; **(b) process or permit the processing of the data of any other party unless in connection with the authorized use of the API**, or (c) market, sell, license, sublicense, distribute, publish, display, reproduce, assign or otherwise transfer to a third party the API..."

This confirms ADR 0001's original reasoning was correct, not just cautious: a third party processing another company's Connecteam data on that company's behalf is close to what clause (b) exists to prevent, and clause (c) separately bars redistributing the API itself. No official side door exists — Connecteam's partnerships page lists a "Technology partnership" category with no visible contract terms or application process, so a legitimate Shape (C) would require Okky to directly negotiate a distinct agreement with Connecteam, not something achievable by building it under a personal API token. This is a ToS constraint, independent of who operates it or how well the credentials are isolated — it doesn't get better with stronger engineering (see the encryption/custody discussion in this ticket's conversation history: cross-tenant isolation is solvable, but "operator can never see it" is not, since the operator's own code has to decrypt the key to call the API on the client's behalf — and the point is moot anyway since the ToS rules out being that operator at all for other companies' data).

**Employment/conflict-of-interest check (the harder gate, separate from ToS): cleared.** Okky has approval to build and publish this publicly, as an independent developer project, the same as any other developer or client could — including actively showing/pitching it to prospective clients, not just passive GitHub publication.

**What's actually being built, given both of the above:**
- **ADR 0001 stays exactly as-is** — self-hosted per adopter, no shared infrastructure ever holding anyone else's credentials.
- **Two supported self-hosted deployment options**, both under the adopter's own accounts, so a client can be shown both and pick:
  - **Local**: node process + tunnel (today's existing method) — free, but more technical (terminal-based), and still has issue 10's unresolved viability problem for real ongoing use (see below).
  - **Cloudflare**: Workers, deployed to the adopter's own Cloudflare account — easier to run continuously, likely at some cost to the adopter, but no terminal/laptop-uptime burden.
  - Explicitly not Okky's decision which one a client should use — "the 'free version' is an option, whether it be ideal or not is dependent on the client to choose." The tool supports both; it doesn't steer.
- **A separate demo instance** (Shape B): Okky hosts a live Cloudflare-based instance under Okky's own Connecteam test account, to demo both deployment options to prospective clients side by side. No real client key ever touches it — entirely Okky's own test data, so it carries none of Shape (C)'s exposure.

**Consequence for other tickets**:
- **Issue 10** gets a partial answer from this (Cloudflare Workers confirmed as a real, intended second deployment target) but is *not* fully resolved by it — the local method's core problem (anonymous quick tunnels rotate URLs on restart, no uptime guarantee, doesn't survive reboot) is untouched by this decision and remains open for whichever clients pick "local" for real, not just as a side-by-side demo comparison. Issue 10 updated separately to reflect this.
- **ADR 0001** gets an addendum recording this ToS confirmation, so the "why not a hosted service" reasoning is backed by the actual clause text, not just the original paraphrase.
- **Issue 09** (license/publishing) unaffected — MIT and the existing disclaimer remain accurate, since nothing about the operating model changed for the open-source repo itself.
- Scope (sub-question 5): the *principle* (open-source, self-hosted-per-adopter, multiple deployment targets, no shared credential-holding infrastructure) is general enough to apply to any future integration Okky builds — but no shared platform gets built now. Each future integration stays its own self-contained repo following this same pattern until a second real one actually exists.
