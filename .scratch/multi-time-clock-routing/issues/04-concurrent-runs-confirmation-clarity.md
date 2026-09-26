Type: grilling
Status: resolved

## Question

Since routing is now shared across one Chat conversation with potentially several Admins, more than one Schedule Export (for different locations/Time Clocks) can land close together. The Cloudflare Importer is already Queue-backed with one Import Run per message (original map's issue 15), so confirm: (a) does Time Clock resolution for each Import Run read only from that message's own Signal, with no shared/global pending state, so two near-simultaneous uploads for different locations can never cross-contaminate; (b) should the Chat confirmation message (issue 05's pattern) now always name which Time Clock an Import Run targeted, even on success, so results reading close together in the same chat aren't ambiguous about which location each one covers?

## Answer

**(a) Confirmed by reading the actual code, not just architectural reasoning**: `timeClockId` already flows as an explicit parameter into the run pipeline (`config.timeClockId` in `packages/importer/src/config.ts`, `env.TIME_CLOCK_ID` in `packages/importer-cloudflare/src/index.ts`) — never a shared global or module-level singleton. Resolving it per-message instead of from static config keeps that exact same shape: each queued Import Run carries its own resolved `timeClockId` through the same parameter-passing path today's single-Time-Clock code already uses. Two near-simultaneous uploads for different locations cannot cross-contaminate.

**(b) Confirmation copy names the Time Clock only when this Importer has 2+ Time Clocks configured.** A single-Time-Clock deployment (the common case) keeps today's existing message unchanged — no ambiguity exists to resolve there. Once 2+ Time Clocks are configured, every result — success or failure — names the Time Clock it targeted, since that's exactly the condition under which results landing close together in one shared chat become ambiguous about which location each one covers.

