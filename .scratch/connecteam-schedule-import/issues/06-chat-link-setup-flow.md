Type: grilling
Status: resolved

## Question

What does creating a Chat Link actually look like for an Admin on the Relay? Cover: how the Admin authenticates to the Relay itself (separate from their Connecteam login), what they enter (Connecteam Chat conversation ID, their Importer's endpoint URL), and how the Relay authenticates its trigger call to that Importer (shared secret, signed webhook, etc.) so a stranger can't trigger imports into someone else's Importer.

## Answer

**Relay login**: magic-link email. An Admin enters their email on the Relay; the Relay emails a one-time link; clicking it logs them in. No password to store, reset, or support.

**Who can trigger an Import**: governed entirely by Connecteam's own chat membership, not by anything the Relay or Importer enforces separately. The company creates a group chat (e.g. "Admin Only") containing every Admin who should be able to trigger an Import, and that conversation is what gets linked as the Chat Link. Any member of that chat can post a Schedule Export and start an Import. This is exactly right for a company with several Admins (see the corrected Admin definition in [CONTEXT.md](../../CONTEXT.md)) — Connecteam's chat membership already models "which Admins can do this," so the tool doesn't need to duplicate that logic anywhere.

**Chat Link setup mechanics**: finding a conversation's ID and creating a webhook both require a Connecteam API token, and the Relay never holds one (ADR 0001) — so the Admin's own Importer does this setup, not the Relay. A one-time `importer setup` step, run with the Admin's own token: lists the Admin's conversations so they can pick the right one, creates a webhook scoped to just that conversation via the confirmed `entityId` parameter, pointing at the Relay's public webhook-receiver URL, and generates a shared secret for signing Relay→Importer trigger calls. The Admin then pastes the resulting conversationId, their Importer's endpoint URL, and the shared secret into the Relay's web form (behind the magic-link login) to finish the Chat Link.

**One Chat Link per account**: confirmed — one Chat Link ties one company together (one linked conversation, one Importer endpoint), not one per individual Admin. For v1, whichever Admin's email first sets it up is the one who can log in and manage it on the Relay; letting a second Admin at the same company also manage it is a reasonable future enhancement, not required by the destination as scoped.

**Trigger payload boundary** (carried over, confirmed no objection): the Relay forwards only identifiers — conversationId, messageId, fileId — signed with the shared secret, never file content or the Admin's token.

**Addendum from [issue 08](08-break-type-selection.md)**: the same `importer setup` step also has the Admin pick a default Break Type per paid/unpaid category (via a picker, not a raw ID) — so setup produces conversationId, Importer endpoint, shared secret, and the two default Break Type IDs together, in one pass.

**Addendum from [issue 07](07-tos-sanity-check.md)**: the Relay is self-hosted per company (cloned alongside the Importer, not run as one shared service by this project's author — see the updated [ADR 0001](../../docs/adr/0001-relay-never-touches-customer-data.md)). Everything above still holds for a single company's own deployment: magic-link login and "one Chat Link per account" now mean the one company that deployed this instance, with multiple Admins at that company able to log into their own deployment.

## Addendum from live implementation (2026-09-22)

Built the Relay and ran the whole Chat Link flow end-to-end against a real Connecteam account. Several things this ticket described didn't match reality; all confirmed and fixed live, not guessed.

**Webhook creation was at the wrong endpoint, with the wrong body.** `entityId` as the scoping param was right, but the path is `POST /settings/v1/webhooks`, not `/webhooks/v1/webhooks` (the wrong path silently returned a 302 redirect to Connecteam's homepage rather than erroring — no rate-limit headers, meaning it never even reached the real API). The real body needs `name`, `url`, `featureType: "chat"`, `eventTypes: ["message_created"]`, `entityId`, and — undocumented, confirmed only by live trial-and-error — `webhookVersion: 0` specifically for `featureType: "chat"` (1, 2, 3, 4, 5, and 10 all get rejected with "Invalid webhook version N for feature chat"; the docs describe `webhookVersion` as generally defaulting to 1).

**There's a real answer to the "signed webhook" half of this ticket's own question, and it wasn't designed in originally.** Connecteam's webhook creation accepts a `secretKey`, echoed back unchanged on every delivery in an `x-webhook-secret` header. `importer setup` now generates this (a second, distinct secret from the Relay→Importer `WEBHOOK_SHARED_SECRET`) and passes it at webhook-creation time; the Relay's Chat Link form gained a fourth field ("Connecteam webhook secret") to hold it, and the Relay rejects any inbound call whose header doesn't match before forwarding anything.

**Trigger payload boundary, corrected.** "conversationId, messageId, fileId" (this ticket, and carried into ADR-adjacent framing) is wrong — there is no `fileId` anywhere in a real delivery. A message's attachment carries a direct download `url` instead. The Relay forwards `{conversationId, messageId, attachmentUrl}`; the boundary principle itself (only identifiers/pointers cross, never file content or a token) still holds — a URL is a pointer, not content.

**`senderId` (used for chat confirmations, config produced by this same setup step) is not an Admin's userId.** Connecteam's Chat "send message" API requires `senderId` to be a **Custom Publisher** ID — a bot-like sender identity created in Settings → Feed settings — not a real Employee/Admin's user ID. `importer setup`'s prompt now asks for a Custom Publisher ID instead, with an inline instruction to create one first if the Admin hasn't already.

**A self-triggering feedback loop, not anticipated by any ticket.** The webhook watches every `message_created` event in the linked conversation — including the ones the Importer itself posts back into that same conversation as result confirmations. Without a check, the Importer's own CSV failure-report attachment gets received as if it were a new Schedule Export upload, and crashes trying to parse a CSV as `.xlsx`. Fixed in the Relay: only `message_created` events where `senderType === "user"` (a real Connecteam user, never a Custom Publisher, bot, or agent) become a trigger.

All of the above verified against a real account, not a sandbox: real webhook created and firing, real signed round-trip Connecteam → Relay → Importer, real chat confirmation posted back successfully.

## Addendum from setup-wizard implementation and a discovered UI/API discrepancy (2026-09-23)

While building `packages/wizard` (the browser-based replacement for `importer setup`'s CLI prompts — see issue 10's Phase A), the API-created `chat` webhook from the addendum above turned out not to appear in Connecteam's own dashboard (profile icon → Integrations → Webhooks), even though it is fully functional (confirmed via a direct `GET /settings/v1/webhooks` call, and via real message deliveries). Investigated and ruled out two hypotheses before giving up on explaining it from outside Connecteam:

- **Not a Beta/feature-type exclusion.** The dashboard's own "Add webhook" modal offers `Chat` as a Feature option, with a Secret key field (contradicting an earlier, wrongly-trusted search result claiming the secret key is API-only — corrected here for the record).
- **Not a `webhookVersion` mismatch.** The dashboard's Event Type table, filtered to `Chat`, shows `message_created` at Version `0` — the exact value this project's API call already sends (`client.ts`'s `createConversationWebhook`). A UI-created webhook for this event would be functionally identical to the API-created one.

Root cause remains unconfirmed — a real Connecteam-side quirk (possibly a bug in that dashboard list's query), not something resolvable from this project's side. Worth asking Connecteam support/an internal contact directly if a definitive answer is ever needed.

**Decision, independent of the root cause**: webhook creation is being changed from an automatic API call (in the wizard's conversation-picker step) to a **manual step**, deliberately — not as a workaround for the visibility bug, but because seeing and creating the webhook object themselves, in Connecteam's own UI, is what actually builds trust for a non-technical client (and the Admin supporting them): an invisible API-created object that "just works" in the background is a harder sell than one you can point at. The wizard now instructs the exact values to enter (Name, Endpoint URL, Feature: `Chat`, Event Type: `message_created`, and a secret key generated by the wizard for them to paste in) and verifies the result via a read-only API call, rather than creating it on the Admin's behalf.
