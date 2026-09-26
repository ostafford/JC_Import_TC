Type: grilling
Status: resolved

## Question

[Issue 01](01-time-clock-signal-source.md) established that the primary Time Clock Signal is Job `instanceIds` — resolved live through the existing Job-matching step (original map's issue 12), no new upload convention needed — but only when every Job referenced in one Schedule Export resolves to the same single Time Clock. This breaks down when: (a) the client hasn't set their Jobs up as Time-Clock-exclusive (a Job's `instanceIds` spans multiple Time Clocks), or (b) a file's resolved Jobs don't all agree on one Time Clock (a data-entry mistake, or a genuinely mixed roster).

Decide the fallback: is a caption convention (confirmed technically viable — `data.message.content` sits alongside `attachments` in the same webhook event) the right second signal, checked only when Job-based resolution is ambiguous — or should ambiguity just fail the run outright (feeding into [issue 03](03-ambiguous-resolution-failure-policy.md)) and push the client toward fixing their Job setup instead of adding a second mechanism to maintain? Also decide: does the fallback (if any) need its own Time Clock Mapping config in the Importer, or can it be resolved some other way (e.g. requiring the caption to literally name the Time Clock, needing no separate mapping at all)?

## Answer

**Build the fallback.** For a first-class, generally-reusable capability (this map's own destination), failing outright whenever a client's Jobs aren't Time-Clock-exclusive is too harsh — not every adopter will be willing or able to reorganize their Job structure just to use this feature.

**Fallback mechanism: caption convention, checked only when Job-based resolution fails to produce exactly one Time Clock.** Job `instanceIds` resolution (issue 01) stays primary and authoritative whenever it's unambiguous — the caption is never consulted in that case. When it isn't (a referenced Job's `instanceIds` spans multiple Time Clocks, or a file's resolved Jobs disagree on one), the Importer falls back to reading `data.message.content` (confirmed to sit alongside `attachments` in the same webhook event) from the same upload message.

**Caption content: the Time Clock's own real name, not a keyword.** Matched live against `listTimeClocks()` (already exists, issue 16 of the original map) — case-insensitive/trimmed, the same tolerance this project already applies to name matching (issue 03 of the original map). Deliberately **not** a keyword resolved through a separate Time Clock Mapping config: that would reintroduce exactly the "config that needs updating whenever Time Clocks change" problem the Job-based primary signal was chosen to avoid. No Time Clock Mapping is needed anywhere in this design — both the primary signal (Job `instanceIds`) and the fallback (Time Clock name) resolve live against Connecteam's own data, nothing cached or configured in the Importer to go stale.

**Open, self-verification in progress**: it's confirmed the wire format supports `text` and `attachments` together (this project's own Importer already sends both for result confirmations), but it is *not yet confirmed* that the Connecteam mobile/web chat app's compose UI actually lets a person type a caption alongside a file they're attaching, before sending. The user is checking this live in the app directly; if it turns out the app doesn't support it, this ticket's fallback choice needs revisiting (filename convention becomes the fallback instead) — flagged here rather than assumed.

**Consequence for [issue 03](03-ambiguous-resolution-failure-policy.md)** (now unblocked): "ambiguous" there should be read as "Job resolution disagreed or spanned multiple Time Clocks, *and* the caption (if any) didn't resolve to exactly one Time Clock name either" — a two-stage resolution, only truly failing after both are tried. No change needed to [issue 04](04-concurrent-runs-confirmation-clarity.md) — the caption lives in the same message as the attachment, so resolution is still entirely local to one upload, no cross-message state introduced.

