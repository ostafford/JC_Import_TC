Type: grilling
Status: resolved

## Question

Decide the publishing/distribution shape of the open-source repo: what license to use (and why — permissive vs. copyleft matters here since other companies will clone and run this against their own Connecteam accounts), what a README needs to cover for someone unfamiliar to get from "clone" to a working Chat Link (setup order across Relay + Importer + Connecteam-side steps like generating an API token and running `importer setup`), and whether there's any active discovery/announcement plan or the repo is meant to be found passively (e.g. shared informally, linked from a Connecteam community channel, or just sitting on GitHub).

## Answer

**License**: MIT. Copyleft (e.g. AGPL) exists mainly to stop someone from running a modified version *as a service* without sharing changes — moot here, since ADR 0001 and issue 07 already rule out anyone operating this as a shared service on another company's behalf. Permissive keeps friction lowest for a company that just wants to clone and run it.

**Disclaimer**: README carries an explicit "unofficial, not affiliated with or endorsed by Connecteam" notice, given this is currently personal/internal use by a Connecteam employee (issue 07) — protects the Admin personally and prevents anyone stumbling on the repo from mistaking it for official support.

**README setup order**: generate a Connecteam API token (Expert plan) → run `importer setup` (pick the Chat conversation, create its scoped webhook, pick default Break Types per category, per issues 06/08) → log into the Relay via magic-link → paste the resulting conversationId, Importer endpoint, and shared secret into the Relay's form to complete the Chat Link.

**Distribution**: no active announcement/promotion plan for now — the repo is published but found passively (sits on GitHub), consistent with "internal use only at the moment" from issue 07. Revisit if/when there's a reason to promote it more actively.
